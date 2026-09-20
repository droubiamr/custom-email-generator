/**
 * The inbound email handler. Cloudflare Email Routing calls this once per
 * message sent to any address on the domain (catch-all rule).
 *
 * Durability rules:
 *  1. The raw message is written to R2 before anything else, so even a
 *     parsing bug cannot lose mail.
 *  2. Any failure throws. Cloudflare then answers the sending server with a
 *     temporary error and the sender retries later.
 *  3. Retries are safe: the same message is recognised by its Message-ID (or
 *     a hash of its content) and stored only once.
 */
import PostalMime from "postal-mime";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { chunk, isUniqueViolation } from "./sql";

const MAX_RAW_BYTES = 25 * 1024 * 1024; // Email Routing's own limit
const SNIPPET_LENGTH = 160;
// D1 rows are limited to 2 MB. Bodies beyond this are cut; the original in
// R2 stays complete.
const MAX_BODY_CHARS = 700_000;
const MAX_SUBJECT = 500;
const MAX_NAME = 200;
const MAX_ADDRESS = 320;
const MAX_ATTACHMENTS = 200;
// Per-address quota. A hostile sender cannot fill the storage bill forever.
const MAX_MAILBOX_BYTES = 500 * 1024 * 1024;
const MAX_MAILBOX_MESSAGES = 5000;
const ATTACHMENT_INSERT_CHUNK = 10; // 7 columns x 10 rows < 100 parameters
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

export async function handleEmail(message: ForwardableEmailMessage, env: Env) {
  const db = getDb(env);
  const to = message.to.trim().toLowerCase();

  // 1. Who is this for? Unknown addresses are refused so the sender gets a
  //    normal bounce instead of the mail silently disappearing.
  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.address, to),
  });
  if (!customer) {
    message.setReject("No such recipient");
    return;
  }
  if (message.rawSize > MAX_RAW_BYTES) {
    message.setReject("Message too large");
    return;
  }

  // 2. Mailbox quota: refuse with a permanent error once an address is full.
  const usage = await db
    .select({ bytes: sql<number>`coalesce(sum(${schema.messages.rawSize}), 0)`, n: sql<number>`count(*)` })
    .from(schema.messages)
    .where(eq(schema.messages.customerId, customer.id))
    .get();
  if (usage && (Number(usage.bytes) + message.rawSize > MAX_MAILBOX_BYTES || Number(usage.n) >= MAX_MAILBOX_MESSAGES)) {
    message.setReject("Mailbox full");
    return;
  }

  // 3. Read the raw message exactly once (the stream cannot be re-read).
  //    The dedupe key pairs the sender-supplied Message-ID with the envelope
  //    sender, so a stranger cannot pre-empt a real sender's ID. Without a
  //    Message-ID the content hash is used instead.
  const raw = await new Response(message.raw).arrayBuffer();
  const headerId = message.headers.get("message-id")?.trim();
  const envelopeFrom = message.from.trim().toLowerCase().slice(0, MAX_ADDRESS);
  const dedupeKey =
    headerId && headerId.length <= 500
      ? `${envelopeFrom}|${headerId}`
      : `sha256:${await sha256Hex(raw)}`;

  // 4. Already stored? Then this is a redelivery. Nothing to do.
  const existing = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.customerId, customer.id),
      eq(schema.messages.dedupeKey, dedupeKey),
    ),
    columns: { id: true },
  });
  if (existing) return;

  // 5. Keep the original safe first. Storage keys derive from the dedupe key,
  //    so a retry overwrites the same objects instead of leaving orphans.
  const messageId = crypto.randomUUID();
  const storageId = await sha256Hex(new TextEncoder().encode(dedupeKey).buffer as ArrayBuffer);
  const rawKey = `raw/${customer.id}/${storageId}.eml`;
  await env.MAIL.put(rawKey, raw, {
    httpMetadata: { contentType: "message/rfc822" },
    customMetadata: { from: message.from, to, dedupeKey },
  });

  // 6. Parse into fields the app can show.
  const parsed = await PostalMime.parse(raw);
  const fullText = parsed.text ?? null;
  const fullHtml = parsed.html ?? null;
  const text = fullText === null ? null : fullText.slice(0, MAX_BODY_CHARS);
  const html = fullHtml === null ? null : fullHtml.slice(0, MAX_BODY_CHARS);
  const bodyTruncated = (fullText?.length ?? 0) > MAX_BODY_CHARS || (fullHtml?.length ?? 0) > MAX_BODY_CHARS;
  const snippetSource = text ?? (html ? stripTags(html) : "");
  const snippet = snippetSource.replace(/\s+/g, " ").trim().slice(0, SNIPPET_LENGTH);

  // 7. Attachments go to R2 as separate objects; only metadata goes to D1.
  const attachmentRows: (typeof schema.attachments.$inferInsert)[] = [];
  for (const [i, att] of parsed.attachments.slice(0, MAX_ATTACHMENTS).entries()) {
    const content =
      typeof att.content === "string" ? new TextEncoder().encode(att.content) : att.content;
    const mimeType = safeMimeType(att.mimeType);
    const r2Key = `att/${customer.id}/${storageId}/${i}`;
    await env.MAIL.put(r2Key, content, { httpMetadata: { contentType: mimeType } });
    attachmentRows.push({
      id: crypto.randomUUID(),
      messageId,
      filename: safeFilename(att.filename, i),
      mimeType,
      size: content.byteLength,
      r2Key,
      contentId: att.contentId?.replace(/^<|>$/g, "") ?? null,
    });
  }

  const receivedAt = new Date();
  const messageRow: typeof schema.messages.$inferInsert = {
    id: messageId,
    userId: customer.userId,
    customerId: customer.id,
    dedupeKey,
    fromAddress: (parsed.from?.address ?? message.from).toLowerCase().slice(0, MAX_ADDRESS),
    fromName: parsed.from?.name?.slice(0, MAX_NAME) || null,
    toAddress: to.slice(0, MAX_ADDRESS),
    subject: ((parsed.subject ?? "").trim() || "(no subject)").slice(0, MAX_SUBJECT),
    snippet,
    textBody: text,
    htmlBody: html,
    bodyTruncated,
    hasAttachments: attachmentRows.length > 0,
    rawKey,
    rawSize: raw.byteLength,
    receivedAt,
    readAt: null,
  };

  // 8. Write message and attachment rows together. D1 runs a batch as one
  //    transaction: either everything is saved or nothing is. Attachment
  //    rows are inserted in small groups to stay under D1's parameter limit.
  try {
    if (attachmentRows.length > 0) {
      const [first, ...rest] = chunk(attachmentRows, ATTACHMENT_INSERT_CHUNK).map((rows) =>
        db.insert(schema.attachments).values(rows),
      );
      await db.batch([db.insert(schema.messages).values(messageRow), first!, ...rest]);
    } else {
      await db.insert(schema.messages).values(messageRow);
    }
  } catch (err) {
    // A concurrent redelivery may have won the race; that is fine.
    if (isUniqueViolation(err)) return;
    throw err;
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Only a well-formed "type/subtype" is trusted; anything else is a plain download. */
function safeMimeType(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return MIME_RE.test(v) ? v.toLowerCase() : "application/octet-stream";
}

/** Never trust a sender's filename: strip paths and control characters. */
function safeFilename(name: string | null | undefined, index: number): string {
  const base = (name ?? "")
    .split(/[/\\]/)
    .pop()!
    .replace(/[\p{Cc}]/gu, "")
    .trim()
    .slice(0, 200);
  return base || `attachment-${index + 1}`;
}
