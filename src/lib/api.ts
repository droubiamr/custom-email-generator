/**
 * Tiny wrapper around fetch for our own API. It always sends the session
 * cookie, sends JSON, and turns error responses into a thrown ApiError so
 * calling code can `try/catch` instead of checking status codes.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: {
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(headers ?? {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 401 && !location.pathname.startsWith("/login") && !location.pathname.startsWith("/signup")) {
    // The session expired or was signed out elsewhere: go back to sign-in.
    location.assign(`/login`);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : res.statusText;
    throw new ApiError(res.status, message);
  }
  return body as T;
}
