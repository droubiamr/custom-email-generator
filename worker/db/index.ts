import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// Wraps the raw D1 binding with Drizzle so queries are typed.
export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
