import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb, schema } from "../db";
import { ensureDefaultDomain } from "../lib/domains";
import type { MeDto } from "../../shared/api";

export const meRoute = new Hono<AppEnv>();

// GET /api/me -> who am I and which domains can I create addresses on.
meRoute.get("/", async (c) => {
  const { user } = c.get("auth");
  const db = getDb(c.env);
  await ensureDefaultDomain(db, c.env, user.id);
  const domains = await db
    .select({ id: schema.domains.id, name: schema.domains.name })
    .from(schema.domains)
    .where(eq(schema.domains.userId, user.id))
    .orderBy(schema.domains.createdAt);
  const body: MeDto = {
    user: { id: user.id, name: user.name, email: user.email },
    domains,
  };
  return c.json(body);
});
