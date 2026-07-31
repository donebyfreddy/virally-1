import { redirect } from "next/navigation";
import { and, count, eq, isNull } from "drizzle-orm";
import { AppShell } from "@/components/app-shell/AppShell";
import { ConfigurationNotice } from "@/components/auth/ConfigurationNotice";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { SkipLink } from "@/components/primitives/SkipLink";
import { PRODUCT_HOME, signInPathFor } from "@/lib/auth/routes";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema.fragment";
import { readBalance } from "@/lib/creative/credits";
import { tenantScope } from "@/lib/creative/scope";

/**
 * Never prerender an authenticated surface.
 *
 * Without this, a build run without Supabase credentials resolves the session
 * check to "unconfigured" and bakes that page into the static output — so the
 * deployed app would serve a configuration notice to signed-in users.
 */
export const dynamic = "force-dynamic";

/**
 * Protected product layout.
 *
 * Four outcomes, each handled explicitly rather than collapsing into one error:
 *   unconfigured   → name the missing env vars (a redirect would loop, because the
 *                    sign-in page cannot work either)
 *   anonymous      → redirect to sign-in, preserving the destination
 *   schema missing → say so and name the command, rather than failing opaquely
 *   onboarding due → send the user to onboarding instead of an empty dashboard
 */
export default async function ProductLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await readSession();

  if (session.status === "unconfigured") {
    return <Standalone><ConfigurationNotice /></Standalone>;
  }

  if (session.status === "anonymous") {
    redirect(signInPathFor(PRODUCT_HOME));
  }

  const resolution = await resolveTenantContext(session.user);

  if (resolution.status === "failed") {
    return (
      <Standalone>
        <AuthMessage
          tone="error"
          title="Workspace could not be loaded"
          body="Your account is signed in, but the workspace behind it could not be read. Nothing has been changed. Reload to retry — if this persists the database is unreachable."
        />
      </Standalone>
    );
  }

  if (resolution.status === "needs_bootstrap" || !resolution.context.onboardingComplete) {
    redirect("/onboarding");
  }

  // Two cheap aggregates rather than subscriptions: the shell renders on every
  // navigation, so count queries are the right cost. Run concurrently because
  // neither depends on the other — sequentially they would add both round trips
  // to every page load in the product.
  //
  // The credit balance is here rather than on each page because the top bar shows
  // it everywhere: every generation action spends credits, so "can I afford this?"
  // must be answerable without navigating to Usage.
  const [[unread], balance] = await Promise.all([
    db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, resolution.context.user.id), isNull(notifications.readAt)),
      ),
    readBalance(
      tenantScope(resolution.context.organizationId, resolution.context.workspaceId),
    ),
  ]);

  return (
    <AppShell
      context={resolution.context}
      unreadNotifications={unread?.value ?? 0}
      creditsAvailable={balance.available}
      creditsReserved={balance.reserved}
    >
      {children}
    </AppShell>
  );
}

/**
 * Layout for the states that render without a shell, since there is no tenant.
 *
 * Carries `theme-app` even though it has no sidebar or top bar. These are product
 * screens — the user is signed in and something went wrong behind the shell — so
 * rendering them on the marketing site's near-black canvas would flip the whole
 * page to a different design system at exactly the moment the user is trying to
 * work out whether the product is broken.
 */
function Standalone({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-app min-h-dvh">
      <SkipLink />
      <main
        id="main"
        className="mx-auto flex min-h-dvh max-w-[var(--container-text)] flex-col justify-center px-[var(--app-gutter)] py-24"
      >
        {children}
      </main>
    </div>
  );
}
