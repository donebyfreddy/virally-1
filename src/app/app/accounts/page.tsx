import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Rule } from "@/components/primitives/Eyebrow";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Badge } from "@/components/primitives/Badge";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { AccountSlotCard } from "@/components/accounts/AccountSlotCard";
import { EmptySlotTile } from "@/components/accounts/EmptySlotTile";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { loadAccountNetwork } from "@/lib/accounts/data";
import { capacityNotice, slotsNeedingAttention, usageSummary } from "@/lib/accounts/slots";
import {
  PLATFORM_LABELS,
  accountErrors,
  accountsPage,
  authorisationBoundary,
  creationBoundary,
  launchKitPage,
  slotActions,
} from "@/content/accounts";
import {
  PLATFORM_REQUIREMENTS,
  allAdapterAvailability,
  availabilityLabel,
} from "@/providers/social/adapter";
import type { Platform } from "@/types/database";

export const metadata: Metadata = {
  title: "Accounts",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SECTION_HEADING =
  "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]";

/**
 * The account network.
 *
 * The compliance surface, and the one screen where the slot/account distinction has
 * to be unmistakable. Two things are load-bearing:
 *
 *   - Occupied slots and empty slots are drawn by different components with
 *     different structures, so the grid never reads as "ten accounts".
 *   - Every connector reports its real state. With no platform credentials
 *     configured that state is "Configuration required" naming the exact missing
 *     variables, and no connect button is rendered — one that looked live and failed
 *     on click would be the dishonest option.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  if (session.status === "anonymous") redirect(signInPathFor("/app/accounts"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  const { context } = resolution;
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  const preparedRaw = Array.isArray(params.prepared) ? params.prepared[0] : params.prepared;
  const preparedSlot = Number(preparedRaw);

  const network = await loadAccountNetwork(context);
  const availability = allAdapterAvailability();
  const mayConnect = can(context.role, "accounts.connect");

  const capacity = capacityNotice(network.usage);
  const attention = slotsNeedingAttention(network.grid);

  return (
    <AppPage>
      <PageHeader
        title={accountsPage.heading}
        description={accountsPage.intro}
        meta={[usageSummary(network.usage)]}
        actions={
          mayConnect && network.usage.availableSlots > 0 ? (
            <ButtonLink href="/app/accounts/launch" variant="primary">
              {slotActions.prepare}
            </ButtonLink>
          ) : undefined
        }
      />

      {/* Compliance copy, quoted verbatim from the design reference. Not a
          tooltip, not truncated, and asserted by an e2e test — so it stays
          outside PageHeader's description slot, which truncates by measure. */}
      <p className="prose-measure mt-[var(--space-4)] text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
        {authorisationBoundary}
      </p>

      {/* Notices, most urgent first. */}
      <div className="mt-[var(--space-6)] flex max-w-[46rem] flex-col gap-[var(--space-3)]">
        {errorCode && accountErrors[errorCode] ? (
          <AuthMessage tone="error" body={accountErrors[errorCode]} />
        ) : null}
        {Number.isFinite(preparedSlot) && preparedSlot > 0 ? (
          <AuthMessage tone="success" body={launchKitPage.preparedNotice(preparedSlot)} />
        ) : null}
        {network.usageUnavailable ? (
          <AuthMessage tone="notice" body={accountsPage.usageUnavailable} />
        ) : null}
        {capacity ? <AuthMessage tone="notice" body={capacity} /> : null}
        {!mayConnect ? <AuthMessage tone="notice" body={accountsPage.readOnlyNotice} /> : null}
      </div>

      <Rule className="my-10" />

      <section aria-labelledby="slots">
        <h2 id="slots" className={SECTION_HEADING}>
          {accountsPage.slotsHeading}
        </h2>

        <p className="prose-measure mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          {creationBoundary}
        </p>

        {network.grid.length === 0 ? (
          <p className="prose-measure mt-6 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
            {accountsPage.emptyNetwork}
          </p>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            {network.grid.map((slot, index) =>
              slot.kind === "occupied" ? (
                <AccountSlotCard key={slot.id} slot={slot} index={index} />
              ) : (
                <EmptySlotTile
                  key={`empty-${slot.previewNumber}`}
                  previewNumber={slot.previewNumber}
                  canClaim={mayConnect}
                  index={index}
                />
              ),
            )}
          </ul>
        )}
      </section>

      {attention.length > 0 ? (
        <>
          <Rule className="my-10" />
          <section aria-labelledby="attention">
            <h2 id="attention" className={SECTION_HEADING}>
              {accountsPage.attentionHeading}
            </h2>
            {/* A list, not a repeat of the cards: the same information twice in the
                same layout is what makes a screen feel padded. */}
            <ul className="mt-4 flex flex-col gap-2">
              {attention.map((slot) => (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[length:var(--text-body-s)]"
                >
                  <span className="font-utility text-[length:var(--text-utility)] tabular-nums text-[color:var(--color-text-muted)]">
                    {String(slot.slotNumber).padStart(2, "0")}
                  </span>
                  <span className="text-[color:var(--color-text-secondary)]">
                    {PLATFORM_LABELS[slot.platform]}
                    {slot.displayLabel ? ` · ${slot.displayLabel}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {network.unslotted.length > 0 ? (
        <>
          <Rule className="my-10" />
          <section aria-labelledby="unslotted">
            <h2 id="unslotted" className={SECTION_HEADING}>
              {accountsPage.unslottedHeading}
            </h2>
            <p className="prose-measure mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
              {accountsPage.unslottedIntro}
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {network.unslotted.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center gap-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]"
                >
                  <span>
                    {account.displayName ?? account.username ?? "Unnamed account"} ·{" "}
                    {PLATFORM_LABELS[account.platform]}
                  </span>
                  <Badge tone={account.health === "healthy" ? "signal" : "warning"}>
                    {account.health.replace(/_/g, " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {network.archived.length > 0 ? (
        <>
          <Rule className="my-10" />
          <section aria-labelledby="archived">
            <h2 id="archived" className={SECTION_HEADING}>
              {accountsPage.archivedHeading}
            </h2>
            <p className="prose-measure mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
              {accountsPage.archivedIntro}
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {network.archived.map((slot) => (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-baseline gap-x-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]"
                >
                  <span className="font-utility text-[length:var(--text-utility)] tabular-nums">
                    {String(slot.slotNumber).padStart(2, "0")}
                  </span>
                  <span>
                    {PLATFORM_LABELS[slot.platform]}
                    {slot.displayLabel ? ` · ${slot.displayLabel}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      <Rule className="my-10" />

      <section aria-labelledby="available">
        <h2 id="available" className={SECTION_HEADING}>
          Platforms
        </h2>

        <ul className="mt-6 flex flex-col gap-3">
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => {
            const state = availability[platform];
            const requirement = PLATFORM_REQUIREMENTS[platform];
            return (
              <li
                key={platform}
                className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                    {PLATFORM_LABELS[platform]}
                  </p>
                  <Badge tone={state.state === "available" ? "signal" : "warning"}>
                    {availabilityLabel(state)}
                  </Badge>
                </div>

                {/* The exact reason, not a generic unavailable message. */}
                {state.state === "configuration_required" && (
                  <p className="text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                    Missing environment variables:{" "}
                    <code className="font-utility">{state.missingEnv.join(", ")}</code>
                  </p>
                )}
                {state.state === "adapter_not_implemented" && (
                  <p className="text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                    {state.detail}
                  </p>
                )}

                {/* Platform approval requirements, stated before a user invests in
                    setting the connector up rather than after their first failure. */}
                <p className="prose-measure text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                  {requirement.approval}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </AppPage>
  );
}
