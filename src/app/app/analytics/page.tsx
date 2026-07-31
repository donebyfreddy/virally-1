import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { Eye, Heart, Send, UserPlus, Users } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  analyticsDaily,
  connectedAccounts,
  contentItems,
  contentMetrics,
  contentVariants,
} from "@/lib/db/schema.fragment";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { Delta } from "@/components/app-ui/Metric";
import { ChartFrame, seriesColorVar, seriesDashVar } from "@/components/app-ui/charts/ChartFrame";
import { areaPath, buildScale, linePath, yTicks, type Series } from "@/components/app-ui/charts/geometry";
import { CategoryBars } from "@/components/app-ui/charts/CategoryBars";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { PLATFORM_OPTIONS } from "@/content/create";
import { analyticsCopy, DEFAULT_RANGE_DAYS, RANGE_OPTIONS } from "@/content/analytics";
import type { Platform } from "@/types/database";

export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const CONTENT_LIMIT = 10;
const ACCOUNT_LIMIT = 8;

const countFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const PLATFORM_LABELS = new Map(PLATFORM_OPTIONS.map((option) => [option.id, option.label]));
const VALID_RANGES = new Map(RANGE_OPTIONS.map((option) => [option.id, option.days]));

const WEEKDAYS = [
  { short: "M", long: "Monday" },
  { short: "T", long: "Tuesday" },
  { short: "W", long: "Wednesday" },
  { short: "T", long: "Thursday" },
  { short: "F", long: "Friday" },
  { short: "S", long: "Saturday" },
  { short: "S", long: "Sunday" },
] as const;

function platformLabel(platform: Platform | null): string {
  if (!platform) return "—";
  return PLATFORM_LABELS.get(platform) ?? platform;
}

