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
// D1 rows are limited to 2 MB. Bodies beyond this are cut (measured in
// bytes, since Arabic and other scripts use several bytes per character);
// the original in R2 stays complete.
const MAX_BODY_BYTES = 600_000;
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

  // 2. Read the raw message exactly once (the stream cannot be re-read).
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

  // 3. Already stored? Then this is a redelivery. Nothing to do.
  const existing = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.customerId, customer.id),
      eq(schema.messages.dedupeKey, dedupeKey),
    ),
    columns: { id: true },
  });
  if (existing) return;

  // 4. Mailbox quota: refuse with a permanent error once an address is full.
  const usage = await db
    .select({ bytes: sql<number>`coalesce(sum(${schema.messages.rawSize}), 0)`, n: sql<number>`count(*)` })
    .from(schema.messages)
    .where(eq(schema.messages.customerId, customer.id))
    .get();
  if (usage && (Number(usage.bytes) + message.rawSize > MAX_MAILBOX_BYTES || Number(usage.n) >= MAX_MAILBOX_MESSAGES)) {
    message.setReject("Mailbox full");
    return;
  }

  // 5. Keep the original safe first. Storage keys derive from the dedupe key,
  //    so a retry overwrites the same objects instead of leaving orphans.
  const messageId = crypto.randomUUID();
  const storageId = await sha256Hex(new TextEncoder().encode(dedupeKey));
  const rawKey = `raw/${customer.id}/${storageId}.eml`;
  await env.MAIL.put(rawKey, raw, { httpMetadata: { contentType: "message/rfc822" } });

  // 6. Parse into fields the app can show.
  const parsed = await PostalMime.parse(raw);
  const fullText = parsed.text ?? null;
  const fullHtml = parsed.html ?? null;
  const textCut = fullText === null ? null : cutToBytes(fullText, MAX_BODY_BYTES);
  const htmlCut = fullHtml === null ? null : cutToBytes(fullHtml, MAX_BODY_BYTES);
  const text = textCut?.value ?? null;
  const html = htmlCut?.value ?? null;
  const bodyTruncated = Boolean(textCut?.truncated || htmlCut?.truncated);
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

async function sha256Hex(buf: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cuts a string to at most `max` UTF-8 bytes without splitting a character. */
function cutToBytes(value: string, max: number): { value: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= max) return { value, truncated: false };
  // TextDecoder drops a partial character at the cut point instead of
  // producing garbage.
  return { value: new TextDecoder().decode(bytes.subarray(0, max)).replace(/\uFFFD$/, ""), truncated: true };
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
