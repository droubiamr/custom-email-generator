/**
 * Worker entry point. Two jobs:
 *   fetch  -> the HTTP API (and, in production, the static React app)
 *   email  -> incoming mail from Cloudflare Email Routing
 *
 * Hono is a small, well-established router for Workers. Every /api route
 * except /api/auth/* requires a valid session.
 */
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { createAuth, type Session } from "./auth";
import { handleEmail } from "./lib/email";
import { customersRoute } from "./routes/customers";
import { messagesRoute } from "./routes/messages";
import { meRoute } from "./routes/me";

export type AppEnv = {
  Bindings: Env;
  Variables: { auth: Session };
};

const app = new Hono<AppEnv>();

// Standard hardening headers (no MIME sniffing, no framing by other sites...).
app.use("*", secureHeaders());

// No API request body is ever large; anything bigger is refused up front.
app.use("/api/*", bodyLimit({ maxSize: 64 * 1024 }));

// Cross-site request forgery guard for anything that changes data. Browsers
// always send Origin (or Sec-Fetch-Site) on cross-site requests, so a
// mismatch means the request did not come from our own app.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    const site = c.req.header("sec-fetch-site");
    const own = new URL(c.env.APP_URL).origin;
    if ((origin && origin !== own) || (site && site !== "same-origin" && site !== "none")) {
      throw new HTTPException(403, { message: "Cross-site request refused" });
    }
  }
  await next();
});

// Better Auth owns everything under /api/auth (sign up, sign in, sign out,
// session). It reads and writes the session cookie itself.
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// Everything else under /api needs a logged-in user.
app.use("/api/*", async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) throw new HTTPException(401, { message: "Not signed in" });
  c.set("auth", session);
  await next();
});

app.route("/api/me", meRoute);
app.route("/api/customers", customersRoute);
app.route("/api/messages", messagesRoute);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  // Log the details for us, but never leak them to the browser.
  console.error("Unhandled error", err);
  return c.json({ error: "Something went wrong" }, 500);
});

export default {
  fetch: app.fetch,
  email: handleEmail,
} satisfies ExportedHandler<Env>;
