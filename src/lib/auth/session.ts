import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAppConfigured } from "@/lib/env";
import { auth } from "@/lib/auth/better-auth";
import { signInPathFor } from "./routes";

/**
 * Server-side session access for protected routes.
 *
 * `src/proxy.ts` already redirects anonymous requests, but that is a fast
 * fail, not the boundary — the proxy only checks a signed cookie's presence.
 * Every protected surface verifies here too, via `auth.api.getSession()`,
 * which validates the session against the database. Every query
 * additionally guards itself via src/lib/db/authorization.ts, the third and
 * final layer (RLS's replacement).
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
};

export type SessionState =
  | { status: "authenticated"; user: SessionUser }
  | { status: "anonymous" }
  | { status: "unconfigured" };

/** Non-throwing read, for surfaces that render a configuration state instead. */
export async function readSession(): Promise<SessionState> {
  if (!isAppConfigured()) return { status: "unconfigured" };

  try {
    const result = await auth.api.getSession({ headers: await headers() });
    if (!result?.user) return { status: "anonymous" };
    return {
      status: "authenticated",
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        image: result.user.image ?? null,
      },
    };
  } catch {
    // A transport/database failure here should never grant access — fail
    // closed to a sign-in prompt rather than an error boundary.
    return { status: "anonymous" };
  }
}

/**
 * Returns the signed-in user or redirects to sign-in, preserving the requested
 * path so the user lands where they were going.
 */
export async function requireUser(requestedPath: string): Promise<SessionUser> {
  const session = await readSession();
  if (session.status === "authenticated") return session.user;
  redirect(signInPathFor(requestedPath));
}

/** Best available human name. Better Auth always populates `name` on sign-up. */
export function displayName(user: SessionUser): string | null {
  const trimmed = user.name.trim();
  if (trimmed !== "") return trimmed;
  const local = user.email.split("@")[0];
  return local && local.trim() !== "" ? local : null;
}
