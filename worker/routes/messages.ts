import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb, schema } from "../db";
import { isUuid, likePattern } from "../lib/sql";
import {
  listQuery,
  sinceQuery,
  type MessageDetail,
  type MessageListItem,
  type MessageListResponse,
  type NewMessagesDto,
} from "../../shared/api";

export const messagesRoute = new Hono<AppEnv>();

const m = schema.messages;

const listColumns = {
  id: m.id,
  customerId: m.customerId,
  fromAddress: m.fromAddress,
  fromName: m.fromName,
  subject: m.subject,
  snippet: m.snippet,
  hasAttachments: m.hasAttachments,
  receivedAt: m.receivedAt,
  readAt: m.readAt,
};

function toListItem(r: {
  id: string;
  customerId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  hasAttachments: boolean;
  receivedAt: Date;
  readAt: Date | null;
}): MessageListItem {
  return {
    ...r,
    receivedAt: r.receivedAt.getTime(),
    readAt: r.readAt ? r.readAt.getTime() : null,
  };
}

// GET /api/messages?customerId=&q=&cursor=&limit=
messagesRoute.get("/", async (c) => {
  const { user } = c.get("auth");
  const db = getDb(c.env);
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) throw new HTTPException(400, { message: "Invalid query" });
  const { q, customerId, cursor, cursorId, limit } = parsed.data;
  const pattern = q ? likePattern(q) : null;
  // Pages are keyed by (receivedAt, id) so two messages stored in the same
  // millisecond can never be skipped or repeated across a page boundary.
  const after =
    cursor === undefined
      ? undefined
      : cursorId
        ? or(lt(m.receivedAt, new Date(cursor)), and(eq(m.receivedAt, new Date(cursor)), lt(m.id, cursorId)))
        : lt(m.receivedAt, new Date(cursor));

  const rows = await db
    .select(listColumns)
    .from(m)
    .where(
      and(
        eq(m.userId, user.id),
        customerId ? eq(m.customerId, customerId) : undefined,
        after,
        pattern
          ? sql`(${m.subject} like ${pattern} escape '\\' or ${m.fromAddress} like ${pattern} escape '\\' or ${m.fromName} like ${pattern} escape '\\' or ${m.snippet} like ${pattern} escape '\\')`
          : undefined,
      ),
    )
    .orderBy(desc(m.receivedAt), desc(m.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toListItem);
  const last = items[items.length - 1];
  const body: MessageListResponse = {
    items,
    nextCursor: hasMore && last ? { receivedAt: last.receivedAt, id: last.id } : null,
  };
  return c.json(body);
});

// GET /api/messages/new?since=<ms> -> what the app polls for notifications.
messagesRoute.get("/new", async (c) => {
  const { user } = c.get("auth");
  const db = getDb(c.env);
  const parsed = sinceQuery.safeParse(c.req.query());
  if (!parsed.success) throw new HTTPException(400, { message: "Invalid query" });
  const now = Date.now();

  const [unreadRows, recentRows] = await db.batch([
    db
      .select({ customerId: m.customerId, n: sql<number>`count(*)` })
      .from(m)
      .where(and(eq(m.userId, user.id), isNull(m.readAt)))
      .groupBy(m.customerId),
    db
      .select(listColumns)
      .from(m)
      .where(and(eq(m.userId, user.id), gt(m.receivedAt, new Date(parsed.data.since))))
      .orderBy(desc(m.receivedAt))
      .limit(20),
  ]);

  const unreadByCustomer: Record<string, number> = {};
  let totalUnread = 0;
  for (const r of unreadRows) {
    unreadByCustomer[r.customerId] = Number(r.n);
    totalUnread += Number(r.n);
  }
  const body: NewMessagesDto = {
    now,
    totalUnread,
    unreadByCustomer,
    recent: recentRows.map(toListItem),
  };
  return c.json(body);
});

async function ownedMessage(c: Context<AppEnv>, id: string) {
  if (!isUuid(id)) throw new HTTPException(404, { message: "Message not found" });
  const { user } = c.get("auth");
  const db = getDb(c.env);
  const row = await db.query.messages.findFirst({
    where: and(eq(m.id, id), eq(m.userId, user.id)),
  });
  if (!row) throw new HTTPException(404, { message: "Message not found" });
  return row;
}

