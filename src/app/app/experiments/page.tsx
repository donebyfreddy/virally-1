import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  Equal,
  FlaskConical,
  Plus,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { campaigns, experiments, experimentVariants } from "@/lib/db/schema.fragment";
import { formatMetric, relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader, SectionHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { Progress } from "@/components/app-ui/Progress";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import {
  CONFIDENCE_PRESENTATION,
  EXPERIMENT_STATUS_PRESENTATION,
  VARIABLE_LABELS,
  experimentsCopy,
  resolvePrimaryMetric,
  type ConfidenceIcon,
} from "@/content/experiments";

export const metadata: Metadata = {
  title: "Experiments",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;
const countFormatter = new Intl.NumberFormat("en-US");

const VALID_STATUSES = new Set<string>(experimentsCopy.statuses.map((option) => option.id));
const VALID_VARIABLES = new Set<string>(experimentsCopy.variables.map((option) => option.id));

/** Grouping. `paused` sits with `running`: it is a live test, temporarily stopped. */
const ACTIVE_STATUSES = new Set(["running", "paused"]);
const CONCLUDED_STATUSES = new Set(["concluded", "abandoned"]);

const CONFIDENCE_ICONS: Record<ConfidenceIcon, LucideIcon> = {
  collecting: CircleDashed,
  partial: CircleDotDashed,
  equal: Equal,
  rising: TrendingUp,
  complete: CircleCheck,
};

type ExperimentRow = {
  id: string;
  name: string;
  hypothesis: string | null;
  variable: string;
  primaryMetric: string;
  secondaryMetric: string | null;
  status: string;
  confidenceState: string;
  confidenceNotes: string | null;
  outcomeSummary: string | null;
  minObservations: number | null;
  startedAt: Date | null;
  endsAt: Date | null;
  concludedAt: Date | null;
  updatedAt: Date;
  campaignId: string | null;
  campaignName: string | null;
};

type VariantRow = {
  experimentId: string;
  id: string;
  label: string;
  isControl: boolean;
  /** Null when the arm has not been bound to a content variant yet. */
  contentVariantId: string | null;
  publishedPosts: number;
  /** Null means no platform reported the counter — never rendered as 0. */
  views: number | null;
  engagements: number | null;
};

/**
 * Experiments.
 *
 * Two refusals define this page.
 *
 * The first is the schema's: `experiment_confidence` ends at `enough_observations`,
 * not `significant`. So the page never declares a winner. Where a confidence state
 * already asserts a held direction, the arm that is ahead on the measure shown is
 * marked "Leading" — with a word and an icon as well as a tint, and with text
 * saying it is not a significance claim.
 *
 * The second is arithmetic: there is no lift figure anywhere on this page. A ratio
 * between two measured sums is trivially computable and would be read as a result,
 * and `experiments` carries no variance, no baseline period and no sample-size
 * record to qualify one with.
 *
 * What IS measured is measured from real rows: each arm's views and engagement come
 * from the newest metrics snapshot of each of its published posts — the same basis
 * /app/content uses — and the comparison states that basis under its heading.
 */
export default async function ExperimentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/experiments"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const query = single("q")?.trim() ?? "";
  const statusParam = single("status");
  const variableParam = single("variable");
  const campaignParam = single("campaign");
  const uuid = /^[0-9a-f-]{36}$/i;

  // Each filter is validated against its own option set before it reaches SQL, so
  // a hand-edited URL cannot introduce a predicate of its own.
  const conditions: SQL[] = [eq(experiments.workspaceId, context.workspaceId)];
  if (query) conditions.push(ilike(experiments.name, `%${query}%`));
  // Compared as SQL text rather than through `eq`: these columns carry a `$type<>`
  // union and an enum, and casting the validated string into those would assert
  // what the option-set check has already proved.
  if (statusParam && VALID_STATUSES.has(statusParam)) {
    conditions.push(sql`${experiments.status} = ${statusParam}`);
  }
  if (variableParam && VALID_VARIABLES.has(variableParam)) {
    conditions.push(sql`${experiments.variable} = ${variableParam}`);
  }
  if (campaignParam && uuid.test(campaignParam)) {
    conditions.push(eq(experiments.campaignId, campaignParam));
  }

  const where = and(...conditions);
  const inWorkspace = eq(experiments.workspaceId, context.workspaceId);

  // Five queries, one round trip. The KPI figures are queried unfiltered on
  // purpose: a "running" count computed from the current filter would describe the
  // filter rather than the workspace.
  const [rows, totalRows, statusCounts, variantTotals, campaignOptions] = await Promise.all([
    db
      .select({
        id: experiments.id,
        name: experiments.name,
        hypothesis: experiments.hypothesis,
        variable: experiments.variable,
        primaryMetric: experiments.primaryMetric,
        secondaryMetric: experiments.secondaryMetric,
        status: experiments.status,
        confidenceState: experiments.confidenceState,
        confidenceNotes: experiments.confidenceNotes,
        outcomeSummary: experiments.outcomeSummary,
        minObservations: experiments.minObservations,
        startedAt: experiments.startedAt,
        endsAt: experiments.endsAt,
        concludedAt: experiments.concludedAt,
        updatedAt: experiments.updatedAt,
        campaignId: experiments.campaignId,
        campaignName: campaigns.name,
      })
      .from(experiments)
      .leftJoin(campaigns, eq(experiments.campaignId, campaigns.id))
      .where(where)
      .orderBy(desc(experiments.updatedAt))
      .limit(PAGE_SIZE),

    db.select({ value: sql<number>`count(*)::int` }).from(experiments).where(where),

    db
      .select({ status: experiments.status, value: sql<number>`count(*)::int` })
      .from(experiments)
      .where(inWorkspace)
      .groupBy(experiments.status),

    // Joined back to the experiment so arms belonging to another workspace cannot
    // contribute, and so the figure matches what this page is able to show.
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(experimentVariants)
      .innerJoin(experiments, eq(experiments.id, experimentVariants.experimentId))
      .where(inWorkspace),

    db
      .select({ id: campaigns.id, label: campaigns.name })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, context.workspaceId), isNull(campaigns.deletedAt)))
      .orderBy(desc(campaigns.updatedAt))
      .limit(50),
  ]);

  const experimentIds = rows.map((row) => row.id);

  /**
   * Per-arm measurement, keyed by the ids on this page — which are only known once
   * the query above returns, hence a second phase.
   *
   * `content_metrics` is an append-only hourly series, so summing it raw would
   * count the same post once per snapshot. Only the newest snapshot per post is a
   * current total, and that lookup rides `content_metrics_post_time_idx`.
   */
  const variantRows: VariantRow[] =
    experimentIds.length === 0
      ? []
      : (
          await db
            .select({
              experimentId: experimentVariants.experimentId,
              id: experimentVariants.id,
              label: experimentVariants.label,
              isControl: experimentVariants.isControl,
              contentVariantId: experimentVariants.contentVariantId,
              publishedPosts: sql<number>`(
                select count(*)::int from scheduled_posts sp
                where sp.content_variant_id = ${experimentVariants.contentVariantId}
                  and sp.status = 'published'
              )`,
              // Cast to bigint and read as a string: the driver returns numeric as
              // a string, so typing these as `number` here would be a lie.
              views: sql<string | null>`(
                select sum(cm.views)::bigint
                from content_metrics cm
                join scheduled_posts sp on sp.id = cm.scheduled_post_id
                where sp.content_variant_id = ${experimentVariants.contentVariantId}
                  and cm.captured_at = (
                    select max(latest.captured_at) from content_metrics latest
                    where latest.scheduled_post_id = cm.scheduled_post_id
                  )
              )`,
              // Null only when not one of the four interaction counters was
              // reported for any post. `nullif(sum, 0)` would erase a genuine zero,
              // which is a different fact from "the platform does not expose this".
              engagements: sql<string | null>`(
                select case
                  when count(cm.likes) + count(cm.comments)
                     + count(cm.shares) + count(cm.saves) = 0
                  then null
                  else sum(
                    coalesce(cm.likes, 0) + coalesce(cm.comments, 0)
                    + coalesce(cm.shares, 0) + coalesce(cm.saves, 0)
                  )::bigint
                end
                from content_metrics cm
                join scheduled_posts sp on sp.id = cm.scheduled_post_id
                where sp.content_variant_id = ${experimentVariants.contentVariantId}
                  and cm.captured_at = (
                    select max(latest.captured_at) from content_metrics latest
                    where latest.scheduled_post_id = cm.scheduled_post_id
                  )
              )`,
            })
            .from(experimentVariants)
            .where(
              and(
                eq(experimentVariants.workspaceId, context.workspaceId),
                inArray(experimentVariants.experimentId, experimentIds),
              ),
            )
            // Control first, then alphabetical — a stable order across renders
            // rather than one that depends on the planner. A comparison whose rows
            // move between reloads cannot be read.
            .orderBy(
              asc(experimentVariants.experimentId),
              desc(experimentVariants.isControl),
              asc(experimentVariants.label),
            )
        ).map((row) => ({
          ...row,
          views: row.views === null ? null : Number(row.views),
          engagements: row.engagements === null ? null : Number(row.engagements),
        }));

  const variantsByExperiment = new Map<string, VariantRow[]>();
  for (const variant of variantRows) {
    const list = variantsByExperiment.get(variant.experimentId);
    if (list) list.push(variant);
    else variantsByExperiment.set(variant.experimentId, [variant]);
  }

  const total = totalRows[0]?.value ?? 0;
  const countsByStatus = new Map(statusCounts.map((row) => [row.status as string, row.value]));
  const workspaceTotal = statusCounts.reduce((sum, row) => sum + row.value, 0);
  const runningTotal = countsByStatus.get("running") ?? 0;
  const concludedTotal = countsByStatus.get("concluded") ?? 0;
  const variantTotal = variantTotals[0]?.value ?? 0;
  const filtered = Boolean(query || statusParam || variableParam || campaignParam);
  const canCreate = can(context.role, "content.create");

  const groups = [
    { key: "active", copy: experimentsCopy.groups.active, set: ACTIVE_STATUSES },
    { key: "concluded", copy: experimentsCopy.groups.concluded, set: CONCLUDED_STATUSES },
    { key: "draft", copy: experimentsCopy.groups.draft, set: new Set(["draft"]) },
  ]
    .map((group) => ({ ...group, rows: rows.filter((row) => group.set.has(row.status)) }))
    .filter((group) => group.rows.length > 0);

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={experimentsCopy.title}
          description={experimentsCopy.body}
          meta={[
            workspaceTotal === 1
              ? "1 experiment"
              : `${countFormatter.format(workspaceTotal)} experiments`,
            context.workspaceName,
          ]}
          actions={
            canCreate ? (
              <ButtonLink href="/app/create">
                <Plus aria-hidden="true" size={15} strokeWidth={2.25} />
                New campaign
              </ButtonLink>
            ) : undefined
          }
        />

        <KpiGrid columns={4}>
          <KpiCard
            label={experimentsCopy.kpis.total}
            value={countFormatter.format(workspaceTotal)}
            icon={<FlaskConical size={14} strokeWidth={1.75} />}
          />
          <KpiCard
            label={experimentsCopy.kpis.running}
            value={countFormatter.format(runningTotal)}
            tone={runningTotal > 0 ? "brand" : "neutral"}
            icon={<TrendingUp size={14} strokeWidth={1.75} />}
            href={runningTotal > 0 ? "/app/experiments?status=running" : undefined}
          />
          <KpiCard
            label={experimentsCopy.kpis.concluded}
            value={countFormatter.format(concludedTotal)}
            icon={<CircleCheck size={14} strokeWidth={1.75} />}
            href={concludedTotal > 0 ? "/app/experiments?status=concluded" : undefined}
          />
          <KpiCard
            label={experimentsCopy.kpis.variants}
            value={countFormatter.format(variantTotal)}
            icon={<Equal size={14} strokeWidth={1.75} />}
            detail={
              <span className="text-[color:var(--text-muted)]">
                {workspaceTotal > 0
                  ? `${(variantTotal / workspaceTotal).toFixed(1)} per experiment`
                  : "One arm per variation under test"}
              </span>
            }
          />
        </KpiGrid>

        {/* Hidden on a workspace with nothing to filter: three selects and a search
            box above an empty state are chrome for a job the user cannot do yet. */}
        {workspaceTotal > 0 && (
          <Card>
            <CardBody pad="tight">
              <FilterBar
                searchPlaceholder={experimentsCopy.searchPlaceholder}
                filters={[
                  {
                    key: "status",
                    label: experimentsCopy.filters.status,
                    options: experimentsCopy.statuses,
                  },
                  {
                    key: "variable",
                    label: experimentsCopy.filters.variable,
                    options: experimentsCopy.variables,
                  },
                  {
                    key: "campaign",
                    label: experimentsCopy.filters.campaign,
                    options: campaignOptions,
                  },
                ]}
              />
            </CardBody>
          </Card>
        )}

        {rows.length === 0 && (
          <Card>
            <EmptyState
              bare
              icon={<FlaskConical size={20} strokeWidth={1.75} />}
              title={filtered ? experimentsCopy.noMatches.title : experimentsCopy.empty.title}
              body={filtered ? experimentsCopy.noMatches.body : experimentsCopy.empty.body}
              actions={
                filtered ? (
                  <ButtonLink href="/app/experiments" variant="secondary">
                    Clear filters
                  </ButtonLink>
                ) : canCreate ? (
                  <ButtonLink href="/app/create">Create a campaign</ButtonLink>
                ) : undefined
              }
            />
          </Card>
        )}

        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`experiments-${group.key}`}>
            <SectionHeader
              id={`experiments-${group.key}`}
              title={group.copy.title}
              description={group.copy.description}
              action={
                <span className="app-figure text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                  {countFormatter.format(group.rows.length)}
                </span>
              }
            />

            <ul className="mt-[var(--space-4)] flex flex-col gap-[var(--app-panel-gap)]">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <ExperimentCard row={row} variants={variantsByExperiment.get(row.id) ?? []} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Stated rather than silent. A capped list that looks complete is worse
            than one that says it is capped. */}
        {rows.length > 0 && total > rows.length && (
          <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
            {experimentsCopy.truncated(rows.length, total)}
          </p>
        )}
      </PageStack>
    </AppPage>
  );
}

