/**
 * Better Auth's browser client. It talks to /api/auth on the same origin,
 * so no base URL is needed. `useSession` is a React hook that knows whether
 * someone is signed in.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { useSession, signIn, signUp, signOut } = authClient;
