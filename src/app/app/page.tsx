import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Clock, Plus } from "lucide-react";
import { readSession, displayName } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { relativeDay } from "@/lib/format";
import {
  WINDOW_DAYS,
  readActivity,
  readFunnel,
  readGenerationActivity,
  readKpis,
  readPlatformTotals,
  readQueue,
  readTimeline,
  type Trend,
} from "@/lib/overview/data";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel, PanelSection } from "@/components/app-ui/Panel";
import { Metric, MetricRow, Delta } from "@/components/app-ui/Metric";
import { EmptyState } from "@/components/app-ui/States";
import { Progress } from "@/components/app-ui/Progress";
import { CategoryBars } from "@/components/app-ui/charts/CategoryBars";
/**
 * Imported directly rather than through `next/dynamic`.
 *
 * It is a client component, so the client boundary already splits it into this
 * route's client chunk — and because the chart is hand-rolled SVG with no
 * charting library behind it, a separate lazy chunk would cost an extra request
 * to defer a few kilobytes. `next/dynamic` with `ssr: false` is also not
 * permitted inside a Server Component, and server-rendering it is desirable
 * anyway: the data table it contains is then present on first paint.
 */
import { TimeSeriesChart } from "@/components/app-ui/charts/TimeSeriesChart";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { StatusDot } from "@/components/primitives/StatusDot";
import { PLATFORM_OPTIONS } from "@/content/create";
import { overviewCopy } from "@/content/overview";

export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const QUEUE_LIMIT = 6;
const ACTIVITY_LIMIT = 6;

const PLATFORM_LABELS = new Map(PLATFORM_OPTIONS.map((option) => [option.id, option.label]));

const countFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Overview — the operations centre.
 *
 * Every figure is a real aggregate over this workspace. A workspace that has
 * published nothing therefore has nothing to chart, and the page says so and
 * offers the three actions that would change it rather than rendering a KPI
 * strip of zeros against a flat line. An unexplained row of zeros reads as a
 * broken product; a stated empty state reads as a new one.
 */
