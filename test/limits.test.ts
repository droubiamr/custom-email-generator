import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { handleEmail } from "../worker/lib/email";
import { getDb, schema } from "../worker/db";
import { fakeEmail, seedCustomer } from "./helpers";

const ADDRESS = "limits@example.test";

function multipart(id: string, attachmentCount: number, htmlSize: number) {
  const parts: string[] = [
    `From: Big Sender <big@sender.example>`,
    `To: ${ADDRESS}`,
    `Subject: ${"s".repeat(2000)}`,
    `Message-ID: <${id}@sender.example>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="b1"`,
    ``,
    `--b1`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    `<p>${"x".repeat(htmlSize)}</p>`,
  ];
  for (let i = 0; i < attachmentCount; i++) {
    parts.push(
      `--b1`,
      `Content-Type: text/plain; name="f${i}.txt"`,
      `Content-Disposition: attachment; filename="f${i}.txt"`,
      ``,
      `file ${i}`,
    );
  }
  parts.push(`--b1--`, ``);
  return parts.join("\r\n");
}

describe("email handler limits", () => {
  let customerId: string;
  beforeAll(async () => {
    ({ customerId } = await seedCustomer({ address: ADDRESS }));
  });

  it("stores many attachments without hitting the D1 parameter limit", async () => {
    const { msg, rejected } = fakeEmail(multipart("many", 45, 10), "big@sender.example", ADDRESS);
    await handleEmail(msg, env);
    expect(rejected).toEqual([]);
    const db = getDb(env);
    const row = await db.query.messages.findFirst({ where: eq(schema.messages.customerId, customerId) });
    expect(row).toBeTruthy();
    const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.messageId, row!.id));
    expect(atts).toHaveLength(45);
    expect(row!.subject.length).toBe(500);
  });

  it("cuts oversized bodies and flags them, keeping the original in R2", async () => {
    const { msg } = fakeEmail(multipart("huge", 0, 900_000), "big@sender.example", ADDRESS);
    await handleEmail(msg, env);
    const db = getDb(env);
    const row = await db.query.messages.findFirst({ where: eq(schema.messages.dedupeKey, "big@sender.example|<huge@sender.example>") });
    expect(row!.bodyTruncated).toBe(true);
    expect(row!.htmlBody!.length).toBeLessThanOrEqual(700_000);
    const raw = await env.MAIL.get(row!.rawKey);
    expect(raw!.size).toBeGreaterThan(900_000);
  });

  it("replaces a malformed attachment type with a plain download type", async () => {
    const raw = multipart("mime", 1, 10).replace('Content-Type: text/plain; name="f0.txt"', 'Content-Type: text/html\r\nX-Bogus: 1; name="f0.txt"');
    const { msg } = fakeEmail(raw, "big@sender.example", ADDRESS);
    await handleEmail(msg, env);
    const db = getDb(env);
    const row = await db.query.messages.findFirst({ where: eq(schema.messages.dedupeKey, "big@sender.example|<mime@sender.example>") });
    const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.messageId, row!.id));
    expect(atts[0]!.mimeType).toMatch(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/);
  });
});
