import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Runs tests inside the Workers runtime with a throwaway D1 and R2, so the
// email handler and the API are exercised exactly as in production.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./drizzle");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            // Tests always run against these values, whatever wrangler.jsonc
            // or .dev.vars say, so they behave the same on GitHub and here.
            APP_URL: "http://localhost:5173",
            MAIL_DOMAIN: "example.test",
            BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
            ALLOWED_SIGNUP_EMAILS: "*",
            DISABLE_RATE_LIMIT: "1",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
