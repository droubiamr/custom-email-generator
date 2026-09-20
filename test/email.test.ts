import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { handleEmail } from "../worker/lib/email";
import { getDb, schema } from "../worker/db";
import { fakeEmail, MULTIPART_EMAIL, seedCustomer, SIMPLE_EMAIL } from "./helpers";

const ADDRESS = "ahmad@example.test";

describe("inbound email handler", () => {
  let customerId: string;
  beforeAll(async () => {
    ({ customerId } = await seedCustomer({ address: ADDRESS }));
  });

  it("stores a plain message and keeps the original in R2", async () => {
    const { msg, rejected } = fakeEmail(SIMPLE_EMAIL("m1"), "noreply@visa.example", ADDRESS);
    await handleEmail(msg, env);
    expect(rejected).toEqual([]);

    const db = getDb(env);
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.customerId, customerId));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.subject).toBe("Hello");
    expect(row.fromAddress).toBe("noreply@visa.example");
    expect(row.fromName).toBe("Visa Center");
    expect(row.textBody).toContain("appointment is confirmed");
    expect(row.snippet).toBe("Dear Ahmad, your appointment is confirmed.");
    expect(row.readAt).toBeNull();
    expect(row.dedupeKey).toBe("noreply@visa.example|<m1@visa.example>");

    const raw = await env.MAIL.get(row.rawKey);
    expect(raw).not.toBeNull();
    expect(await raw!.text()).toContain("Message-ID: <m1@visa.example>");
  });

  it("does not let a stranger pre-empt a real sender's Message-ID", async () => {
    const { msg } = fakeEmail(SIMPLE_EMAIL("m1", "Impostor"), "stranger@evil.example", ADDRESS);
    await handleEmail(msg, env);
    const db = getDb(env);
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.customerId, customerId));
    expect(rows.map((r) => r.subject).sort()).toEqual(["Hello", "Impostor"]);
  });

  it("ignores a redelivery of the same message", async () => {
    const { msg } = fakeEmail(SIMPLE_EMAIL("m1"), "noreply@visa.example", ADDRESS);
    await handleEmail(msg, env);
    const db = getDb(env);
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.customerId, customerId));
    expect(rows).toHaveLength(2);
  });

  it("matches the recipient case-insensitively", async () => {
    const { msg, rejected } = fakeEmail(SIMPLE_EMAIL("m2", "Upper"), "x@y.example", "Ahmad@Example.Test");
    await handleEmail(msg, env);
    expect(rejected).toEqual([]);
    const db = getDb(env);
    const row = await db.query.messages.findFirst({ where: eq(schema.messages.subject, "Upper") });
    expect(row?.toAddress).toBe(ADDRESS);
  });

  it("rejects mail for an address that does not exist", async () => {
    const { msg, rejected } = fakeEmail(SIMPLE_EMAIL("m3"), "x@y.example", "nobody@example.test");
    await handleEmail(msg, env);
    expect(rejected).toEqual(["No such recipient"]);
  });

  it("stores attachments in R2 with a safe filename", async () => {
    const { msg } = fakeEmail(MULTIPART_EMAIL("m4"), "noreply@visa.example", ADDRESS);
    await handleEmail(msg, env);
    const db = getDb(env);
    const row = await db.query.messages.findFirst({ where: eq(schema.messages.subject, "With attachment") });
    expect(row?.hasAttachments).toBe(true);
    expect(row?.htmlBody).toContain("<b>Ahmad</b>");
    expect(row?.snippet).toBe("Hello Ahmad alert(1)".replace(" alert(1)", "")); // script stripped from snippet
    const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.messageId, row!.id));
    expect(atts).toHaveLength(1);
    expect(atts[0]!.filename).toBe("passwd.pdf");
    expect(atts[0]!.mimeType).toBe("application/pdf");
    const obj = await env.MAIL.get(atts[0]!.r2Key);
    expect(obj).not.toBeNull();
    expect(atts[0]!.size).toBe((await obj!.arrayBuffer()).byteLength);
  });

  it("falls back to a content hash when Message-ID is missing", async () => {
    const raw = SIMPLE_EMAIL("m5", "No id").replace(/Message-ID:.*\r\n/, "");
    const a = fakeEmail(raw, "x@y.example", ADDRESS);
    await handleEmail(a.msg, env);
    const b = fakeEmail(raw, "x@y.example", ADDRESS);
    await handleEmail(b.msg, env);
    const db = getDb(env);
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.subject, "No id"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupeKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
