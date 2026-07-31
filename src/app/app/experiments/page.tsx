import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import { campaigns, experiments } from "@/lib/db/schema.fragment";
import { relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel } from "@/components/app-ui/Panel";
import { EmptyState } from "@/components/app-ui/States";
import { Progress } from "@/components/app-ui/Progress";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { experimentsCopy, CONFIDENCE_PRESENTATION } from "@/content/experiments";

export const metadata: Metadata = {
  title: "Experiments",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const countFormatter = new Intl.NumberFormat("en-US");

/**
 * Experiments.
 *
 * The result language is deliberately cautious. `experiment_confidence` has a
 * value named `enough_observations`, not `significant` — the schema itself
 * refuses to claim statistical significance, and this page keeps that refusal:
 * it reports how many observations exist against the minimum the experiment was
 * configured for, and never declares a winner.
 */
export default async function ExperimentsPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/experiments"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;

  const rows = await db
    .select({
      id: experiments.id,
      name: experiments.name,
      hypothesis: experiments.hypothesis,
      variable: experiments.variable,
      primaryMetric: experiments.primaryMetric,
      status: experiments.status,
      confidenceState: experiments.confidenceState,
      confidenceNotes: experiments.confidenceNotes,
      outcomeSummary: experiments.outcomeSummary,
      minObservations: experiments.minObservations,
      startedAt: experiments.startedAt,
      concludedAt: experiments.concludedAt,
      updatedAt: experiments.updatedAt,
      campaignName: campaigns.name,
      variantCount: sql<number>`(
        select count(*)::int from experiment_variants ev where ev.experiment_id = ${experiments.id}
      )`,
    })
    .from(experiments)
    .leftJoin(campaigns, eq(experiments.campaignId, campaigns.id))
    .where(eq(experiments.workspaceId, context.workspaceId))
    .orderBy(desc(experiments.updatedAt))
    .limit(30);

  return (
    <AppPage>
      <PageHeader
        eyebrow={experimentsCopy.eyebrow}
        title={experimentsCopy.title}
        description={experimentsCopy.body}
        meta={[
          rows.length === 1 ? "1 experiment" : `${countFormatter.format(rows.length)} experiments`,
          context.workspaceName,
        ]}
      />

      {rows.length === 0 ? (
        <div className="mt-[var(--space-8)] max-w-[var(--measure-prose)]">
          <EmptyState
            title={experimentsCopy.empty.title}
            body={experimentsCopy.empty.body}
            actions={<ButtonLink href="/app/create">Create a campaign</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="mt-[var(--space-8)] flex flex-col gap-[var(--space-4)]">
          {rows.map((row) => {
            const presentation =
              CONFIDENCE_PRESENTATION[row.confidenceState] ?? CONFIDENCE_PRESENTATION.no_data;

            return (
              <li key={row.id}>
                {/* An experiment card is structurally its own thing: hypothesis
                    at the top, the variable under test in the middle, the result
                    state at the end. It shares tokens with other panels, not a
                    layout. */}
                <Panel>
                  <div className="flex flex-wrap items-start justify-between gap-[var(--space-4)]">
                    <div className="min-w-0">
                      <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                        {experimentsCopy.variableLabel(row.variable)}
                        {row.campaignName ? ` · ${row.campaignName}` : ""}
                      </p>
                      <h2 className="mt-[var(--space-1)] text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
                        {row.name}
                      </h2>
                    </div>

                    {/* Result state: icon plus word plus colour, never colour
                        alone. */}
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border px-2 py-1",
                        "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
                        presentation.classes,
                      )}
                    >
                      <span aria-hidden="true">{presentation.glyph}</span>
                      {presentation.label}
                    </span>
                  </div>

                  {row.hypothesis && (
                    <p className="prose-measure mt-[var(--space-4)] text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-secondary)]">
                      <span className="font-utility uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                        {experimentsCopy.hypothesisLabel}{" "}
                      </span>
                      {row.hypothesis}
                    </p>
                  )}

                  <dl className="mt-[var(--space-4)] grid gap-[var(--space-4)] sm:grid-cols-3">
                    <div>
                      <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                        Primary metric
                      </dt>
                      <dd className="mt-[var(--space-1)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-primary)]">
                        {row.primaryMetric}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                        Variants
                      </dt>
                      <dd className="mt-[var(--space-1)] font-utility text-[length:var(--text-app-meta)] tabular-nums text-[color:var(--color-text-primary)]">
                        {countFormatter.format(row.variantCount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                        {row.concludedAt ? "Concluded" : row.startedAt ? "Started" : "Updated"}
                      </dt>
                      <dd className="mt-[var(--space-1)] font-utility text-[length:var(--text-app-meta)] text-[color:var(--color-text-primary)]">
                        {relativeDay(row.concludedAt ?? row.startedAt ?? row.updatedAt)}
                      </dd>
                    </div>
                  </dl>

                  {/* Progress toward the configured observation minimum — not
                      toward a "win". The product does not declare winners. */}
                  <div className="mt-[var(--space-4)]">
                    <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                      {/* `min_observations` is nullable: an experiment created
                          without a threshold has no bar to clear, and saying so
                          is more useful than substituting a default the user
                          never chose. */}
                      {row.minObservations === null
                        ? experimentsCopy.noObservationTarget
                        : experimentsCopy.observationsLabel(row.minObservations)}
                    </p>
                    <Progress
                      percent={row.confidenceState === "enough_observations" ? 100 : 0}
                      label={`${row.name} observation progress`}
                      tone={row.status === "running" ? "signal" : "neutral"}
                      className="mt-[var(--space-2)]"
                    />
                  </div>

                  <p className="mt-[var(--space-4)] border-t border-[var(--color-border-hairline)] pt-[var(--space-3)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
                    {row.outcomeSummary ?? row.confidenceNotes ?? presentation.explains}
                  </p>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-[var(--space-6)] max-w-[var(--measure-prose)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
        {experimentsCopy.comparisonUnavailable}
      </p>
    </AppPage>
  );
}