export default async function OverviewPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor(PRODUCT_HOME));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const workspaceId = context.workspaceId;

  const [kpis, timeline, platforms, queue, activity, funnel, generation] = await Promise.all([
    readKpis(workspaceId),
    readTimeline(workspaceId),
    readPlatformTotals(workspaceId),
    readQueue(workspaceId, QUEUE_LIMIT),
    readActivity(workspaceId, ACTIVITY_LIMIT),
    readFunnel(workspaceId),
    readGenerationActivity(workspaceId),
  ]);

  const name = displayName(context.user);
  const canCreate = can(context.role, "content.create");

  // "Nothing at all" is a stronger signal than "no campaigns": a workspace
  // mid-generation has content but no performance yet, and it should see the
  // pipeline panels rather than the first-run state.
  const hasNothing =
    funnel.contentItems === 0 && funnel.variants === 0 && kpis.activeAccounts === 0;
  const hasPerformance = timeline.length > 0;

  return (
    <AppPage>
      <PageHeader
        eyebrow={overviewCopy.eyebrow}
        title={name ? `${greetingVerb()}, ${name}.` : `${greetingVerb()}.`}
        meta={[
          context.workspaceName,
          context.brands.find((brand) => brand.id === context.brandId)?.name ?? "No brand",
          overviewCopy.windowLabel(WINDOW_DAYS),
        ]}
        actions={
          canCreate ? (
            <ButtonLink href="/app/create">
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              New campaign
            </ButtonLink>
          ) : undefined
        }
      />

      {hasNothing ? (
        <div className="mt-[var(--space-8)] max-w-[var(--measure-prose)]">
          <EmptyState
            title={overviewCopy.empty.title}
            body={overviewCopy.empty.body}
            actions={
              <>
                {canCreate && <ButtonLink href="/app/create">Create first campaign</ButtonLink>}
                <ButtonLink href="/app/accounts" variant="secondary">
                  Connect an account
                </ButtonLink>
                <ButtonLink href="/app/library" variant="secondary">
                  Upload existing content
                </ButtonLink>
              </>
            }
          />
        </div>
      ) : (
        <div className="mt-[var(--space-8)] flex flex-col gap-[var(--space-6)]">
          {/* KPI strip. Borderless metrics inside one panel rather than five
              cards — a row of numbers is one object, and boxing each turns five
              facts into five competing surfaces. */}
          <Panel>
            <MetricRow columns={5}>
              <TrendMetric
                label="Views"
                trend={kpis.views}
                format={compactFormatter}
                explains={`Across all platforms, last ${WINDOW_DAYS} days.`}
              />
              <TrendMetric
                label="Posts published"
                trend={kpis.postsPublished}
                format={countFormatter}
                explains="Confirmed published by the platform."
              />
              <TrendMetric
                label="Engagement rate"
                trend={kpis.engagementRateBp}
                format={countFormatter}
                asBasisPoints
                explains="Daily average, weighted equally per day."
              />
              <TrendMetric
                label="Followers gained"
                trend={kpis.followersGained}
                format={countFormatter}
                explains="Net new followers on connected accounts."
              />
              <Metric
                label="Active accounts"
                value={countFormatter.format(kpis.activeAccounts)}
                explains="Authorised and not disconnected."
              />
            </MetricRow>
          </Panel>

          {/* An asymmetric split rather than an even grid: the timeline is the
              page's primary reading and earns the wider column. */}
          <div className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
            <Panel className="min-w-0">
              {hasPerformance ? (
                <TimeSeriesChart
                  title={`Performance — last ${WINDOW_DAYS} days`}
                  series={[
                    {
                      id: "views",
                      label: "Views",
                      points: timeline.map((point) => ({
                        x: new Date(point.day).getTime(),
                        y: point.views,
                      })),
                    },
                    {
                      id: "engagements",
                      label: "Engagements",
                      points: timeline.map((point) => ({
                        x: new Date(point.day).getTime(),
                        y: point.engagements,
                      })),
                    },
                  ]}
                  area
                  formatValue={(value) => compactFormatter.format(value)}
                  formatX={(value) =>
                    new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }
                />
              ) : (
                <PanelSection title="Performance" id="overview-performance">
                  <p className="prose-measure text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                    {overviewCopy.noPerformance}
                  </p>
                </PanelSection>
              )}
            </Panel>

            <Panel className="min-w-0">
              <PanelSection title="Platform distribution" id="overview-platforms">
                {platforms.length > 0 ? (
                  <CategoryBars
                    data={platforms.map((row) => ({
                      id: row.platform,
                      label: PLATFORM_LABELS.get(row.platform) ?? row.platform,
                      value: row.views,
                      detail: `${countFormatter.format(row.posts)} posts`,
                    }))}
                    formatValue={(value) => compactFormatter.format(value)}
                  />
                ) : (
                  <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                    {overviewCopy.noPlatformData}
                  </p>
                )}
              </PanelSection>
            </Panel>
          </div>

          <div className="grid gap-[var(--space-6)] xl:grid-cols-3">
            <Panel className="min-w-0">
              <PanelSection
                title="Publishing queue"
                id="overview-queue"
                aside={
                  <Link
                    href="/app/calendar"
                    className="rounded-[var(--radius-sm)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)] transition-colors duration-[var(--dur-instant)] hover:text-[color:var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
                  >
                    Calendar
                  </Link>
                }
              >
                {queue.length > 0 ? (
                  <ul className="flex flex-col">
                    {queue.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-[var(--space-3)] border-t border-[var(--color-border-hairline)] py-[var(--space-3)] first:border-t-0 first:pt-0"
                      >
                        {/* Icon plus text, never colour alone: a failed post is
                            distinguishable from a waiting one without hue. */}
                        {item.status === "failed" ? (
                          <AlertTriangle
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.5}
                            className="shrink-0 text-[color:var(--color-error)]"
                          />
                        ) : (
                          <Clock
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.5}
                            className="shrink-0 text-[color:var(--color-text-muted)]"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[length:var(--text-app-meta)] text-[color:var(--color-text-primary)]">
                            {item.campaignName ?? "Untitled campaign"}
                          </span>
                          <span className="block font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                            {PLATFORM_LABELS.get(item.platform) ?? item.platform}
                            {item.accountHandle ? ` · @${item.accountHandle}` : ""}
                            {" · "}
                            {relativeDay(item.scheduledFor)}
                            {item.status === "failed" ? " · failed" : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                    {overviewCopy.noQueue}
                  </p>
                )}
              </PanelSection>
            </Panel>

            {/* Teal only where the machine is genuinely working — an idle queue
                is neutral, not teal. */}
            <Panel className="min-w-0">
              <PanelSection title="Generation activity" id="overview-generation">
                <dl className="flex flex-col gap-[var(--space-3)]">
                  <div className="flex items-center justify-between gap-[var(--space-3)]">
                    <dt className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                      Running
                    </dt>
                    <dd className="flex items-center gap-[var(--space-3)]">
                      {generation.running > 0 && <StatusDot status="generating" showLabel={false} />}
                      <span className="font-utility text-[length:var(--text-metric-s)] tabular-nums text-[color:var(--color-text-primary)]">
                        {countFormatter.format(generation.running)}
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-[var(--space-3)]">
                    <dt className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                      Queued
                    </dt>
                    <dd className="font-utility text-[length:var(--text-metric-s)] tabular-nums text-[color:var(--color-text-primary)]">
                      {countFormatter.format(generation.queued)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-[var(--space-3)] border-t border-[var(--color-border-hairline)] pt-[var(--space-3)]">
                    <dt className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                      Failed
                    </dt>
                    <dd
                      className={cn(
                        "font-utility text-[length:var(--text-metric-s)] tabular-nums",
                        generation.failed > 0
                          ? "text-[color:var(--color-error)]"
                          : "text-[color:var(--color-text-primary)]",
                      )}
                    >
                      {countFormatter.format(generation.failed)}
                    </dd>
                  </div>
                </dl>

                {generation.running === 0 && generation.queued === 0 && generation.failed === 0 && (
                  <p className="mt-[var(--space-4)] text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                    {overviewCopy.noJobs}
                  </p>
                )}
              </PanelSection>
            </Panel>

            {/* The content funnel — the product's core claim, made measurable:
                one brief becoming many items becoming many published posts. */}
            <Panel className="min-w-0">
              <PanelSection title="Content funnel" id="overview-funnel">
                <FunnelRow label="Concepts" value={funnel.concepts} ceiling={funnel.concepts} />
                <FunnelRow
                  label="Content items"
                  value={funnel.contentItems}
                  ceiling={Math.max(funnel.concepts, funnel.contentItems)}
                />
                <FunnelRow label="Platform variants" value={funnel.variants} ceiling={funnel.variants} />
                <FunnelRow label="Scheduled" value={funnel.scheduled} ceiling={funnel.variants} />
                <FunnelRow label="Published" value={funnel.published} ceiling={funnel.variants} />
              </PanelSection>
            </Panel>
          </div>

          {activity.length > 0 && (
            <Panel>
              <PanelSection title="Recent activity" id="overview-activity">
                <ul className="flex flex-col">
                  {activity.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-baseline gap-[var(--space-4)] border-t border-[var(--color-border-hairline)] py-[var(--space-3)] first:border-t-0 first:pt-0"
                    >
                      <span className="min-w-0 flex-1 text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                        {event.summary ?? event.kind}
                      </span>
                      <span className="shrink-0 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                        {relativeDay(event.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </PanelSection>
            </Panel>
          )}
        </div>
      )}
    </AppPage>
  );
}

/**
 * A KPI with its comparison.
 *
 * `changePercent` is null when the previous window was zero, and that renders as
 * "no prior data" rather than as a percentage — a delta against a zero baseline
 * is not a measurable change, and "+100%" would imply it was.
 */
function TrendMetric({
  label,
  trend,
  format,
  explains,
  asBasisPoints = false,
}: {
  label: string;
  trend: Trend;
  format: Intl.NumberFormat;
  explains: string;
  asBasisPoints?: boolean;
}) {
  const value = asBasisPoints ? `${(trend.value / 100).toFixed(2)}%` : format.format(trend.value);

  return (
    <Metric
      label={label}
      value={value}
      explains={explains}
      adornment={
        trend.changePercent === null ? (
          <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
            no prior data
          </span>
        ) : (
          <Delta percent={trend.changePercent} />
        )
      }
    />
  );
}

/** One step of the funnel, as a share of the widest step at or above it. */
function FunnelRow({
  label,
  value,
  ceiling,
}: {
  label: string;
  value: number;
  ceiling: number;
}) {
  return (
    <div className="border-t border-[var(--color-border-hairline)] py-[var(--space-3)] first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-[var(--space-3)]">
        <span className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
          {label}
        </span>
        <span className="font-utility text-[length:var(--text-app-cell)] tabular-nums text-[color:var(--color-text-primary)]">
          {countFormatter.format(value)}
        </span>
      </div>
      {ceiling > 0 && (
        <Progress
          percent={(value / ceiling) * 100}
          label={`${label} as a share of the pipeline`}
          showValue={false}
          className="mt-[var(--space-2)]"
        />
      )}
    </div>
  );
}

/**
 * Local-time greeting, from the server's clock.
 *
 * A known approximation: the profile carries a timezone and this does not read
 * it yet, so a user far from the server may be greeted with the wrong part of
 * day. Flagged rather than left to look deliberate.
 */
function greetingVerb(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
