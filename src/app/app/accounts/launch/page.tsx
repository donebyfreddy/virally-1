import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eyebrow, Rule } from "@/components/primitives/Eyebrow";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { LaunchKitForm } from "@/components/accounts/LaunchKitForm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { loadAccountNetwork } from "@/lib/accounts/data";
import { capacityNotice } from "@/lib/accounts/slots";
import { isMockOnly } from "@/lib/ai/registry";
import {
  accountErrors,
  accountsPage,
  authorisationBoundary,
  creationBoundary,
  launchPage,
} from "@/content/accounts";

export const metadata: Metadata = {
  title: "Prepare account",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Prepare an account.
 *
 * Three gates before the form renders, in this order: permission, then capacity,
 * then nothing else. Capacity is checked here so a user is told before filling in
 * eight fields, and again by the trigger in 0015 when they submit — the check here
 * is courtesy, the one in the database is the rule.
 *
 * Opening this page consumes nothing. The slot is claimed on submit, which is what
 * makes "a slot must not be consumed by starting and cancelling the form" true.
 */
export default async function LaunchAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  if (session.status === "anonymous") redirect(signInPathFor("/app/accounts/launch"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  const { context } = resolution;
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;

  // Server-side gate, not just a hidden button on the previous screen.
  if (!can(context.role, "accounts.connect")) {
    return (
      <div className="mx-auto w-full max-w-[var(--container-text)] px-[var(--gutter)] py-16">
        <AuthMessage tone="notice" body={accountsPage.readOnlyNotice} />
        <div className="mt-6">
          <ButtonLink href="/app/accounts" variant="secondary">
            {launchPage.back}
          </ButtonLink>
        </div>
      </div>
    );
  }

  const network = await loadAccountNetwork(context);
  const capacity = capacityNotice(network.usage);

  return (
    <div className="mx-auto w-full max-w-[var(--container-text)] px-[var(--gutter)] py-12">
      <header>
        <Eyebrow>{launchPage.eyebrow}</Eyebrow>
        <h1 className="font-display mt-3 text-[length:var(--text-display-m)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          {launchPage.heading}
        </h1>
        <p className="prose-measure mt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
          {launchPage.intro}
        </p>
        <p className="prose-measure mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          {creationBoundary}
        </p>
        <p className="prose-measure mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          {authorisationBoundary}
        </p>
      </header>

      <div className="mt-6 flex flex-col gap-3">
        {errorCode && accountErrors[errorCode] ? (
          <AuthMessage tone="error" body={accountErrors[errorCode]} />
        ) : null}
        {/* Generated material must be labelled when it comes from the mock provider,
            the same rule every other generation surface follows. */}
        {isMockOnly() ? (
          <AuthMessage
            tone="notice"
            body="No generation provider is configured, so this launch kit will be deterministic demo material, labelled as such."
          />
        ) : null}
      </div>

      <Rule className="my-8" />

      {capacity ? (
        <>
          <AuthMessage tone="notice" body={capacity} />
          <div className="mt-6">
            <ButtonLink href="/app/accounts" variant="secondary">
              {launchPage.back}
            </ButtonLink>
          </div>
        </>
      ) : (
        <>
          <p className="prose-measure font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            {launchPage.consumesSlot}
          </p>
          <LaunchKitForm
            brands={context.brands.map((brand) => ({ id: brand.id, name: brand.name }))}
            defaultBrandId={context.brandId}
            defaultLanguage="en"
          />
          <div className="mt-8">
            <ButtonLink href="/app/accounts" variant="text">
              {launchPage.back}
            </ButtonLink>
          </div>
        </>
      )}
    </div>
  );
}
