/**
 * Route policy for the authenticated product.
 *
 * Kept as pure data + pure functions with no Next or Supabase imports, so the
 * same policy is used by `src/proxy.ts`, by server components and by unit
 * tests. Two implementations of "is this route protected?" would eventually
 * disagree, and the disagreement would be a security hole.
 */

/** Where an authenticated session lands. */
export const PRODUCT_HOME = "/app";

/** Where an anonymous visitor is sent to authenticate. */
export const SIGN_IN_PATH = "/auth/sign-in";

/** Query parameter carrying the originally requested path across a sign-in. */
export const NEXT_PARAM = "next";

/** Prefixes that require an authenticated session. */
const PROTECTED_PREFIXES = ["/app", "/onboarding"] as const;

/**
 * Auth pages an already-signed-in user should be bounced away from.
 *
 * `/auth/update-password` is deliberately absent: a password reset link creates
 * a real session before the user sets the new password, so bouncing it would
 * make password recovery impossible.
 */
const SIGNED_IN_FORBIDDEN = [
  "/auth/sign-in",
  "/auth/sign-up",
  "/auth/forgot-password",
] as const;

function normalise(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }
  return pathname;
}

export function isProtectedPath(pathname: string): boolean {
  const path = normalise(pathname);
  return PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isSignedInForbiddenPath(pathname: string): boolean {
  return SIGNED_IN_FORBIDDEN.includes(
    normalise(pathname) as (typeof SIGNED_IN_FORBIDDEN)[number],
  );
}

/**
 * True when the string contains an ASCII control character or DEL.
 *
 * Written as a code-point scan rather than a regex literal: `\t`, `\n` and
 * `\r` inside a character class are easy to corrupt in transit, and a silently
 * broken check here would reopen the redirect hole it exists to close.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validates a caller-supplied post-authentication destination.
 *
 * An unvalidated `?next=` is an open redirect: it turns our own sign-in page
 * into a credible launchpad for a phishing site. Only same-origin absolute
 * paths survive.
 *
 * Rejected: absolute URLs, protocol-relative `//evil.com`, backslash variants
 * that some browsers normalise to `//`, control characters used to smuggle a
 * scheme past a prefix check, and anything not starting with a single `/`.
 */
export function safeNextPath(
  candidate: string | null | undefined,
  fallback: string = PRODUCT_HOME,
): string {
  if (!candidate) return fallback;

  const value = candidate.trim();
  if (value === "") return fallback;
  if (hasControlCharacter(value)) return fallback;

  if (!value.startsWith("/")) return fallback;
  // `//host` and `/\host` both resolve to a foreign origin.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;

  // Never bounce a freshly authenticated user back onto an auth page.
  const pathOnly = value.split(/[?#]/)[0] ?? "";
  if (pathOnly.startsWith("/auth/")) return fallback;

  return value;
}

/** Builds the sign-in URL that preserves where the visitor was heading. */
export function signInPathFor(requestedPath: string): string {
  const next = safeNextPath(requestedPath, PRODUCT_HOME);
  if (next === PRODUCT_HOME) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?${NEXT_PARAM}=${encodeURIComponent(next)}`;
}