/** `2026-07-31` → a UTC Date at midnight. Never the local zone: the column is a date. */
function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function shiftDays(from: Date, delta: number): Date {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * A delta against a zero baseline is not a measurable change — "+100%" would
 * claim it was — so the caller renders "no prior data" instead.
 */
function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

type PlatformRow = {
  platform: Platform | null;
  posts: number;
  views: number;
  reach: number;
  engagements: number;
  followers: number;
};

type AccountRow = {
  id: string;
  username: string | null;
  displayName: string | null;
  platform: Platform;
  posts: number;
  views: number | null;
  engagements: number | null;
};

type ContentRow = {
  postId: string;
  title: string;
  platform: Platform;
  views: number | null;
  engagements: number | null;
  completionBp: number | null;
};

/**
 * Analytics.
 *
 * Two data sources, and the difference between them governs the whole layout:
 *
 *   - `analytics_daily` is the pre-aggregated per-day rollup. Everything scoped by
 *     the date range comes from it, and its counters are NOT NULL, so those panels
 *     can be charted directly.
 *   - `content_metrics` is an append-only hourly snapshot series per post whose
 *     counters are all nullable. Only the NEWEST snapshot per post is a current
 *     total, so every read of it filters to `captured_at = max(captured_at)` for
 *     that post — summing the series raw counts one post once per sync. Those
 *     figures are lifetime, not range-scoped, and the panels say so rather than
 *     implying the range narrowed them.
 *
 * Nullable measures render as an em dash with an sr-only "Not reported", never as
 * 0: a platform that does not expose a counter is a different fact from a post
 * that scored zero.
 *
 * Two panels the brief lists are absent, with the reasons recorded in
 * `src/content/analytics.ts`: a weekday × hour heatmap (no hour dimension exists
 * in either table) and cost-performance analysis (every cost column is internal
 * provider margin, and `credit_ledger` has no workspace or content attribution).
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/analytics"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;

  // Server-side gate. Hiding the nav item is not access control.
  if (!can(context.role, "analytics.view")) {
    return (
      <AppPage width="text">
        <AuthMessage tone="notice" title={analyticsCopy.gate.title} body={analyticsCopy.gate.body} />
      </AppPage>
    );
  }

  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  // Both filters are validated against their own option sets before reaching SQL,
  // so a hand-edited URL cannot introduce a predicate or a window of its own.
  const rangeParam = single("range");
  const days = (rangeParam ? VALID_RANGES.get(rangeParam) : undefined) ?? DEFAULT_RANGE_DAYS;
  const platformParam = single("platform");
  // Resolved to the option itself rather than to a validated string, so the rest
  // of the page holds a `Platform` and never needs a cast back into the enum.
  const platform =
    PLATFORM_OPTIONS.find((option) => option.id === platformParam)?.id ?? null;

  const today = parseDay(dayKey(new Date()));
  const fromDay = dayKey(shiftDays(today, -(days - 1)));
  const previousFromDay = dayKey(shiftDays(today, -(days * 2 - 1)));

  const rangeScope: SQL[] = [
    eq(analyticsDaily.workspaceId, context.workspaceId),
    gte(analyticsDaily.day, fromDay),
  ];
  if (platform) rangeScope.push(sql`${analyticsDaily.platform}::text = ${platform}`);
  const inRange = and(...rangeScope);

  const previousScope: SQL[] = [
    eq(analyticsDaily.workspaceId, context.workspaceId),
    gte(analyticsDaily.day, previousFromDay),
    lt(analyticsDaily.day, fromDay),
  ];
  if (platform) previousScope.push(sql`${analyticsDaily.platform}::text = ${platform}`);
  const inPreviousRange = and(...previousScope);

  /**
   * The newest snapshot for each post.
   *
   * `content_metrics` is append-only and each row is the platform's counter AT
   * that hour, so this predicate — not a sum over the series — is what makes a
   * total current. It rides `content_metrics_post_time_idx`.
   */
  const latestSnapshot = sql`${contentMetrics.capturedAt} = (
    select max(latest.captured_at) from content_metrics latest
    where latest.scheduled_post_id = ${contentMetrics.scheduledPostId}
  )`;

  const metricScope: SQL[] = [eq(contentMetrics.workspaceId, context.workspaceId), latestSnapshot];
  if (platform) metricScope.push(sql`${contentMetrics.platform}::text = ${platform}`);
  const inMetrics = and(...metricScope);

  /**
   * Nullable counters, summed without inventing a zero.
   *
   * `count(col)` counts only non-null values, so a group where no post reported
   * the measure returns null rather than 0 — which is the honest answer for a
   * platform that does not expose that counter at all.
   */
  const nullableSum = (column: typeof contentMetrics.views) =>
    sql<number | null>`case when count(${column}) = 0 then null
      else sum(coalesce(${column}, 0))::int end`;

  const engagementSum = sql<number | null>`case
    when count(${contentMetrics.likes}) + count(${contentMetrics.comments})
       + count(${contentMetrics.shares}) + count(${contentMetrics.saves}) = 0
    then null
    else sum(
      coalesce(${contentMetrics.likes}, 0) + coalesce(${contentMetrics.comments}, 0)
      + coalesce(${contentMetrics.shares}, 0) + coalesce(${contentMetrics.saves}, 0)
    )::int
  end`;

  // Seven queries, one round trip.
  const [totalRows, previousRows, timeline, platformRows, accountRows, contentRows, retentionRows] =
    await Promise.all([
      db
        .select({
          views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
          reach: sql<number>`coalesce(sum(${analyticsDaily.reach}), 0)::int`,
          engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
          followers: sql<number>`coalesce(sum(${analyticsDaily.followersGained}), 0)::int`,
          posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
          // Null when no row in range carries one. `avg` already ignores nulls;
          // `nullif(x, 0)` would additionally erase a genuine zero completion,
          // which is a measurement rather than a gap.
          completionBp: sql<number | null>`round(avg(${analyticsDaily.avgCompletionBp}))::int`,
          // Demo rollups are not hidden, but they are never presented as a
          // platform sync either — see analyticsCopy.demoNotice.
          demoRows: sql<number>`count(*) filter (where ${analyticsDaily.origin} <> 'provider')::int`,
        })
        .from(analyticsDaily)
        .where(inRange),

      db
        .select({
          views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
          reach: sql<number>`coalesce(sum(${analyticsDaily.reach}), 0)::int`,
          engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
          followers: sql<number>`coalesce(sum(${analyticsDaily.followersGained}), 0)::int`,
          posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
        })
        .from(analyticsDaily)
        .where(inPreviousRange),

      db
        .select({
          day: analyticsDaily.day,
          views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
          reach: sql<number>`coalesce(sum(${analyticsDaily.reach}), 0)::int`,
          engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
          posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
          engagementBp: sql<number | null>`round(avg(${analyticsDaily.avgEngagementBp}))::int`,
        })
        .from(analyticsDaily)
        .where(inRange)
        .groupBy(analyticsDaily.day)
        .orderBy(asc(analyticsDaily.day)),

      db
        .select({
          platform: analyticsDaily.platform,
          posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
          views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
          reach: sql<number>`coalesce(sum(${analyticsDaily.reach}), 0)::int`,
          engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
          followers: sql<number>`coalesce(sum(${analyticsDaily.followersGained}), 0)::int`,
        })
        .from(analyticsDaily)
        .where(and(inRange, sql`${analyticsDaily.platform} is not null`))
        .groupBy(analyticsDaily.platform)
        .orderBy(desc(sql`sum(${analyticsDaily.views})`)),

      db
        .select({
          id: connectedAccounts.id,
          username: connectedAccounts.username,
          displayName: connectedAccounts.displayName,
          platform: connectedAccounts.platform,
          posts: sql<number>`count(*)::int`,
          views: nullableSum(contentMetrics.views),
          engagements: engagementSum,
        })
        .from(contentMetrics)
        .innerJoin(connectedAccounts, eq(contentMetrics.connectedAccountId, connectedAccounts.id))
        .where(inMetrics)
        .groupBy(
          connectedAccounts.id,
          connectedAccounts.username,
          connectedAccounts.displayName,
          connectedAccounts.platform,
        )
        .orderBy(desc(sql`sum(coalesce(${contentMetrics.views}, 0))`))
        .limit(ACCOUNT_LIMIT),

      // One row per post already, because the latest-snapshot predicate leaves
      // exactly one snapshot per `scheduled_post_id`. No aggregation needed.
      db
        .select({
          postId: contentMetrics.scheduledPostId,
          title: contentItems.title,
          platform: contentMetrics.platform,
          views: contentMetrics.views,
          engagements: sql<number | null>`case
            when ${contentMetrics.likes} is null and ${contentMetrics.comments} is null
             and ${contentMetrics.shares} is null and ${contentMetrics.saves} is null
            then null
            else (
              coalesce(${contentMetrics.likes}, 0) + coalesce(${contentMetrics.comments}, 0)
              + coalesce(${contentMetrics.shares}, 0) + coalesce(${contentMetrics.saves}, 0)
            )::int
          end`,
          completionBp: contentMetrics.completionRateBp,
        })
        .from(contentMetrics)
        .innerJoin(contentVariants, eq(contentVariants.id, contentMetrics.contentVariantId))
        .innerJoin(contentItems, eq(contentItems.id, contentVariants.contentItemId))
        .where(inMetrics)
        .orderBy(sql`${contentMetrics.views} desc nulls last`)
        .limit(CONTENT_LIMIT + 1),

      // Counted rather than fetched: the panel reports availability without
      // pulling curves it is not going to draw.
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(contentMetrics)
        .where(
          and(
            eq(contentMetrics.workspaceId, context.workspaceId),
            sql`${contentMetrics.retentionCurve} is not null`,
          ),
        ),
    ]);

  const totals = totalRows[0];
  const previous = previousRows[0];
  const retentionCount = retentionRows[0]?.value ?? 0;

  const hasRange = timeline.length > 0;
  const hasPosts = accountRows.length > 0 || contentRows.length > 0;
  const content = contentRows.slice(0, CONTENT_LIMIT) as readonly ContentRow[];
  const contentCapped = contentRows.length > CONTENT_LIMIT;

  const engagementPoints = timeline.flatMap((row) =>
    row.engagementBp === null ? [] : [{ x: parseDay(row.day).getTime(), y: row.engagementBp }],
  );

  const platformColumns: readonly Column<PlatformRow>[] = [
    {
      id: "platform",
      header: analyticsCopy.platforms.columns.platform,
      cell: (row) => (
        <span className="font-[var(--weight-strong)] text-[color:var(--text-primary)]">
          {platformLabel(row.platform)}
        </span>
      ),
    },
    {
      id: "posts",
      header: analyticsCopy.platforms.columns.posts,
      numeric: true,
      cell: (row) => countFormatter.format(row.posts),
    },
    {
      id: "views",
      header: analyticsCopy.platforms.columns.views,
      numeric: true,
      cell: (row) => compactFormatter.format(row.views),
    },
    {
      id: "reach",
      header: analyticsCopy.platforms.columns.reach,
      numeric: true,
      hideBelow: "sm",
      cell: (row) => compactFormatter.format(row.reach),
    },
    {
      id: "engagements",
      header: analyticsCopy.platforms.columns.engagements,
      numeric: true,
      hideBelow: "sm",
      cell: (row) => compactFormatter.format(row.engagements),
    },
    {
      id: "followers",
      header: analyticsCopy.platforms.columns.followers,
      numeric: true,
      hideBelow: "md",
      cell: (row) => countFormatter.format(row.followers),
    },
    {
      id: "perPost",
      header: analyticsCopy.platforms.columns.perPost,
      numeric: true,
      hideBelow: "lg",
      // Zero posts makes the ratio undefined rather than unreported — a different
      // fact, and the screen-reader text says which one this is.
      cell: (row) =>
        row.posts > 0 ? (
          compactFormatter.format(Math.round(row.views / row.posts))
        ) : (
          <Absent reason={analyticsCopy.notApplicable} />
        ),
    },
  ];

  const accountColumns: readonly Column<AccountRow>[] = [
    {
      id: "account",
      header: analyticsCopy.accounts.columns.account,
      cell: (row) => (
        <PrimaryCell
          title={row.username ? `@${row.username}` : (row.displayName ?? platformLabel(row.platform))}
          detail={platformLabel(row.platform)}
        />
      ),
    },
    {
      id: "posts",
      header: analyticsCopy.accounts.columns.posts,
      numeric: true,
      cell: (row) => countFormatter.format(row.posts),
    },
    {
      id: "views",
      header: analyticsCopy.accounts.columns.views,
      numeric: true,
      cell: (row) => <Figure value={row.views} format="compact" />,
    },
    {
      id: "engagements",
      header: analyticsCopy.accounts.columns.engagements,
      numeric: true,
      hideBelow: "sm",
      cell: (row) => <Figure value={row.engagements} format="compact" />,
    },
  ];

  const contentColumns: readonly Column<ContentRow>[] = [
    {
      id: "title",
      header: analyticsCopy.content.columns.title,
      cell: (row) => <PrimaryCell title={row.title} detail={platformLabel(row.platform)} />,
    },
    {
      id: "views",
      header: analyticsCopy.content.columns.views,
      numeric: true,
      cell: (row) => <Figure value={row.views} format="compact" />,
    },
    {
      id: "engagements",
      header: analyticsCopy.content.columns.engagements,
      numeric: true,
      hideBelow: "sm",
      cell: (row) => <Figure value={row.engagements} format="compact" />,
    },
    {
      id: "completion",
      header: analyticsCopy.content.columns.completion,
      numeric: true,
      hideBelow: "md",
      cell: (row) =>
        row.completionBp === null ? <NotReported /> : `${(row.completionBp / 100).toFixed(1)}%`,
    },
  ];

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={analyticsCopy.title}
          description={analyticsCopy.body}
          meta={[
            context.workspaceName,
            analyticsCopy.rangeLabel(days),
            ...(platform ? [platformLabel(platform)] : []),
          ]}
        />

        <Card>
          <CardBody pad="tight">
            {/* No search box. There is nothing on this page a text query would
                narrow, and a field whose value the SQL ignores is worse than none. */}
            <FilterBar
              search={false}
              filters={[
                { key: "range", label: "Range", options: RANGE_OPTIONS },
                { key: "platform", label: "Platform", options: PLATFORM_OPTIONS },
              ]}
            />
          </CardBody>
        </Card>

        {totals && totals.demoRows > 0 && (
          <AuthMessage tone="notice" body={analyticsCopy.demoNotice} />
        )}

        {!hasRange && !hasPosts && (
          <Card>
            <EmptyState
              bare
              icon={<Eye size={20} strokeWidth={1.75} />}
              title={analyticsCopy.empty.title}
              body={analyticsCopy.empty.body}
            />
          </Card>
        )}

        {!hasRange && hasPosts && (
          <Card>
            <EmptyState
              bare
              icon={<Eye size={20} strokeWidth={1.75} />}
              title={analyticsCopy.rangeEmpty.title}
              body={analyticsCopy.rangeEmpty.body}
            />
          </Card>
        )}

        {hasRange && totals && previous && (
          <>
            <KpiGrid columns={6}>
              <TrendKpi
                label={analyticsCopy.kpis.views}
                value={compactFormatter.format(totals.views)}
                change={changePercent(totals.views, previous.views)}
                days={days}
                icon={<Eye size={14} strokeWidth={1.75} />}
              />
              <TrendKpi
                label={analyticsCopy.kpis.reach}
                value={compactFormatter.format(totals.reach)}
                change={changePercent(totals.reach, previous.reach)}
                days={days}
                icon={<Users size={14} strokeWidth={1.75} />}
              />
              <TrendKpi
                label={analyticsCopy.kpis.engagements}
                value={compactFormatter.format(totals.engagements)}
                change={changePercent(totals.engagements, previous.engagements)}
                days={days}
                icon={<Heart size={14} strokeWidth={1.75} />}
              />
              <TrendKpi
                label={analyticsCopy.kpis.followers}
                value={countFormatter.format(totals.followers)}
                change={changePercent(totals.followers, previous.followers)}
                days={days}
                icon={<UserPlus size={14} strokeWidth={1.75} />}
              />
              <TrendKpi
                label={analyticsCopy.kpis.posts}
                value={countFormatter.format(totals.posts)}
                change={changePercent(totals.posts, previous.posts)}
                days={days}
                icon={<Send size={14} strokeWidth={1.75} />}
              />
              {/* No delta on a measure the platform may simply not report: an
                  em dash cannot be compared with anything. */}
              <KpiCard
                label={analyticsCopy.kpis.completion}
                value={
                  totals.completionBp === null ? "—" : `${(totals.completionBp / 100).toFixed(1)}%`
                }
                detail={
                  <span className="text-[color:var(--text-muted)]">
                    {totals.completionBp === null
                      ? analyticsCopy.completionMissing
                      : analyticsCopy.completionExplains}
                  </span>
                }
              />
            </KpiGrid>

            <Card>
              <CardBody>
                <LineChart
                  id="analytics-performance"
                  title={`${analyticsCopy.performance.heading} — ${analyticsCopy.rangeLabel(days).toLowerCase()}`}
                  series={[
                    {
                      id: "views",
                      label: analyticsCopy.kpis.views,
                      points: timeline.map((row) => ({
                        x: parseDay(row.day).getTime(),
                        y: row.views,
                      })),
                    },
                    {
                      id: "reach",
                      label: analyticsCopy.kpis.reach,
                      points: timeline.map((row) => ({
                        x: parseDay(row.day).getTime(),
                        y: row.reach,
                      })),
                    },
                    {
                      id: "engagements",
                      label: analyticsCopy.kpis.engagements,
                      points: timeline.map((row) => ({
                        x: parseDay(row.day).getTime(),
                        y: row.engagements,
                      })),
                    },
                  ]}
                  formatValue={(value) => compactFormatter.format(value)}
                  formatX={(value) => dayFormatter.format(new Date(value))}
                />
                <Note className="mt-[var(--space-4)]">{analyticsCopy.performance.note}</Note>
              </CardBody>
            </Card>

            <div className="grid gap-[var(--app-panel-gap)] xl:grid-cols-2">
              <Card className="min-w-0">
                <CardBody>
                  {engagementPoints.length > 0 ? (
                    <>
                      <LineChart
                        id="analytics-engagement"
                        title={analyticsCopy.engagement.heading}
                        series={[
                          {
                            id: "engagement-rate",
                            label: analyticsCopy.engagement.heading,
                            points: engagementPoints,
                          },
                        ]}
                        area
                        formatValue={(value) => `${(value / 100).toFixed(1)}%`}
                        formatX={(value) => dayFormatter.format(new Date(value))}
                      />
                      <Note className="mt-[var(--space-4)]">{analyticsCopy.engagement.note}</Note>
                    </>
                  ) : (
                    <>
                      <h3 className="app-card-title text-[color:var(--text-primary)]">
                        {analyticsCopy.engagement.heading}
                      </h3>
                      <Note className="mt-[var(--space-2)]">{analyticsCopy.engagement.missing}</Note>
                    </>
                  )}
                </CardBody>
              </Card>

              <Card className="min-w-0">
                <CardHeader
                  as="h2"
                  title={analyticsCopy.cadence.heading}
                  description={analyticsCopy.cadence.note}
                />
                <CardBody>
                  <CadenceGrid
                    from={shiftDays(today, -(days - 1))}
                    to={today}
                    counts={new Map(timeline.map((row) => [row.day, row.posts]))}
                  />
                  <Note className="mt-[var(--space-4)]">{analyticsCopy.cadence.hourNote}</Note>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader
                as="h2"
                title={analyticsCopy.platforms.heading}
                description={analyticsCopy.rangeLabel(days)}
                divided
              />
              {platformRows.length > 0 ? (
                <>
                  <CardBody>
                    {/* Bars only where the measure is NOT NULL — `analytics_daily`
                        counters default to 0, so every category has a real length.
                        The nullable per-post measures below get a table instead. */}
                    <CategoryBars
                      data={platformRows.flatMap((row) =>
                        row.platform === null
                          ? []
                          : [
                              {
                                id: row.platform,
                                label: platformLabel(row.platform),
                                value: row.views,
                                detail: `${compactFormatter.format(row.engagements)} engagements`,
                              },
                            ],
                      )}
                      formatValue={(value) => compactFormatter.format(value)}
                    />
                  </CardBody>
                  <CardBody pad="none" className="border-t border-[var(--border-subtle)]">
                    <DataTable
                      caption={analyticsCopy.platforms.tableCaption}
                      columns={platformColumns}
                      rows={platformRows as readonly PlatformRow[]}
                      rowKey={(row) => row.platform ?? "unattributed"}
                    />
                  </CardBody>
                </>
              ) : (
                <CardBody>
                  <Note>{analyticsCopy.platforms.empty}</Note>
                </CardBody>
              )}
            </Card>
          </>
        )}

        <Card>
          <CardHeader
            as="h2"
            title={analyticsCopy.accounts.heading}
            description={analyticsCopy.accounts.note}
            divided={accountRows.length > 0}
          />
          {accountRows.length > 0 ? (
            <CardBody pad="none">
              <DataTable
                caption={analyticsCopy.accounts.heading}
                columns={accountColumns}
                rows={accountRows as readonly AccountRow[]}
                rowKey={(row) => row.id}
              />
            </CardBody>
          ) : (
            <CardBody>
              <Note>{analyticsCopy.accounts.empty}</Note>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader
            as="h2"
            title={analyticsCopy.content.heading}
            description={analyticsCopy.content.note}
            divided={content.length > 0}
          />
          {content.length > 0 ? (
            <>
              <CardBody pad="none">
                <DataTable
                  caption={analyticsCopy.content.tableCaption}
                  columns={contentColumns}
                  rows={content}
                  rowKey={(row) => row.postId}
                />
              </CardBody>
              {/* Stated rather than silent: a capped list that looks complete is
                  worse than one that says it is capped. */}
              {contentCapped && <CardFooter>{analyticsCopy.content.capped(content.length)}</CardFooter>}
            </>
          ) : (
            <CardBody>
              <Note>{analyticsCopy.content.empty}</Note>
            </CardBody>
          )}
        </Card>

        {/* Retention reports its own absence rather than drawing an averaged
            curve. A retention curve is per-post; averaging across posts with
            different sample counts produces a plausible shape with nothing
            behind it. */}
        <Card>
          <CardHeader as="h2" title={analyticsCopy.retention.heading} />
          <CardBody>
            <Note>
              {retentionCount > 0
                ? analyticsCopy.retention.pending(retentionCount)
                : analyticsCopy.retention.none}
            </Note>
          </CardBody>
        </Card>
      </PageStack>
    </AppPage>
  );
}

/* ==========================================================================
   CHARTS
   ======================================================================== */

/** viewBox units, matching `TimeSeriesChart` so the two read as one system. */
const PLOT = {
  width: 800,
  height: 260,
  padding: { top: 16, right: 16, bottom: 28, left: 48 },
} as const;

/**
 * A server-rendered line chart.
 *
 * NOT `TimeSeriesChart`, and the reason is a defect rather than a preference:
 * `TimeSeriesChart` is a client component whose `formatValue` and `formatX` props
 * are functions, and React refuses to serialise a function across the server →
 * client boundary. Rendering it from a server page returns HTTP 500 with
 * "Functions cannot be passed directly to Client Components" — reproduced on a
 * throwaway route, and it affects `/app`'s performance chart identically.
 * `ChartFrame` is a server component, so the same formatters are fine there.
 *
 * This composes the shared chrome — title, legend, the exact-value data table,
 * the empty state — with the shared `geometry` module, so nothing about the
 * system's look is re-invented here. What is lost is the hover crosshair, which is
 * the only reason that chart crosses the client boundary at all; the values it
 * would reveal are already in the table underneath. Once `TimeSeriesChart` takes a
 * serialisable format descriptor instead of a function, both panels here should
 * switch back to it.
 */
function LineChart({
  id,
  title,
  series,
  formatValue,
  formatX,
  area = false,
}: {
  id: string;
  title: string;
  series: readonly Series[];
  formatValue: (value: number) => string;
  formatX: (value: number) => string;
  area?: boolean;
}) {
  const scale = buildScale(series, PLOT);
  const ticks = yTicks(scale);

  return (
    <ChartFrame
      id={id}
      title={title}
      series={series}
      formatValue={formatValue}
      formatX={formatX}
    >
      <svg
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        // The table in ChartFrame is the accessible equivalent, so the drawing
        // itself is hidden rather than given a redundant description.
        aria-hidden="true"
        role="presentation"
        preserveAspectRatio="none"
        className="h-[16rem] w-full"
      >
        {/* Grid. Recessive by design — a grid that competes with the data is a
            worse chart. Horizontal only; vertical rules add nothing when the x
            axis is already labelled. */}
        {ticks.map((tick) => (
          <line
            key={tick}
            x1={PLOT.padding.left}
            y1={scale.y(tick)}
            x2={PLOT.width - PLOT.padding.right}
            y2={scale.y(tick)}
            stroke="var(--chart-grid)"
            strokeWidth="1"
          />
        ))}

        {/* Axis labels wear text ink, never a series colour. */}
        {ticks.map((tick) => (
          <text
            key={`label-${tick}`}
            x={PLOT.padding.left - 8}
            y={scale.y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            fill="var(--chart-axis)"
            className="app-figure"
            fontSize="11"
          >
            {formatValue(tick)}
          </text>
        ))}

        {area && series[0] && (
          <path d={areaPath(series[0].points, scale)} fill="var(--chart-fill-1)" stroke="none" />
        )}

        {series.map((item, index) => (
          <path
            key={item.id}
            d={linePath(item.points, scale)}
            fill="none"
            stroke={seriesColorVar(index)}
            strokeWidth="2"
            strokeDasharray={seriesDashVar(index)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </ChartFrame>
  );
}

/* ==========================================================================
   SMALL PARTS
   ======================================================================== */

/** A quiet explanatory line. One or two sentences, never a paragraph in a card. */
function Note({ children, className }: { children: string; className?: string }) {
  return (
    <p
      className={cn(
        "max-w-[70ch] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * A measure the platform did not report.
 *
 * An em dash, plus the reason for anyone reading with a screen reader. Never 0 —
 * "not reported" and "zero" are different facts and a table that renders them
 * identically is lying about one of them.
 */
function NotReported() {
  return <Absent reason={analyticsCopy.notReported} />;
}

function Absent({ reason }: { reason: string }) {
  return (
    <span className="text-[color:var(--text-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{reason}</span>
    </span>
  );
}

function Figure({ value, format }: { value: number | null; format: "count" | "compact" }) {
  if (value === null) return <NotReported />;
  return <>{format === "compact" ? compactFormatter.format(value) : countFormatter.format(value)}</>;
}

/** A KPI tile with its period comparison. */
function TrendKpi({
  label,
  value,
  change,
  days,
  icon,
}: {
  label: string;
  value: string;
  change: number | null;
  days: number;
  icon: React.ReactNode;
}) {
  return (
    <KpiCard
      label={label}
      value={value}
      icon={icon}
      detail={
        change === null ? (
          <span className="text-[color:var(--text-muted)]">{analyticsCopy.noPrior}</span>
        ) : (
          <>
            <Delta percent={change} />
            <span className="truncate text-[color:var(--text-muted)]">
              {analyticsCopy.comparisonLabel(days)}
            </span>
          </>
        )
      }
    />
  );
}

/**
 * Publishing cadence — one cell per day in the range.
 *
 * A real `<table>` rather than a drawing with a table beside it: weeks are rows,
 * weekdays are columns, and every cell prints its exact count. That makes the
 * markup itself the accessible equivalent, and it means the tint is redundant
 * reinforcement rather than the only channel carrying the value.
 *
 * The three states are deliberate. A day with no `analytics_daily` row is NOT a
 * day with zero posts — it is a day the rollup has not covered — so it renders as
 * an outlined cell with an em dash, never as a 0.
 */
function CadenceGrid({
  from,
  to,
  counts,
}: {
  from: Date;
  to: Date;
  counts: ReadonlyMap<string, number>;
}) {
  // Pad to whole weeks so every row has seven cells and the columns stay aligned
  // with their weekday headers. `getUTCDay()` is 0 for Sunday; the grid starts on
  // Monday, which is how a publishing week is read.
  const startOffset = (from.getUTCDay() + 6) % 7;
  const gridStart = shiftDays(from, -startOffset);
  const endOffset = 6 - ((to.getUTCDay() + 6) % 7);
  const gridEnd = shiftDays(to, endOffset);
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;
  const weeks = totalDays / 7;

  const fromKey = dayKey(from);
  const toKey = dayKey(to);

  return (
    <div className="max-h-[22rem] overflow-auto">
      <table className="border-collapse">
        <caption className="sr-only">{analyticsCopy.cadence.caption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 z-[var(--z-raised)] bg-[var(--surface-primary)] px-[var(--space-2)] pb-[var(--space-2)] text-left"
            >
              <span className="sr-only">Week beginning</span>
            </th>
            {WEEKDAYS.map((weekday, index) => (
              <th
                key={index}
                scope="col"
                // `app-label` is licensed here: §16 reserves uppercase for table
                // column headers and month-grid weekday headers, and this is both.
                className="app-label sticky top-0 z-[var(--z-raised)] bg-[var(--surface-primary)] px-1 pb-[var(--space-2)] text-center"
              >
                <span aria-hidden="true">{weekday.short}</span>
                <span className="sr-only">{weekday.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, week) => {
            const weekStart = shiftDays(gridStart, week * 7);
            return (
              <tr key={dayKey(weekStart)}>
                <th
                  scope="row"
                  className="whitespace-nowrap px-[var(--space-2)] py-0.5 text-left text-[length:var(--text-app-label)] font-normal text-[color:var(--text-muted)]"
                >
                  {dayFormatter.format(weekStart)}
                </th>
                {Array.from({ length: 7 }, (_, offset) => {
                  const day = shiftDays(weekStart, offset);
                  const key = dayKey(day);
                  const inRange = key >= fromKey && key <= toKey;
                  return (
                    <td key={key} className="px-1 py-0.5">
                      {inRange ? (
                        <CadenceCell day={day} count={counts.get(key) ?? null} />
                      ) : (
                        <span className="sr-only">Outside the selected range</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="mt-[var(--space-3)] flex flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-2)]">
        <LegendKey
          className="border-dashed border-[var(--border-default)] text-[color:var(--text-muted)]"
          label={analyticsCopy.cadence.legendNone}
        />
        <LegendKey
          className="border-transparent bg-[var(--surface-muted)] text-[color:var(--text-muted)]"
          label={analyticsCopy.cadence.legendZero}
        />
        <LegendKey
          className="border-transparent bg-[var(--brand-soft)] text-[color:var(--brand-ink)]"
          label={analyticsCopy.cadence.legendSome}
        />
      </ul>
    </div>
  );
}

function CadenceCell({ day, count }: { day: Date; count: number | null }) {
  const label = dayFormatter.format(day);

  if (count === null) {
    return (
      <span
        title={`${label}: ${analyticsCopy.cadence.legendNone}`}
        className={cn(
          "flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-chip)] px-1",
          "border border-dashed border-[var(--border-default)]",
          "text-[length:var(--text-app-label-xs)] text-[color:var(--text-muted)]",
        )}
      >
        <span aria-hidden="true">—</span>
        <span className="sr-only">{analyticsCopy.cadence.legendNone}</span>
      </span>
    );
  }

  return (
    <span
      title={`${label}: ${count} ${count === 1 ? "post" : "posts"}`}
      className={cn(
        "app-figure flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-chip)] px-1",
        "text-[length:var(--text-app-label-xs)]",
        count === 0
          ? "bg-[var(--surface-muted)] text-[color:var(--text-muted)]"
          : "bg-[var(--brand-soft)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
      )}
    >
      {count}
    </span>
  );
}

function LegendKey({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]">
      <span
        aria-hidden="true"
        className={cn("size-4 shrink-0 rounded-[var(--radius-chip)] border", className)}
      />
      {label}
    </li>
  );
}
