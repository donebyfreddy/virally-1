import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { SkipLink } from "@/components/primitives/SkipLink";
import { cn } from "@/lib/cn";
import { onboardingCopy } from "@/content/onboarding";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Workspace ready",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The completion beat.
 *
 * A short, staggered confirmation and a single way forward. No confetti, per the
 * brief — and the transition is CSS-only, so it costs no JavaScript and renders in
 * its final state under reduced motion without a second code path.
 *
 * Not an auto-redirect: yanking the page away mid-sentence is worse than one click,
 * and a user who wants to read what was configured should be able to.
 */
export default async function OnboardingCompletePage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  if (session.status === "anonymous") redirect(signInPathFor("/app"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  // Reaching this page without having completed onboarding means someone typed the
  // URL; send them back to finish rather than implying setup is done.
  if (!resolution.context.onboardingComplete) redirect("/onboarding");

  return (
    <>
      <SkipLink />
      <main
        id="main"
        className="mx-auto flex min-h-dvh w-full max-w-[var(--container-text)] flex-col justify-center px-[var(--gutter)] py-24"
      >
        <Eyebrow>SETUP COMPLETE</Eyebrow>
        <h1 className="font-display mt-3 text-[length:var(--text-display-m)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          {onboardingCopy.completion.heading}
        </h1>

        <ul className="mt-10 flex flex-col gap-3">
          {onboardingCopy.completion.items.map((item, index) => (
            <li
              key={item}
              className={cn(
                "flex items-center gap-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]",
                "motion-safe:animate-[virally-stage-in_var(--dur-panel)_var(--ease-settle)_backwards]",
              )}
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <span aria-hidden="true" className="font-utility text-[color:var(--color-success)]">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-12">
          <ButtonLink href="/app" size="lg">
            {onboardingCopy.completion.cta}
          </ButtonLink>
        </div>

        <p className="mt-8 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          {/* Sets the expectation before the dashboard is seen: it is empty because
              nothing has run yet, not because something failed. */}
          Your dashboard has no performance data yet. It fills in once content is
          published to a connected account.
        </p>
      </main>
    </>
  );
}
