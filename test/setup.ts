import { applyD1Migrations, env } from "cloudflare:test";

// Every test file starts with the real schema applied to an empty database.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
