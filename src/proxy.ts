import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isAppConfigured } from "@/lib/env";
import {
  PRODUCT_HOME,
  isProtectedPath,
  isSignedInForbiddenPath,
  safeNextPath,
  signInPathFor,
  NEXT_PARAM,
} from "@/lib/auth/routes";

/**
 * Route protection fast-path.
 *
 * Next 16 renamed the `middleware` convention to `proxy`; `middleware.ts` still
 * works but logs a deprecation warning on every build.
 *
 * `getSessionCookie` only checks that a plausibly-signed session cookie is
 * present — it does not verify it against the database, so this is a fast
 * fail, not the security boundary: every protected layout re-checks
 * server-side via `auth.api.getSession()` (src/lib/auth/session.ts), and every
 * query additionally guards itself via src/lib/db/authorization.ts. A
 * proxy-only guard is bypassable and is never trusted alone.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Marketing routes must keep working with no database attached, so a
  // missing configuration never breaks navigation. Protected routes are
  // instead handled by their layout, which renders an actionable
  // configuration state.
  if (!isAppConfigured()) {
    return NextResponse.next({ request });
  }

  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    const [targetPath, targetQuery] = signInPathFor(`${pathname}${search}`).split("?");
    url.pathname = targetPath ?? "/auth/sign-in";
    url.search = targetQuery ? `?${targetQuery}` : "";
    return NextResponse.redirect(url);
  }

  if (sessionCookie && isSignedInForbiddenPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = safeNextPath(request.nextUrl.searchParams.get(NEXT_PARAM), PRODUCT_HOME);
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}

export const config = {
  /**
   * Skips Next internals, the auth API routes (which must run their own code
   * exchange without a redirect racing it) and static assets. Every skipped
   * path either owns its own session handling or has no session to refresh.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|opengraph-image|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp4|webm|woff2?)$).*)",
  ],
};
