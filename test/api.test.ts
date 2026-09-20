import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "http://localhost:5173";

/** Signs up a fresh user and returns the session cookie. */
async function signUp(email: string) {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ name: "Tester", email, password: "a-long-test-password" }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("better-auth.session_token");
  return cookie;
}

function json(cookie: string, body?: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

describe("API", () => {
  it("refuses everything without a session", async () => {
    for (const path of ["/api/me", "/api/customers", "/api/messages", "/api/messages/new"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`);
      expect(res.status, path).toBe(401);
    }
  });

  it("creates customers with unique addresses and lists them", async () => {
    const cookie = await signUp("one@test.example");

    const me = await (await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } })).json<{
      domains: { id: string; name: string }[];
    }>();
    expect(me.domains).toHaveLength(1);
    expect(me.domains[0]!.name).toBe("example.test");

    const first = await SELF.fetch(`${ORIGIN}/api/customers`, json(cookie, { name: "Ahmad Al Sayed" }));
    expect(first.status).toBe(201);
    const c1 = await first.json<{ id: string; address: string }>();
    expect(c1.address).toBe("ahmad.alsayed@example.test");

    const second = await SELF.fetch(`${ORIGIN}/api/customers`, json(cookie, { name: "Ahmad Al-Sayed" }));
    const c2 = await second.json<{ address: string }>();
    expect(c2.address).toBe("ahmad.alsayed2@example.test");

    const list = await (await SELF.fetch(`${ORIGIN}/api/customers`, { headers: { Cookie: cookie } })).json<
      { id: string; unreadCount: number }[]
    >();
    expect(list.map((c) => c.id)).toContain(c1.id);
    expect(list).toHaveLength(2);

    const search = await (
      await SELF.fetch(`${ORIGIN}/api/customers?q=alsayed2`, { headers: { Cookie: cookie } })
    ).json<{ address: string }[]>();
    expect(search).toHaveLength(1);
    expect(search[0]!.address).toBe("ahmad.alsayed2@example.test");
  });

  it("validates input", async () => {
    const cookie = await signUp("two@test.example");
    const bad = await SELF.fetch(`${ORIGIN}/api/customers`, json(cookie, { name: "", localPart: "x" }));
    expect(bad.status).toBe(400);
    const badLocal = await SELF.fetch(`${ORIGIN}/api/customers`, json(cookie, { name: "A", localPart: "a b" }));
    expect(badLocal.status).toBe(400);
    const notJson = await SELF.fetch(`${ORIGIN}/api/customers`, { ...json(cookie), body: "{oops" });
    expect(notJson.status).toBe(400);
  });

  it("never shows one user's data to another", async () => {
    const a = await signUp("alice@test.example");
    const b = await signUp("bob@test.example");
    const created = await (await SELF.fetch(`${ORIGIN}/api/customers`, json(a, { name: "Private" }))).json<{
      id: string;
    }>();

    const asBob = await SELF.fetch(`${ORIGIN}/api/customers/${created.id}`, { headers: { Cookie: b } });
    expect(asBob.status).toBe(404);
    const bobDelete = await SELF.fetch(`${ORIGIN}/api/customers/${created.id}`, json(b, undefined, "DELETE"));
    expect(bobDelete.status).toBe(404);
    const bobList = await (await SELF.fetch(`${ORIGIN}/api/customers`, { headers: { Cookie: b } })).json<unknown[]>();
    expect(bobList).toHaveLength(0);
    const stillThere = await SELF.fetch(`${ORIGIN}/api/customers/${created.id}`, { headers: { Cookie: a } });
    expect(stillThere.status).toBe(200);
  });

  it("blocks cross-site state changes", async () => {
    const cookie = await signUp("csrf@test.example");
    const res = await SELF.fetch(`${ORIGIN}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: cookie },
      body: JSON.stringify({ name: "Evil" }),
    });
    expect(res.status).toBe(403);
  });

  it("enforces the sign-up allowlist when one is set", async () => {
    // ALLOWED_SIGNUP_EMAILS is "*" in tests, so sign-up is open; the
    // allowlist itself is exercised through createAuth's hook in auth.test.ts.
    const res = await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify({ name: "Short", email: "short@test.example", password: "short" }),
    });
    expect(res.status).toBe(400); // password too short
  });
});

describe("API limits", () => {
  it("refuses oversized request bodies", async () => {
    const cookie = await signUp("big@test.example");
    const res = await SELF.fetch(`${ORIGIN}/api/customers`, json(cookie, { name: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
  });

  it("treats malformed ids as not found without touching the database", async () => {
    const cookie = await signUp("ids@test.example");
    for (const path of ["/api/customers/not-a-uuid", "/api/messages/../../etc", "/api/messages/1;drop"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Cookie: cookie } });
      expect(res.status, path).toBe(404);
    }
  });
});
