import { env } from "cloudflare:test";
import { getDb, schema } from "../worker/db";

/** Inserts a user, a domain and a customer straight into the database. */
export async function seedCustomer(opts: { address: string; userEmail?: string }) {
  const db = getDb(env);
  const now = new Date();
  const userId = crypto.randomUUID();
  const domainId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const [localPart, domainName] = opts.address.split("@");
  await db.insert(schema.user).values({
    id: userId,
    name: "Seed",
    email: opts.userEmail ?? `${userId}@seed.test`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.domains).values({ id: domainId, userId, name: domainName!, verifiedAt: now, createdAt: now });
  await db.insert(schema.customers).values({
    id: customerId,
    userId,
    domainId,
    name: "Seed Customer",
    localPart: localPart!,
    address: opts.address,
    createdAt: now,
  });
  return { userId, domainId, customerId };
}

/** Builds a minimal fake of Cloudflare's ForwardableEmailMessage. */
export function fakeEmail(raw: string, from: string, to: string) {
  const bytes = new TextEncoder().encode(raw);
  const rejected: string[] = [];
  const msg = {
    from,
    to,
    rawSize: bytes.byteLength,
    raw: new Blob([bytes]).stream(),
    headers: new Headers(parseHeaders(raw)),
    setReject: (reason: string) => rejected.push(reason),
    forward: async () => {},
    reply: async () => {},
  };
  return { msg: msg as unknown as ForwardableEmailMessage, rejected };
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const head = raw.split(/\r?\n\r?\n/)[0] ?? "";
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

export const SIMPLE_EMAIL = (id: string, subject = "Hello") =>
  [
    `From: Visa Center <noreply@visa.example>`,
    `To: ahmad@example.test`,
    `Subject: ${subject}`,
    `Message-ID: <${id}@visa.example>`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Dear Ahmad, your appointment is confirmed.`,
    ``,
  ].join("\r\n");

export const MULTIPART_EMAIL = (id: string) =>
  [
    `From: Visa Center <noreply@visa.example>`,
    `To: ahmad@example.test`,
    `Subject: With attachment`,
    `Message-ID: <${id}@visa.example>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="b1"`,
    ``,
    `--b1`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    `<p>Hello <b>Ahmad</b></p><script>alert(1)</script>`,
    `--b1`,
    `Content-Type: application/pdf; name="../../etc/passwd.pdf"`,
    `Content-Disposition: attachment; filename="../../etc/passwd.pdf"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    `JVBERi0xLjQgZmFrZQ==`,
    `--b1--`,
    ``,
  ].join("\r\n");