/**
 * One experiment.
 *
 * Structurally its own surface rather than a row in a table: the hypothesis is
 * prose, the comparison is a chart, and the result is a sentence. None of those
 * survive being squeezed into a table cell, which is why a flat table of two
 * numbers per test read as a database dump.
 */
function ExperimentCard({ row, variants }: { row: ExperimentRow; variants: VariantRow[] }) {
  const confidence =
    CONFIDENCE_PRESENTATION[row.confidenceState] ?? CONFIDENCE_PRESENTATION.no_data;
  const status = EXPERIMENT_STATUS_PRESENTATION[row.status] ?? EXPERIMENT_STATUS_PRESENTATION.draft;
  const variableLabel = VARIABLE_LABELS[row.variable] ?? row.variable;

  /**
   * Which counter the bars show.
   *
   * `primary_metric` is free text, so it may name something this page cannot
   * aggregate. When it does, the comparison falls back to views AND says so —
   * silently relabelling one metric as another is the failure this avoids.
   */
  const resolved = resolvePrimaryMetric(row.primaryMetric);
  const metric = resolved ?? "views";
  const metricLabel =
    metric === "views" ? experimentsCopy.comparison.views : experimentsCopy.comparison.engagements;

  const meta = [variableLabel, row.campaignName].filter(Boolean).join(" · ");
  const elapsed = windowProgress(row.startedAt, row.endsAt);

  return (
    <Card as="article">
      <CardHeader
        as="h3"
        title={row.name}
        description={meta}
        divided
        action={
          <span className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
            <Chip className={status.classes}>{status.label}</Chip>
            <ConfidenceChip state={row.confidenceState} />
          </span>
        }
      />

      <CardBody className="flex flex-col gap-[var(--space-5)]">
        {row.hypothesis && (
          <p className="max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
            <span className="font-[var(--weight-strong)] text-[color:var(--text-primary)]">
              {experimentsCopy.hypothesisLabel}:{" "}
            </span>
            {row.hypothesis}
          </p>
        )}

        {/* Flex-wrap rather than a fixed column count: the number of facts varies
            with the row (a secondary metric is optional), and a four-column grid
            holding five items leaves three empty cells. */}
        <dl className="flex flex-wrap gap-x-[var(--space-8)] gap-y-[var(--space-4)]">
          <Fact label={experimentsCopy.fields.primaryMetric} value={row.primaryMetric} />
          {row.secondaryMetric && (
            <Fact label={experimentsCopy.fields.secondaryMetric} value={row.secondaryMetric} />
          )}
          <Fact
            label={experimentsCopy.fields.variants}
            value={countFormatter.format(variants.length)}
            figure
          />
          {/* Stated, never turned into a gauge: `min_observations` has no unit in
              the schema, so a bar drawn against it would invent one. */}
          <Fact
            label={experimentsCopy.fields.minObservations}
            value={
              row.minObservations === null
                ? experimentsCopy.noObservationTarget
                : countFormatter.format(row.minObservations)
            }
            figure={row.minObservations !== null}
            quiet={row.minObservations === null}
          />
          <Fact
            label={
              row.concludedAt
                ? experimentsCopy.fields.concluded
                : row.startedAt
                  ? experimentsCopy.fields.started
                  : experimentsCopy.fields.updated
            }
            value={relativeDay(row.concludedAt ?? row.startedAt ?? row.updatedAt)}
          />
        </dl>

        <VariantComparison
          variants={variants}
          metric={metric}
          metricLabel={metricLabel}
          mismatch={resolved === null ? row.primaryMetric : null}
          allowsLeader={confidence.allowsLeader}
        />

        {/* The one gauge on this page, because it is the one quantity here with a
            defined unit: two timestamps. A started test with no end date gets the
            fact stated instead of a bar against an unknown length. */}
        {row.startedAt && (
          <div>
            <p className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              {experimentsCopy.fields.window}
            </p>
            {elapsed === null ? (
              <p className="mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                {experimentsCopy.window.noEnd}
              </p>
            ) : (
              <Progress
                percent={elapsed}
                label={`${row.name} ${experimentsCopy.window.label}`}
                tone={row.status === "running" ? "signal" : "neutral"}
                className="mt-[var(--space-2)]"
              />
            )}
          </div>
        )}
      </CardBody>

      {/*
        The result, in the experiment's own words where it has them.

        `outcome_summary` and `confidence_notes` are prose columns precisely so that
        a number never stands in for a conclusion. When both are empty the state's
        own explanation is used, which says what the state means rather than
        implying a finding.
      */}
      <CardFooter>
        <p className="max-w-[80ch]">
          {row.outcomeSummary ?? row.confidenceNotes ?? confidence.explains}
        </p>
      </CardFooter>
    </Card>
  );
}

