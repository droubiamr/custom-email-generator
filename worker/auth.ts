/**
 * Better Auth setup. Better Auth is the library that handles sign up, login,
 * sessions and password hashing so we never write that logic ourselves.
 *
 * On Workers the database binding only exists inside a request, so the auth
 * instance is created per request with `createAuth(env)`.
 */
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDb, schema } from "./db";
import { ensureDefaultDomain } from "./lib/domains";

const MIN_SECRET_LENGTH = 32;

export function createAuth(env: Env) {
  const db = getDb(env);
  const appUrl: string = env.APP_URL;
  const secret = String(env.BETTER_AUTH_SECRET ?? "");
  // Refuse to run a public deployment with a weak or default secret.
  if (appUrl.startsWith("https://") && (secret.length < MIN_SECRET_LENGTH || secret.startsWith("dev-only"))) {
    throw new Error("BETTER_AUTH_SECRET must be a long random value in production");
  }
  // Sign-up policy. Missing or empty means CLOSED: nobody can register.
  // "*" opens sign-up to everyone (SaaS mode). Otherwise a comma-separated
  // list of allowed emails.
  const rawAllowed = String(env.ALLOWED_SIGNUP_EMAILS ?? "").trim();
  const openSignup = rawAllowed === "*";
  const allowed = openSignup
    ? []
    : rawAllowed
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

  return betterAuth({
    baseURL: appUrl,
    secret,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    trustedOrigins: [appUrl],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14, // 14 days
      updateAge: 60 * 60 * 24, // refresh the expiry once a day of use
      cookieCache: { enabled: true, maxAge: 60 }, // revoked sessions die within a minute
    },
    rateLimit: {
      enabled: String(env.DISABLE_RATE_LIMIT) !== "1",
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: appUrl.startsWith("https://"),
      // Cloudflare puts the real visitor IP in this header; the rate limiter
      // needs it to count attempts per visitor instead of globally.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { generateId: () => crypto.randomUUID() },
    },
    databaseHooks: {
      user: {
        create: {
          // Sign-up allowlist, see openSignup above.
          before: async (u) => {
            if (!openSignup && !allowed.includes(u.email.toLowerCase())) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-up is by invitation only.",
              });
            }
            return { data: u };
          },
          // Give every new user the configured mail domain to work with.
          after: async (u) => {
            await ensureDefaultDomain(db, env, u.id);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
