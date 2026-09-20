import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";

/**
 * Makes sure the user owns the domain named in MAIL_DOMAIN. Safe to call
 * repeatedly: it only inserts when the row is missing.
 */
export async function ensureDefaultDomain(db: Db, env: Env, userId: string) {
  const name = String(env.MAIL_DOMAIN ?? "").trim().toLowerCase();
  if (!name) return null;
  const existing = await db.query.domains.findFirst({
    where: and(eq(schema.domains.userId, userId), eq(schema.domains.name, name)),
  });
  if (existing) return existing;
  const row = {
    id: crypto.randomUUID(),
    userId,
    name,
    verifiedAt: new Date(),
    createdAt: new Date(),
  };
  await db.insert(schema.domains).values(row).onConflictDoNothing();
  return row;
}