/**
 * Variant-versus-variant comparison.
 *
 * A bar per arm rather than two rows of numbers: the question this page answers is
 * "which of these is ahead, and by how much", and length answers it at a glance
 * where two figures require arithmetic.
 *
 * The bar is `aria-hidden` decoration over a real `<dl>` — the labels, figures and
 * states are all rendered text, so nothing exists only in the drawing.
 *
 * Three distinct absences, never collapsed into a zero:
 *   - the arm has no content variant bound to it yet
 *   - it has one, but nothing has published
 *   - posts published, and no platform reported this counter
 */
function VariantComparison({
  variants,
  metric,
  metricLabel,
  mismatch,
  allowsLeader,
}: {
  variants: VariantRow[];
  metric: "views" | "engagements";
  metricLabel: string;
  /** The configured metric name, when it is not the one being shown. */
  mismatch: string | null;
  allowsLeader: boolean;
}) {
  if (variants.length === 0) {
    return (
      <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
        {experimentsCopy.comparison.noVariants}
      </p>
    );
  }

  const values = variants.map((variant) => variant[metric]);
  const reported = values.filter((value): value is number => value !== null);
  const ceiling = reported.length > 0 ? Math.max(...reported) : 0;

  /**
   * The leading arm, or null.
   *
   * Four conditions, all required: the confidence state must already assert a held
   * direction, something must have been measured, the maximum must be unique, and
   * more than one arm must have reported — a single reported arm is not ahead of
   * anything.
   */
  const leaderId =
    allowsLeader &&
    ceiling > 0 &&
    reported.length > 1 &&
    reported.filter((value) => value === ceiling).length === 1
      ? (variants.find((variant) => variant[metric] === ceiling)?.id ?? null)
      : null;

  return (
    <section>
      <h4 className="app-card-title text-[color:var(--text-primary)]">
        {experimentsCopy.comparison.heading}
      </h4>
      <p className="mt-1 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
        {metricLabel} · {experimentsCopy.comparison.basis}
      </p>

      {mismatch && (
        <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
          {experimentsCopy.comparison.metricMismatch(mismatch, metricLabel)}
        </p>
      )}

      <dl className="mt-[var(--space-3)] flex flex-col gap-[var(--space-3)]">
        {variants.map((variant) => {
          const value = variant[metric];
          const share = value !== null && ceiling > 0 ? Math.min(1, value / ceiling) : 0;
          const detail =
            variant.contentVariantId === null
              ? experimentsCopy.comparison.unlinked
              : variant.publishedPosts === 0
                ? experimentsCopy.comparison.unpublished
                : experimentsCopy.comparison.postCount(variant.publishedPosts);

          return (
            <div
              key={variant.id}
              // Stacked at 390px, three columns from `sm`. A label, a bar and a
              // figure side by side inside 342px leaves the bar about 60px wide,
              // which is not a comparison.
              className={cn(
                "grid grid-cols-1 items-start gap-x-[var(--space-3)] gap-y-[var(--space-1)]",
                "sm:grid-cols-[minmax(8rem,13rem)_minmax(0,1fr)_auto]",
              )}
            >
              <dt className="min-w-0">
                <span className="flex flex-wrap items-center gap-[var(--space-2)]">
                  <span className="truncate text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                    {variant.label}
                  </span>
                  {variant.isControl && (
                    <Chip className="bg-[var(--surface-muted)] text-[color:var(--text-secondary)]">
                      {experimentsCopy.comparison.controlLabel}
                    </Chip>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                  {detail}
                </span>
              </dt>

              {/* The track gives the bar a context of "out of what". Without it a
                  short bar is ambiguous between a small value and a narrow chart.
                  An arm with nothing reported draws no bar at all. */}
              <div
                aria-hidden="true"
                className="mt-1 h-2 min-w-0 overflow-hidden rounded-[var(--radius-full)] bg-[var(--chart-track)] sm:mt-1.5"
              >
                {value !== null && (
                  <div
                    className="h-full rounded-[var(--radius-full)] bg-[var(--chart-1)]"
                    style={{ width: `${(share * 100).toFixed(2)}%` }}
                  />
                )}
              </div>

              <dd className="flex items-center gap-[var(--space-2)] sm:shrink-0 sm:justify-end">
                {value === null ? (
                  <span className="text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">{experimentsCopy.comparison.unreported}</span>
                  </span>
                ) : (
                  <span className="app-figure text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                    {formatMetric(value, "compact")}
                  </span>
                )}
                {variant.id === leaderId && <LeadingChip />}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/**
 * The result state.
 *
 * Word plus icon plus tint, in that order of importance. Two of the five states
 * share the informational tint deliberately: the tint narrows the register, the
 * word carries the meaning, and inventing a fifth hue to keep them apart would
 * turn the page into a colour key.
 */
function ConfidenceChip({ state }: { state: string }) {
  const presentation = CONFIDENCE_PRESENTATION[state] ?? CONFIDENCE_PRESENTATION.no_data;
  const Icon = CONFIDENCE_ICONS[presentation.icon];

  return (
    <Chip className={presentation.classes}>
      <Icon aria-hidden="true" size={12} strokeWidth={2.25} className="shrink-0" />
      {presentation.label}
    </Chip>
  );
}

/**
 * "Leading", never "winner".
 *
 * Carries its own qualification in screen-reader text and in `title`, because a
 * chip reading only "Leading" beside a bigger number is taken for a verdict.
 */
function LeadingChip() {
  return (
    <span
      title={experimentsCopy.comparison.leadingExplains}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-chip)]",
        "bg-[var(--info-soft)] px-1.5 py-0.5",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        "text-[color:var(--info)]",
      )}
    >
      <TrendingUp aria-hidden="true" size={12} strokeWidth={2.25} className="shrink-0" />
      {experimentsCopy.comparison.leadingLabel}
      <span className="sr-only"> — {experimentsCopy.comparison.leadingExplains}</span>
    </span>
  );
}

/** A soft-filled label. Never the only carrier of a state — always with a word. */
function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] px-2 py-1",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** One label/value fact on an experiment card. */
function Fact({
  label,
  value,
  figure = false,
  quiet = false,
}: {
  label: string;
  value: string;
  figure?: boolean;
  quiet?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[length:var(--text-app-cell)]",
          figure && "app-figure",
          quiet ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-primary)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * How far through its configured window a test is, as a percentage, or null.
 *
 * Null whenever the window is not fully defined — an unstarted test, or one with
 * no end date. A bar drawn for either would be measuring nothing.
 */
function windowProgress(startedAt: Date | null, endsAt: Date | null): number | null {
  if (!startedAt || !endsAt) return null;
  const span = endsAt.getTime() - startedAt.getTime();
  if (span <= 0) return null;
  const elapsed = Date.now() - startedAt.getTime();
  return Math.max(0, Math.min(100, (elapsed / span) * 100));
}
