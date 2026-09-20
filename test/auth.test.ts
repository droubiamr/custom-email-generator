import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createAuth } from "../worker/auth";

describe("sign-up allowlist", () => {
  it("is closed when the secret is missing or empty", async () => {
    for (const value of ["", "   "]) {
      const auth = createAuth({ ...env, ALLOWED_SIGNUP_EMAILS: value });
      await expect(
        auth.api.signUpEmail({
          body: { name: "X", email: `closed${value.length}@test.example`, password: "a-long-test-password" },
        }),
      ).rejects.toMatchObject({ status: "FORBIDDEN" });
    }
  });

  it("refuses emails that are not on the list", async () => {
    const auth = createAuth({ ...env, ALLOWED_SIGNUP_EMAILS: "owner@test.example" });
    await expect(
      auth.api.signUpEmail({
        body: { name: "X", email: "stranger@test.example", password: "a-long-test-password" },
      }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("accepts a listed email regardless of case", async () => {
    const auth = createAuth({ ...env, ALLOWED_SIGNUP_EMAILS: "owner@test.example" });
    const res = await auth.api.signUpEmail({
      body: { name: "Owner", email: "Owner@Test.example", password: "a-long-test-password" },
    });
    expect(res.user.email.toLowerCase()).toBe("owner@test.example");
  });
});
