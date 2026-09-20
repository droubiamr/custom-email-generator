/**
 * Builds a safe LIKE pattern for a "contains" search. The user's text is
 * passed as a bound parameter (never pasted into SQL), and the LIKE
 * wildcards % and _ inside it are escaped so "100%" searches for a literal
 * percent sign. Queries must add `ESCAPE '\'`.
 */
export function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

/**
 * True when an insert failed because of a UNIQUE index. Drizzle wraps the
 * database error in its own error with the original in `cause`, so we walk
 * the chain instead of looking only at the top message.
 */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e; depth++) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed/i.test(msg)) return true;
    e = e instanceof Error ? e.cause : undefined;
  }
  return false;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True for a well-formed UUID. Every id this app creates is one. */
export function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * D1 allows at most 100 bound parameters per statement. Multi-row inserts
 * must therefore be split: `chunk(rows, 10)` with a 7-column table stays
 * safely under the limit.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