// GET /api/messages/:id -> full message with attachment list.
messagesRoute.get("/:id", async (c) => {
  const db = getDb(c.env);
  const row = await ownedMessage(c, c.req.param("id"));
  const [atts, customer] = await Promise.all([
    db
      .select({
        id: schema.attachments.id,
        filename: schema.attachments.filename,
        mimeType: schema.attachments.mimeType,
        size: schema.attachments.size,
        contentId: schema.attachments.contentId,
      })
      .from(schema.attachments)
      .where(eq(schema.attachments.messageId, row.id)),
    db.query.customers.findFirst({
      where: eq(schema.customers.id, row.customerId),
      columns: { id: true, name: true, address: true },
    }),
  ]);
  const body: MessageDetail = {
    ...toListItem(row),
    toAddress: row.toAddress,
    textBody: row.textBody,
    htmlBody: row.htmlBody,
    bodyTruncated: row.bodyTruncated,
    attachments: atts,
    customer: customer ?? { id: row.customerId, name: "", address: row.toAddress },
  };
  return c.json(body);
});

// POST /api/messages/:id/read and /unread
messagesRoute.post("/:id/read", async (c) => {
  const row = await ownedMessage(c, c.req.param("id"));
  if (!row.readAt) {
    await getDb(c.env).update(m).set({ readAt: new Date() }).where(eq(m.id, row.id));
  }
  return c.body(null, 204);
});

messagesRoute.post("/:id/unread", async (c) => {
  const row = await ownedMessage(c, c.req.param("id"));
  await getDb(c.env).update(m).set({ readAt: null }).where(eq(m.id, row.id));
  return c.body(null, 204);
});

// DELETE /api/messages/:id -> removes the message and its stored files.
messagesRoute.delete("/:id", async (c) => {
  const db = getDb(c.env);
  const row = await ownedMessage(c, c.req.param("id"));
  const atts = await db
    .select({ r2Key: schema.attachments.r2Key })
    .from(schema.attachments)
    .where(eq(schema.attachments.messageId, row.id));
  await db.delete(m).where(eq(m.id, row.id));
  c.executionCtx.waitUntil(
    c.env.MAIL.delete([row.rawKey, ...atts.map((a) => a.r2Key)]).catch((err) =>
      console.error("Attachment cleanup failed", row.id, err),
    ),
  );
  return c.body(null, 204);
});

// Types a browser could execute if opened directly. They are always sent as
// plain downloads so an email can never inject a page into our origin.
const NEVER_INLINE = /^(text\/html|image\/svg|application\/xhtml|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;

// GET /api/messages/:id/attachments/:attId -> downloads one attachment.
messagesRoute.get("/:id/attachments/:attId", async (c) => {
  const db = getDb(c.env);
  const row = await ownedMessage(c, c.req.param("id"));
  if (!isUuid(c.req.param("attId"))) throw new HTTPException(404, { message: "Attachment not found" });
  const att = await db.query.attachments.findFirst({
    where: and(
      eq(schema.attachments.id, c.req.param("attId")),
      eq(schema.attachments.messageId, row.id),
    ),
  });
  if (!att) throw new HTTPException(404, { message: "Attachment not found" });
  const obj = await c.env.MAIL.get(att.r2Key);
  if (!obj) throw new HTTPException(404, { message: "Attachment file is missing" });

  const safeType = NEVER_INLINE.test(att.mimeType) ? "application/octet-stream" : att.mimeType;
  const inline = c.req.query("inline") === "1" && /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/i.test(safeType);
  return new Response(obj.body, {
    headers: {
      "Content-Type": safeType,
      "Content-Length": String(obj.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

// GET /api/messages/:id/raw -> the original .eml file, for backups.
messagesRoute.get("/:id/raw", async (c) => {
  const row = await ownedMessage(c, c.req.param("id"));
  const obj = await c.env.MAIL.get(row.rawKey);
  if (!obj) throw new HTTPException(404, { message: "Original file is missing" });
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${row.id}.eml"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0",
    },
  });
});
