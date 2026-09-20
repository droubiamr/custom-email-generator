import { defineConfig } from "drizzle-kit";

// Tells drizzle-kit where the schema lives and where to write SQL migrations.
// The migrations are applied with `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./drizzle",
});
