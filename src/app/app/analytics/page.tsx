import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { analyticsDaily, connectedAccounts, contentMetrics } from "@/lib/db/schema.fragment";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel, PanelSection } from "@/components/app-ui/Panel";
import { Metric, MetricRow } from "@/components/app-ui/Metric";
import { EmptyState } from "@/components/app-ui/States";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { TimeSeriesChart } from "@/components/app-ui/charts/TimeSeriesChart";
import { CategoryBars } from "@/components/app-ui/charts/CategoryBars";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { PLATFORM_OPTIONS } from "@/content/create";
import { analyticsCopy, RANGE_OPTIONS } from "@/content/analytics";

export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const countFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const VALID_PLATFORMS = new Set<string>(PLATFORM_OPTIONS.map((option) => option.id));
const VALID_RANGES = new Map(RANGE_OPTIONS.map((option) => [option.id, option.days]));

/**
 * Analytics.
 *
 * Reads `analytics_daily`, the pre-aggregated rollup, rather than summing
 * `content_metrics` per request. The rollup exists precisely so this page is a
 * handful of grouped reads instead of a scan over every captured metric row.
 *
 * Retention is the one measure that cannot come from the rollup — it is a curve
 * per post, not a daily scalar — so it is reported separately and omitted when no
 * post has one.
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
        <AuthMessage
          tone="notice"
          title="Not available to your role"
          body="Viewing analytics requires the analytics.view permission. An administrator can change this from the Team page."
        />
      </AppPage>
    );
  }

  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const rangeParam = single("range");
  const days = (rangeParam ? VALID_RANGES.get(rangeParam) : undefined) ?? 28;
  const platformParam = single("platform");

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  const fromDay = from.toISOString().slice(0, 10);

  const scope: SQL[] = [
    eq(analyticsDaily.workspaceId, context.workspaceId),
    gte(analyticsDaily.day, fromDay),
  ];
  if (platformParam && VALID_PLATFORMS.has(platformParam)) {
    scope.push(sql`${analyticsDaily.platform}::text = ${platformParam}`);
  }
  const where = and(...scope);

  const [totals, timeline, byPlatform, byAccount, retention] = await Promise.all([
    db
      .select({
        views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
        reach: sql<number>`coalesce(sum(${analyticsDaily.reach}), 0)::int`,
        engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
        followers: sql<number>`coalesce(sum(${analyticsDaily.followersGained}), 0)::int`,
        posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
        completionBp: sql<number>`coalesce(round(avg(nullif(${analyticsDaily.avgCompletionBp}, 0))), 0)::int`,
      })
      .from(analyticsDaily)
      .where(where),

    db
      .select({
        day: analyticsDaily.day,
        views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
        reach: sql<number>`coalesce(sum(${analyticsDaily.reach}), 0)::int`,
        engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
      })
      .from(analyticsDaily)
      .where(where)
      .groupBy(analyticsDaily.day)
      .orderBy(asc(analyticsDaily.day)),

    db
      .select({
        platform: analyticsDaily.platform,
        views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
        engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
      })
      .from(analyticsDaily)
      .where(and(where, sql`${analyticsDaily.platform} is not null`))
      .groupBy(analyticsDaily.platform)
      .orderBy(desc(sql`sum(${analyticsDaily.views})`)),

    db
      .select({
        id: connectedAccounts.id,
        username: connectedAccounts.username,
        platform: connectedAccounts.platform,
        views: sql<number>`coalesce(sum(${contentMetrics.views}), 0)::int`,
      })
      .from(contentMetrics)
      .innerJoin(connectedAccounts, eq(contentMetrics.connectedAccountId, connectedAccounts.id))
      .where(eq(contentMetrics.workspaceId, context.workspaceId))
      .groupBy(connectedAccounts.id, connectedAccounts.username, connectedAccounts.platform)
      .orderBy(desc(sql`sum(${contentMetrics.views})`))
      .limit(8),

    // Counted rather than fetched: the panel can report availability without
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

  const summary = totals[0];
  const hasData = timeline.length > 0;
  const retentionCount = retention[0]?.value ?? 0;

  return (
    <AppPage>
      <PageHeader
        title={analyticsCopy.title}
        description={analyticsCopy.body}
        meta={[
          context.workspaceName,
          `LAST ${days} DAYS`,
          ...(platformParam && VALID_PLATFORMS.has(platformParam)
            ? [
                PLATFORM_OPTIONS.find((option) => option.id === platformParam)?.label ??
                  platformParam,
              ]
            : []),
        ]}
      />

      <Panel className="mt-[var(--space-8)]">
        <FilterBar
          searchPlaceholder="Search"
          filters={[
            { key: "range", label: "Range", options: RANGE_OPTIONS },
            { key: "platform", label: "Platform", options: PLATFORM_OPTIONS },
          ]}
        />
      </Panel>

      {!hasData ? (
        <div className="mt-[var(--space-6)] max-w-[var(--measure-prose)]">
          <EmptyState title={analyticsCopy.empty.title} body={analyticsCopy.empty.body} />
        </div>
      ) : (
        <div className="mt-[var(--space-6)] flex flex-col gap-[var(--space-6)]">
          <Panel>
            <MetricRow columns={5}>
              <Metric
                label="Views"
                value={compactFormatter.format(summary?.views ?? 0)}
                explains="Total video and post views."
              />
              <Metric
                label="Reach"
                value={compactFormatter.format(summary?.reach ?? 0)}
                explains="Unique accounts reached."
              />
              <Metric
                label="Engagements"
                value={compactFormatter.format(summary?.engagements ?? 0)}
                explains="Likes, comments, shares and saves."
              />
              <Metric
                label="Followers gained"
                value={countFormatter.format(summary?.followers ?? 0)}
                explains="Net new followers."
              />
              <Metric
                label="Avg completion"
                value={
                  summary && summary.completionBp > 0
                    ? `${(summary.completionBp / 100).toFixed(1)}%`
                    : "—"
                }
                explains={
                  summary && summary.completionBp > 0
                    ? "Share of the video watched, averaged."
                    : "No completion data captured yet."
                }
              />
            </MetricRow>
          </Panel>

          <Panel>
            <TimeSeriesChart
              title={`Performance — last ${days} days`}
              series={[
                {
                  id: "views",
                  label: "Views",
                  points: timeline.map((row) => ({ x: new Date(row.day).getTime(), y: row.views })),
                },
                {
                  id: "reach",
                  label: "Reach",
                  points: timeline.map((row) => ({ x: new Date(row.day).getTime(), y: row.reach })),
                },
                {
                  id: "engagements",
                  label: "Engagements",
                  points: timeline.map((row) => ({
                    x: new Date(row.day).getTime(),
                    y: row.engagements,
                  })),
                },
              ]}
              formatValue={(value) => compactFormatter.format(value)}
              formatX={(value) =>
                new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
            />
          </Panel>

          <div className="grid gap-[var(--space-6)] xl:grid-cols-2">
            <Panel className="min-w-0">
              <PanelSection title="Platform comparison" id="analytics-platforms">
                {byPlatform.length > 0 ? (
                  <CategoryBars
                    data={byPlatform.flatMap((row) =>
                      row.platform === null
                        ? []
                        : [
                            {
                              id: row.platform,
                              label:
                                PLATFORM_OPTIONS.find((option) => option.id === row.platform)
                                  ?.label ?? row.platform,
                              value: row.views,
                              detail: `${compactFormatter.format(row.engagements)} engagements`,
                            },
                          ],
                    )}
                    formatValue={(value) => compactFormatter.format(value)}
                  />
                ) : (
                  <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                    {analyticsCopy.noPlatformData}
                  </p>
                )}
              </PanelSection>
            </Panel>

            <Panel className="min-w-0">
              <PanelSection title="Account performance" id="analytics-accounts">
                {byAccount.length > 0 ? (
                  <CategoryBars
                    data={byAccount.map((row) => ({
                      id: row.id,
                      label: row.username ? `@${row.username}` : row.platform,
                      value: row.views,
                    }))}
                    formatValue={(value) => compactFormatter.format(value)}
                  />
                ) : (
                  <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                    {analyticsCopy.noAccountData}
                  </p>
                )}
              </PanelSection>
            </Panel>
          </div>

          {/* Retention reports its own absence rather than drawing an averaged
              curve. A retention curve is per-post; averaging across posts with no
              samples would produce a plausible shape with nothing behind it. */}
          <Panel>
            <PanelSection title="Retention" id="analytics-retention">
              <p className="prose-measure text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                {retentionCount > 0
                  ? analyticsCopy.retentionPending(retentionCount)
                  : analyticsCopy.noRetention}
              </p>
            </PanelSection>
          </Panel>
        </div>
      )}
    </AppPage>
  );
}
