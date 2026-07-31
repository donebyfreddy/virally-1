import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { loadAccountNetwork } from "@/lib/accounts/data";
import { capacityNotice } from "@/lib/accounts/slots";
import { isMockOnly } from "@/lib/ai/registry";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { LaunchKitForm } from "@/components/accounts/LaunchKitForm";
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
 *
 * `width="text"` rather than the dashboard column: this is one form read top to
 * bottom, and an eight-field entry surface stretched across 1536px puts the label
 * and its input at opposite ends of the screen.
 */
export default async function LaunchAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/accounts/launch"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage = errorCode ? accountErrors[errorCode] ?? null : null;

  // Server-side gate, not just a hidden button on the previous screen.
  if (!can(context.role, "accounts.connect")) {
    return (
      <AppPage width="text">
        <PageStack>
          <AuthMessage tone="notice" body={accountsPage.readOnlyNotice} />
          <div>
            <ButtonLink href="/app/accounts" variant="secondary">
              {launchPage.back}
            </ButtonLink>
          </div>
        </PageStack>
      </AppPage>
    );
  }

  const network = await loadAccountNetwork(context);
  const capacity = capacityNotice(network.usage);

  return (
    <AppPage width="text">
      <PageStack>
        <PageHeader
          title={launchPage.heading}
          description={launchPage.intro}
          actions={
            <ButtonLink href="/app/accounts" variant="text">
              {launchPage.back}
            </ButtonLink>
          }
        />

        {/* Both compliance statements, verbatim. On the one screen where a user is
            about to ask Virally to "make an account", they are the point. */}
        <p className="max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
          {creationBoundary} {authorisationBoundary}
        </p>

        {(errorMessage || isMockOnly()) && (
          <div className="flex flex-col gap-[var(--space-3)]">
            {errorMessage && <AuthMessage tone="error" body={errorMessage} />}
            {/* Generated material must be labelled when it comes from the mock
                provider, the same rule every other generation surface follows. */}
            {isMockOnly() && <AuthMessage tone="notice" body={launchPage.mockNotice} />}
          </div>
        )}

        {capacity ? (
          <>
            <AuthMessage tone="notice" body={capacity} />
            <div>
              <ButtonLink href="/app/accounts" variant="secondary">
                {launchPage.back}
              </ButtonLink>
            </div>
          </>
        ) : (
          <Card>
            <CardHeader
              as="h2"
              title={launchPage.formHeading}
              description={launchPage.consumesSlot}
              divided
            />
            <CardBody>
              <LaunchKitForm
                brands={context.brands.map((brand) => ({ id: brand.id, name: brand.name }))}
                defaultBrandId={context.brandId}
                defaultLanguage="en"
              />
            </CardBody>
          </Card>
        )}
      </PageStack>
    </AppPage>
  );
}
