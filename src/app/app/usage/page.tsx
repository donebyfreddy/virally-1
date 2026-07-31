import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel } from "@/components/app-ui/Panel";
import { Progress } from "@/components/app-ui/Progress";
import { EmptyState } from "@/components/app-ui/States";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { usageCopy } from "@/content/usage";
import { readSession } from "@/lib/auth/session";
import { signInPathFor } from "@/lib/auth/routes";
import { isMagnificConfigured } from "@/lib/creative";
import { tenantScope } from "@/lib/creative/scope";
import { ledgerReasonLabel, readUsageSummary } from "@/lib/creative/usage";
import { can } from "@/lib/permissions";
import { resolveTenantContext } from "@/lib/tenant/context";

export const metadata: Metadata = {
  title: "Usage",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Usage.
 *
 * Every figure is read from the append-only ledger and from `provider_runs`, so
 * a number here can always be traced to the rows that produced it. No mutable
 * counter is consulted and none exists.
 *
 * Internal provider cost is deliberately absent. It is our margin, not the
 * customer's price — see the header of src/lib/creative/usage.ts.
 */
export default async function UsagePage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  if (session.status === "anonymous") redirect(signInPathFor("/app/usage"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");
  const { context } = resolution;

  // Server-side gate. Usage exposes spend, which is billing information —
  // hiding the nav item is not authorisation.
  if (!can(context.role, "billing.view")) {
    return (
      <AppPage width="text">
        <AuthMessage
          tone="notice"
          title="NOT AVAILABLE TO YOUR ROLE"
          body="Viewing usage and spend requires the billing.view permission. Your role can create and review content, but not see billing. An administrator can change this from the Team page."
        />
      </AppPage>
    );
  }

  const summary = await readUsageSummary(
    tenantScope(context.organizationId, context.workspaceId),
  );

  const { balance } = summary;
  const included = balance.granted;
  // Guarded: an organisation with no grant yet would divide by zero and render
  // NaN% inside the bar.
  const usedPercent = included > 0 ? Math.min(100, (balance.used / included) * 100) : 0;

  return (
    <AppPage>
      <PageHeader
        eyebrow={usageCopy.eyebrow}
        title={usageCopy.heading}
        description={usageCopy.body}
        meta={[
          context.workspaceName,
          `Period from ${summary.period.start.toISOString().slice(0, 10)}`,
        ]}
      />

      {!isMagnificConfigured() && (
        <div className="mt-[var(--space-8)] max-w-[46rem]">
          <AuthMessage
            tone="notice"
            title={usageCopy.unmeteredTitle}
            body={usageCopy.unmeteredBody}
          />
        </div>
      )}

      {/* Four related figures together: "available" alone does not answer why
          the balance is lower than the user expected. */}
      <div className="mt-[var(--space-8)] grid gap-[var(--space-4)] sm:grid-cols-2 xl:grid-cols-4">
        <Figure label={usageCopy.availableLabel} value={balance.available} />
        <Figure label={usageCopy.reservedLabel} value={balance.reserved} />
        <Figure label={usageCopy.usedLabel} value={summary.usedThisPeriod} />
        <Figure label={usageCopy.includedLabel} value={summary.grantedThisPeriod} />
      </div>

      {included > 0 && (
        <Panel className="mt-[var(--space-4)]">
          <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
            <h2 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
              {usageCopy.consumptionHeading}
            </h2>
            <p className="font-utility text-[length:var(--text-app-meta)] tabular-nums text-[color:var(--color-text-muted)]">
              {balance.used.toLocaleString("en-US")} / {included.toLocaleString("en-US")}
            </p>
          </div>
          <div className="mt-[var(--space-3)]">
            <Progress percent={usedPercent} label={usageCopy.consumptionHeading} />
          </div>
        </Panel>
      )}

      {/* Rendered only when credits are actually held. This answers "why is my
          balance lower than I expected"; an always-present empty section would
          be a dead region on every other visit. */}
      {summary.activeReservations.length > 0 && (
        <Panel className="mt-[var(--space-4)]">
          <h2 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
            {usageCopy.reservationsHeading}
          </h2>
          <p className="mt-[var(--space-2)] max-w-[60ch] text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
            {usageCopy.reservationsHint}
          </p>
          <ul className="mt-[var(--space-4)] flex flex-col">
            {summary.activeReservations.map((reservation) => (
              <li
                key={reservation.id}
                className="flex min-h-11 items-center justify-between gap-[var(--space-4)] border-t border-[var(--color-border-hairline)] py-[var(--space-3)]"
              >
                <span className="min-w-0">
                  <span className="block text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
                    {usageCopy.purposeLabels[reservation.purpose] ?? reservation.purpose}
                  </span>
                  <span className="block font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                    Expires {reservation.expiresAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </span>
                <span className="shrink-0 font-utility text-[length:var(--text-app-cell)] tabular-nums text-[color:var(--color-text-primary)]">
                  {reservation.credits.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel className="mt-[var(--space-4)]">
        <h2 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
          {usageCopy.generationsHeading}
        </h2>

        {summary.generations.length === 0 ? (
          <div className="mt-[var(--space-4)]">
            <EmptyState title={usageCopy.noGenerationsTitle} body={usageCopy.noGenerationsBody} />
          </div>
        ) : (
          <ul className="mt-[var(--space-4)] flex flex-col">
            {summary.generations.map((row) => (
              <li
                key={row.kind}
                className="flex min-h-11 flex-wrap items-center justify-between gap-[var(--space-4)] border-t border-[var(--color-border-hairline)] py-[var(--space-3)]"
              >
                <span className="text-[length:var(--text-app-cell)] capitalize text-[color:var(--color-text-primary)]">
                  {row.kind}
                </span>
                {/* Real run states from the database, not a computed success
                    rate — a percentage would hide that three runs are stuck. */}
                <span className="flex gap-[var(--space-4)] font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                  <span>{row.completed.toLocaleString("en-US")} done</span>
                  {row.inFlight > 0 && <span>{row.inFlight.toLocaleString("en-US")} running</span>}
                  {row.failed > 0 && (
                    <span className="text-[color:var(--color-error)]">
                      {row.failed.toLocaleString("en-US")} failed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* The ledger itself, because the balance above is a sum of exactly these
          rows and a user who disputes a figure needs to see them. */}
      <Panel className="mt-[var(--space-4)]">
        <h2 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
          {usageCopy.ledgerHeading}
        </h2>
        <p className="mt-[var(--space-2)] max-w-[60ch] text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
          {usageCopy.ledgerHint}
        </p>

        {summary.recentLedger.length === 0 ? (
          <div className="mt-[var(--space-4)]">
            <EmptyState title={usageCopy.noLedgerTitle} body={usageCopy.noLedgerBody} />
          </div>
        ) : (
          <ul className="mt-[var(--space-4)] flex flex-col">
            {summary.recentLedger.map((entry) => (
              <li
                key={entry.id}
                className="flex min-h-11 items-center justify-between gap-[var(--space-4)] border-t border-[var(--color-border-hairline)] py-[var(--space-3)]"
              >
                <span className="min-w-0">
                  <span className="block text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
                    {ledgerReasonLabel(entry.reason)}
                  </span>
                  <span className="block truncate font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                    {entry.occurredAt.toISOString().slice(0, 16).replace("T", " ")}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </span>
                </span>
                {/* The sign is carried by the glyph, not by colour alone, so
                    the direction survives a colour-vision difference. */}
                <span className="shrink-0 font-utility text-[length:var(--text-app-cell)] tabular-nums text-[color:var(--color-text-primary)]">
                  {entry.delta > 0 ? "+" : "−"}
                  {Math.abs(entry.delta).toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </AppPage>
  );
}

/** A single credit figure. Tabular so the value does not jitter as it changes. */
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <Panel>
      <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
        {label}
      </p>
      <p className="mt-[var(--space-2)] font-utility text-[length:var(--text-metric-l)] tabular-nums text-[color:var(--color-text-primary)]">
        {value.toLocaleString("en-US")}
      </p>
    </Panel>
  );
}
