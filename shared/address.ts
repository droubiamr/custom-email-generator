/**
 * Turns a customer's name into the part of an email address before the "@".
 * Shared by the browser (to preview) and the Worker (to validate).
 *
 * "Ahmad Al Sayed"  -> "ahmad.alsayed"
 * "محمد علي"        -> "mhmd.aly" (transliterated, user can edit)
 */
import { transliterate } from "transliteration";

export const LOCAL_PART_MAX = 40;
// Letters, digits, with single dots/dashes/underscores between groups.
export const LOCAL_PART_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function suggestLocalPart(name: string): string {
  const words = transliterate(name)
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  // First word, then the rest joined without spaces: "ahmad" + "alsayed".
  const [first, ...rest] = words;
  const candidate = rest.length ? `${first}.${rest.join("")}` : first;
  return candidate.slice(0, LOCAL_PART_MAX).replace(/[._-]+$/, "");
}

export function isValidLocalPart(value: string): boolean {
  return value.length > 0 && value.length <= LOCAL_PART_MAX && LOCAL_PART_RE.test(value);
}

/** "ahmad.alsayed" + 2 -> "ahmad.alsayed2" (used when the address is taken). */
export function withSuffix(localPart: string, n: number): string {
  const suffix = String(n);
  return `${localPart.slice(0, LOCAL_PART_MAX - suffix.length)}${suffix}`;
}
