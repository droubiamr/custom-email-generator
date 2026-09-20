/**
 * Database schema, written with Drizzle ORM.
 *
 * Drizzle is a library that lets us describe tables in TypeScript and then
 * generates the SQL migrations for us (`npm run db:generate`). D1 is SQLite
 * under the hood, so we use the sqlite-core helpers.
 *
 * The first four tables (user, session, account, verification, rateLimit)
 * belong to Better Auth, the login library. Their names and columns are what
 * Better Auth expects, so do not rename them.
 */
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---------- Better Auth tables ----------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// Better Auth's login rate limiter keeps its counters here, so a burst of
// wrong passwords is slowed down even though Workers have no shared memory.
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// ---------- Application tables ----------

// A domain the user can create addresses on. Today there is one, set by the
// MAIL_DOMAIN setting. Later, in SaaS mode, users add and verify their own.
export const domains = sqliteTable(
  "domains",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // e.g. "clients.agency.com", lowercase
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("domains_user_name_uq").on(t.userId, t.name)],
);

// One customer = one generated email address.
export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // display name as typed, any script
    localPart: text("local_part").notNull(), // "ahmad.alsayed"
    address: text("address").notNull(), // "ahmad.alsayed@domain", lowercase
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    // Globally unique: two users can never own the same address.
    uniqueIndex("customers_address_uq").on(t.address),
    index("customers_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// One received email. The full original is kept in R2 at rawKey, so nothing
// is ever lost even if parsing misses something.
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    // Message-ID header, or a hash of the raw content when the header is
    // missing. Used to ignore duplicate deliveries.
    dedupeKey: text("dedupe_key").notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(), // first ~160 chars of text, for lists
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    hasAttachments: integer("has_attachments", { mode: "boolean" }).notNull().default(false),
    // True when the body was cut to fit the database row limit. The full
    // original is still in R2 at rawKey.
    bodyTruncated: integer("body_truncated", { mode: "boolean" }).notNull().default(false),
    rawKey: text("raw_key").notNull(),
    rawSize: integer("raw_size").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("messages_customer_dedupe_uq").on(t.customerId, t.dedupeKey),
    index("messages_customer_received_idx").on(t.customerId, t.receivedAt),
    index("messages_user_received_idx").on(t.userId, t.receivedAt),
    index("messages_user_unread_idx").on(t.userId, t.readAt),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    r2Key: text("r2_key").notNull(),
    contentId: text("content_id"), // for inline images referenced as cid:
  },
  (t) => [index("attachments_message_idx").on(t.messageId)],
);

export type Domain = typeof domains.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
