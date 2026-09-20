import { describe, expect, it } from "vitest";
import { isValidLocalPart, suggestLocalPart, withSuffix, LOCAL_PART_MAX } from "../shared/address";

describe("suggestLocalPart", () => {
  it("joins first name and the rest with a dot", () => {
    expect(suggestLocalPart("Ahmad Al Sayed")).toBe("ahmad.alsayed");
    expect(suggestLocalPart("  Sara   Khan ")).toBe("sara.khan");
  });
  it("handles a single word", () => {
    expect(suggestLocalPart("Madonna")).toBe("madonna");
  });
  it("drops punctuation and accents", () => {
    expect(suggestLocalPart("José O'Neil-Smith")).toBe("jose.oneilsmith");
  });
  it("transliterates Arabic into Latin letters", () => {
    const out = suggestLocalPart("محمد علي");
    expect(out).toMatch(/^[a-z]+\.[a-z]+$/);
  });
  it("returns empty for names with nothing usable", () => {
    expect(suggestLocalPart("!!!")).toBe("");
    expect(suggestLocalPart("")).toBe("");
  });
  it("never exceeds the maximum length and never ends with a dot", () => {
    const out = suggestLocalPart("a".repeat(60) + " " + "b".repeat(60));
    expect(out.length).toBeLessThanOrEqual(LOCAL_PART_MAX);
    expect(out.endsWith(".")).toBe(false);
    expect(isValidLocalPart(out)).toBe(true);
  });
});

describe("isValidLocalPart", () => {
  it("accepts normal addresses", () => {
    expect(isValidLocalPart("ahmad.alsayed")).toBe(true);
    expect(isValidLocalPart("a-b_c.d9")).toBe(true);
  });
  it("rejects unsafe or malformed values", () => {
    for (const bad of ["", ".ahmad", "ahmad.", "ah..mad", "Ahmad", "ahmad sayed", "a@b", "a/b", "x".repeat(41)]) {
      expect(isValidLocalPart(bad), bad).toBe(false);
    }
  });
});

describe("withSuffix", () => {
  it("appends the number", () => {
    expect(withSuffix("ahmad.alsayed", 2)).toBe("ahmad.alsayed2");
  });
  it("keeps the result within the limit", () => {
    const out = withSuffix("a".repeat(LOCAL_PART_MAX), 12);
    expect(out.length).toBe(LOCAL_PART_MAX);
    expect(out.endsWith("12")).toBe(true);
  });
});
