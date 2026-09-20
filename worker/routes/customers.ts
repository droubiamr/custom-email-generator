import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb, schema } from "../db";
import { ensureDefaultDomain } from "../lib/domains";
import { deleteByPrefix } from "../lib/r2";
import { isUniqueViolation, isUuid, likePattern } from "../lib/sql";
import { createCustomerBody, type CustomerDto } from "../../shared/api";
import { suggestLocalPart, withSuffix } from "../../shared/address";

export const customersRoute = new Hono<AppEnv>();

const MAX_SUFFIX_TRIES = 50;
const MAX_CUSTOMERS_PER_USER = 5000;

// Columns returned for every customer, with two live counts computed in SQL.
function customerColumns() {
  const m = schema.messages;
  const cu = schema.customers;
  return {
    id: cu.id,
    name: cu.name,
    address: cu.address,
    createdAt: cu.createdAt,
    unreadCount: sql<number>`(select count(*) from ${m} where ${m.customerId} = ${cu.id} and ${m.readAt} is null)`,
    lastMessageAt: sql<number | null>`(select max(${m.receivedAt}) from ${m} where ${m.customerId} = ${cu.id})`,
  };
}

function toDto(row: {
  id: string;
  name: string;
  address: string;
  createdAt: Date;
  unreadCount: number;
  lastMessageAt: number | null;
}): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    createdAt: row.createdAt.getTime(),
    unreadCount: Number(row.unreadCount),
    lastMessageAt: row.lastMessageAt === null ? null : Number(row.lastMessageAt),
  };
}

// GET /api/customers?q=ahmad  -> the sidebar list, newest activity first.
customersRoute.get("/", async (c) => {
  const { user } = c.get("auth");
  const db = getDb(c.env);
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  const cu = schema.customers;
  const pattern = likePattern(q);
  const rows = await db
    .select(customerColumns())
    .from(cu)
    .where(
      and(
        eq(cu.userId, user.id),
        q
          ? sql`(${cu.name} like ${pattern} escape '\\' or ${cu.address} like ${pattern} escape '\\')`
          : undefined,
      ),
    )
    .orderBy(
      desc(sql`coalesce((select max(${schema.messages.receivedAt}) from ${schema.messages} where ${schema.messages.customerId} = ${cu.id}), ${cu.createdAt})`),
    )
    .limit(500);
  return c.json(rows.map(toDto));
});

// POST /api/customers { name, localPart?, domainId? } -> creates the address.
customersRoute.post("/", async (c) => {
  const { user } = c.get("auth");
  const db = getDb(c.env);

  const parsed = createCustomerBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const { name, domainId } = parsed.data;

  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.customers)
    .where(eq(schema.customers.userId, user.id))
    .get();
  if (count && Number(count.n) >= MAX_CUSTOMERS_PER_USER) {
    throw new HTTPException(429, { message: "Customer limit reached" });
  }

  // Which domain? The one asked for (if the user owns it) or the default.
  let domain = domainId
    ? await db.query.domains.findFirst({
        where: and(eq(schema.domains.id, domainId), eq(schema.domains.userId, user.id)),
      })
    : await db.query.domains.findFirst({
        where: eq(schema.domains.userId, user.id),
        orderBy: schema.domains.createdAt,
      });
  if (!domain) domain = (await ensureDefaultDomain(db, c.env, user.id)) ?? undefined;
  if (!domain) throw new HTTPException(400, { message: "No mail domain is configured" });

  const base = parsed.data.localPart || suggestLocalPart(name);
  if (!base) {
    throw new HTTPException(400, {
      message: "Could not build an address from that name. Type one yourself.",
    });
  }

  // Try "ahmad.alsayed", then "ahmad.alsayed2", "ahmad.alsayed3"... The
  // database's unique index is the final judge, so two people creating the
  // same name at the same instant can never both get the same address.
  for (let n = 0; n < MAX_SUFFIX_TRIES; n++) {
    const localPart = n === 0 ? base : withSuffix(base, n + 1);
    const row = {
      id: crypto.randomUUID(),
      userId: user.id,
      domainId: domain.id,
      name,
      localPart,
      address: `${localPart}@${domain.name}`,
      createdAt: new Date(),
    };
    try {
      await db.insert(schema.customers).values(row);
      const dto: CustomerDto = {
        id: row.id,
        name: row.name,
        address: row.address,
        createdAt: row.createdAt.getTime(),
        unreadCount: 0,
        lastMessageAt: null,
      };
      return c.json(dto, 201);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new HTTPException(409, { message: "That address is taken. Try a different one." });
});

// GET /api/customers/:id
customersRoute.get("/:id", async (c) => {
  if (!isUuid(c.req.param("id"))) throw new HTTPException(404, { message: "Customer not found" });
  const { user } = c.get("auth");
  const db = getDb(c.env);
  const cu = schema.customers;
  const row = await db
    .select(customerColumns())
    .from(cu)
    .where(and(eq(cu.id, c.req.param("id")), eq(cu.userId, user.id)))
    .get();
  if (!row) throw new HTTPException(404, { message: "Customer not found" });
  return c.json(toDto(row));
});

// DELETE /api/customers/:id -> removes the customer, all messages and files.
customersRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isUuid(id)) throw new HTTPException(404, { message: "Customer not found" });
  const { user } = c.get("auth");
  const db = getDb(c.env);
  const deleted = await db
    .delete(schema.customers)
    .where(and(eq(schema.customers.id, id), eq(schema.customers.userId, user.id)))
    .returning({ id: schema.customers.id });
  if (deleted.length === 0) throw new HTTPException(404, { message: "Customer not found" });
  // Messages and attachments rows go with the customer (ON DELETE CASCADE).
  // Stored files are cleaned up after the response; leftovers are harmless.
  c.executionCtx.waitUntil(
    Promise.all([deleteByPrefix(c.env.MAIL, `raw/${id}/`), deleteByPrefix(c.env.MAIL, `att/${id}/`)]).catch(
      (err) => console.error("Customer file cleanup failed", id, err),
    ),
  );
  return c.body(null, 204);
});
