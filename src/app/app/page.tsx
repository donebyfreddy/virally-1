import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Check,
  Clock,
  Eye,
  Heart,
  LayoutGrid,
  Plus,
  Send,
  Sparkles,
  TrendingUp,
  UserPlus,
  Zap,
} from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { relativeDay } from "@/lib/format";
import { readBalance } from "@/lib/creative/credits";
import { tenantScope } from "@/lib/creative/scope";
import { getStorageAdapter } from "@/lib/storage";
import {
  WINDOW_DAYS,
  readActivity,
  readFunnel,
  readGenerationActivity,
  readKpis,
  readOperationsSnapshot,
  readPlatformTotals,
  readQueue,
  readTimeline,
  readTopContent,
  type PlatformTotal,
  type TopContentItem,
  type Trend,
} from "@/lib/overview/data";
import { AppPage, DashGrid, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader, SectionHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { Delta } from "@/components/app-ui/Metric";
import { EmptyState } from "@/components/app-ui/States";
import { Progress } from "@/components/app-ui/Progress";
import { DataTable, type Column } from "@/components/app-ui/DataTable";
import { CategoryBars } from "@/components/app-ui/charts/CategoryBars";
/**
 * Imported directly rather than through `next/dynamic`.
 *
 * It is a client component, so the client boundary already splits it into this
 * route's client chunk — and because the chart is hand-rolled SVG with no charting
 * library behind it, a separate lazy chunk would cost an extra request to defer a
 * few kilobytes. `next/dynamic` with `ssr: false` is also not permitted inside a
 * Server Component, and server-rendering it is desirable anyway: the data table it
 * contains is then present on first paint.
 */
import { TimeSeriesChart } from "@/components/app-ui/charts/TimeSeriesChart";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { PLATFORM_OPTIONS } from "@/content/create";
import { overviewCopy, setupSteps, type SetupStep } from "@/content/overview";
import type { Platform } from "@/types/database";

export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const QUEUE_LIMIT = 5;
const ACTIVITY_LIMIT = 6;
const THUMBNAIL_TTL_SECONDS = 60 * 10;

const PLATFORM_LABELS = new Map(PLATFORM_OPTIONS.map((option) => [option.id, option.label]));

const countFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type PlatformRow = { platform: Platform; views: number; posts: number };

/**
 * Overview — the operations centre.
 *
 * Every figure is a real aggregate over this workspace. A workspace that has
 * published nothing therefore has nothing to chart, and the page says so and
 * offers the three actions that would change it rather than rendering a KPI strip
 * of zeros against a flat line. An unexplained row of zeros reads as a broken
 * product; a stated empty state reads as a new one.
 *
 * The layout is a 12-column grid with deliberately unequal spans: the performance
 * chart takes 8 and the operational rail takes 4, because the chart is the page's
 * primary reading and the rail is four answers to "is anything wrong?". A grid of
 * equal thirds would give a scheduling conflict the same visual weight as
 * four weeks of growth.
 */
export default async function OverviewPage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor(PRODUCT_HOME));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const workspaceId = context.workspaceId;

  const [kpis, timeline, platforms, topContent, queue, activity, funnel, generation, operations, credits] =
    await Promise.all([
      readKpis(workspaceId),
      readTimeline(workspaceId),
      readPlatformTotals(workspaceId),
      readTopContent(workspaceId),
      readQueue(workspaceId, QUEUE_LIMIT),
      readActivity(workspaceId, ACTIVITY_LIMIT),
      readFunnel(workspaceId),
      readGenerationActivity(workspaceId),
      readOperationsSnapshot(workspaceId),
      readBalance(tenantScope(context.organizationId, workspaceId)),
    ]);

  const canCreate = can(context.role, "content.create");

  const storage = getStorageAdapter();
  const topContentCards = await Promise.all(
    topContent.map(async (item) => ({
      ...item,
      thumbnailUrl: item.thumbnail
        ? await storage.getSignedUrl(
            item.thumbnail.bucket,
            item.thumbnail.storagePath,
            THUMBNAIL_TTL_SECONDS,
          )
        : null,
    })),
  );

  // "Nothing at all" is a stronger signal than "no campaigns": a workspace
  // mid-generation has content but no performance yet, and it should see the
  // pipeline panels rather than the first-run state.
  const hasNothing =
    funnel.contentItems === 0 && funnel.variants === 0 && operations.accountsTotal === 0;
  const hasPerformance = timeline.length > 0;
  const bestPlatform = platforms[0] ?? null;
  const insights = buildInsights({ platforms, topContent, funnel, generation });

  const platformColumns: readonly Column<PlatformRow>[] = [
    {
      id: "platform",
      header: "Platform",
      cell: (row) => (
        <span className="font-[var(--weight-strong)] text-[color:var(--text-primary)]">
          {PLATFORM_LABELS.get(row.platform) ?? row.platform}
        </span>
      ),
    },
    {
      id: "views",
      header: "Views",
      numeric: true,
      cell: (row) => compactFormatter.format(row.views),
    },
    {
      id: "posts",
      header: "Posts",
      numeric: true,
      cell: (row) => countFormatter.format(row.posts),
    },
    {
      id: "perPost",
      header: "Views / post",
      numeric: true,
      hideBelow: "sm",
      cell: (row) =>
        row.posts > 0 ? compactFormatter.format(Math.round(row.views / row.posts)) : "—",
    },
  ];

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={overviewCopy.title}
          description={overviewCopy.body}
          meta={[
            context.workspaceName,
            context.brands.find((brand) => brand.id === context.brandId)?.name ?? "No brand",
            overviewCopy.windowLabel(WINDOW_DAYS),
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

        {hasNothing ? (
          /* First run. The empty state is deliberately compact and the checklist
             below is the real content — a page that says "nothing here yet" and
             then leaves a screen and a half of canvas has replaced one problem
             with another. */
          <>
            <Card>
              <EmptyState
                bare
                icon={<Zap size={20} strokeWidth={1.75} />}
                title={overviewCopy.empty.title}
                body={overviewCopy.empty.body}
                actions={
                  <>
                    {canCreate && <ButtonLink href="/app/create">Create first campaign</ButtonLink>}
                    <ButtonLink href="/app/library" variant="secondary">
                      Upload existing content
                    </ButtonLink>
                  </>
                }
              />
            </Card>

            <section aria-labelledby="setup-heading">
              <SectionHeader
                id="setup-heading"
                title={overviewCopy.setupHeading}
                description={overviewCopy.setupBody}
              />
              <ol className="mt-[var(--space-4)] grid gap-[var(--app-panel-gap)] md:grid-cols-3">
                {setupSteps.map((step, index) => (
                  <li key={step.id}>
                    <SetupCard
                      step={step}
                      index={index}
                      // Read from real workspace state, so a step ticks itself once
                      // the work is genuinely done rather than when the user
                      // clicked past it.
                      done={
                        step.id === "campaign"
                          ? funnel.concepts > 0 || funnel.contentItems > 0
                          : step.id === "account"
                            ? operations.accountsTotal > 0
                            : funnel.scheduled > 0
                      }
                    />
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : (
          <>
            <KpiGrid columns={6}>
              <TrendKpi
                label={overviewCopy.kpis.views}
                trend={kpis.views}
                format={compactFormatter}
                icon={<Eye size={14} strokeWidth={1.75} />}
              />
              <TrendKpi
                label={overviewCopy.kpis.posts}
                trend={kpis.postsPublished}
                format={countFormatter}
                icon={<Send size={14} strokeWidth={1.75} />}
              />
              <TrendKpi
                label={overviewCopy.kpis.engagement}
                trend={kpis.engagementRateBp}
                format={countFormatter}
                asBasisPoints
                icon={<Heart size={14} strokeWidth={1.75} />}
              />
              <TrendKpi
                label={overviewCopy.kpis.followers}
                trend={kpis.followersGained}
                format={countFormatter}
                icon={<UserPlus size={14} strokeWidth={1.75} />}
              />
              <KpiCard
                label={overviewCopy.kpis.campaigns}
                value={countFormatter.format(operations.activeCampaigns)}
                icon={<LayoutGrid size={14} strokeWidth={1.75} />}
                tone={operations.activeCampaigns > 0 ? "brand" : "neutral"}
                href="/app/campaigns"
                detail={
                  <span className="text-[color:var(--text-muted)]">
                    {operations.activeCampaigns > 0 ? "Generating now" : "Nothing generating"}
                  </span>
                }
              />
              <KpiCard
                label={overviewCopy.kpis.accounts}
                value={countFormatter.format(operations.accountsTotal)}
                icon={<AtSign size={14} strokeWidth={1.75} />}
                tone={operations.accountsNeedingAttention > 0 ? "warning" : "neutral"}
                href="/app/accounts"
                detail={
                  operations.accountsNeedingAttention > 0 ? (
                    <span className="text-[color:var(--warning)]">
                      {operations.accountsNeedingAttention} need attention
                    </span>
                  ) : (
                    <span className="text-[color:var(--text-muted)]">All healthy</span>
                  )
                }
              />
            </KpiGrid>

            <DashGrid>
              {/* The chart takes two thirds. It is the page's primary reading. */}
              <Card className="min-w-0 lg:col-span-2 xl:col-span-8">
                <CardBody>
                  {hasPerformance ? (
                    <TimeSeriesChart
                      title={`${overviewCopy.sections.performance} — last ${WINDOW_DAYS} days`}
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
                        new Date(value).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                  ) : (
                    /* Centred, because this card is stretched to the height of the
                       four-card rail beside it. Top-aligned, the note clung to the
                       ceiling of a 400px void and read as a rendering failure. */
                    <div className="flex min-h-[15rem] flex-col justify-center">
                      <h2 className="app-card-title text-[color:var(--text-primary)]">
                        {overviewCopy.sections.performance}
                      </h2>
                      <p className="mt-[var(--space-2)] max-w-[60ch] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
                        {overviewCopy.noPerformance}
                      </p>
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* The operational rail: four compact answers to "is anything
                  wrong?". Stacked rather than gridded, because they are read top
                  to bottom in order of urgency. */}
              <div className="flex min-w-0 flex-col gap-[var(--app-panel-gap)] lg:col-span-2 xl:col-span-4">
                <CreditCard available={credits.available} reserved={credits.reserved} />
                <AccountHealthCard
                  healthy={operations.accountsHealthy}
                  attention={operations.accountsNeedingAttention}
                  total={operations.accountsTotal}
                />
                <BestPlatformCard row={bestPlatform} />
                <GenerationCard
                  running={generation.running}
                  queued={generation.queued}
                  failed={generation.failed}
                />
              </div>
            </DashGrid>

            <DashGrid>
              <Card className="min-w-0 xl:col-span-4">
                <CardHeader
                  as="h2"
                  title={overviewCopy.sections.queue}
                  divided
                  action={<CardLink href="/app/calendar">Calendar</CardLink>}
                />
                <CardBody>
                  {queue.length > 0 ? (
                    <ul className="flex flex-col gap-[var(--space-3)]">
                      {queue.map((item) => (
                        <li key={item.id} className="flex items-start gap-[var(--space-3)]">
                          {/* Icon plus text, never colour alone: a failed post is
                              distinguishable from a waiting one without hue. */}
                          {item.status === "failed" ? (
                            <AlertTriangle
                              aria-hidden="true"
                              size={15}
                              strokeWidth={1.75}
                              className="mt-0.5 shrink-0 text-[color:var(--error)]"
                            />
                          ) : (
                            <Clock
                              aria-hidden="true"
                              size={15}
                              strokeWidth={1.75}
                              className="mt-0.5 shrink-0 text-[color:var(--text-muted)]"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
                              {item.campaignName ?? "Untitled campaign"}
                            </span>
                            <span className="block truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
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
                    <QuietNote>{overviewCopy.noQueue}</QuietNote>
                  )}
                </CardBody>
              </Card>

              {/* The content funnel — the product's core claim, made measurable:
                  one brief becoming many items becoming many published posts. */}
              <Card className="min-w-0 xl:col-span-4">
                <CardHeader as="h2" title={overviewCopy.sections.funnel} divided />
                <CardBody>
                  <FunnelRow label="Concepts" value={funnel.concepts} ceiling={funnel.concepts} />
                  <FunnelRow
                    label="Content items"
                    value={funnel.contentItems}
                    ceiling={Math.max(funnel.concepts, funnel.contentItems)}
                  />
                  <FunnelRow
                    label="Platform variants"
                    value={funnel.variants}
                    ceiling={funnel.variants}
                  />
                  <FunnelRow label="Scheduled" value={funnel.scheduled} ceiling={funnel.variants} />
                  <FunnelRow label="Published" value={funnel.published} ceiling={funnel.variants} />
                </CardBody>
              </Card>

              <Card className="min-w-0 xl:col-span-4">
                <CardHeader
                  as="h2"
                  title={overviewCopy.sections.activity}
                  divided
                  action={<CardLink href="/app/campaigns">Campaigns</CardLink>}
                />
                <CardBody>
                  {activity.length > 0 ? (
                    <ul className="flex flex-col gap-[var(--space-3)]">
                      {activity.map((event) => (
                        <li
                          key={event.id}
                          className="flex items-baseline justify-between gap-[var(--space-3)]"
                        >
                          <span className="min-w-0 flex-1 text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                            {event.summary ?? event.kind}
                          </span>
                          <span className="shrink-0 whitespace-nowrap text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                            {relativeDay(event.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <QuietNote>No activity recorded yet.</QuietNote>
                  )}
                </CardBody>
              </Card>
            </DashGrid>

            <DashGrid>
              <Card className="min-w-0 overflow-hidden xl:col-span-5">
                <CardHeader
                  as="h2"
                  title="AI performance insights"
                  description="Recommendations generated from this workspace’s measured output."
                  divided
                  action={
                    <span className="flex size-8 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[color:var(--brand-ink)]">
                      <Sparkles aria-hidden="true" size={15} strokeWidth={1.9} />
                    </span>
                  }
                />
                <CardBody>
                  {insights.length > 0 ? (
                    <ul className="flex flex-col gap-[var(--space-4)]">
                      {insights.map((insight, index) => (
                        <li key={insight} className="flex items-start gap-[var(--space-3)]">
                          <span
                            aria-hidden="true"
                            className="app-figure flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-full)] bg-[var(--brand-soft)] text-[length:var(--text-app-label)] font-[var(--weight-heading)] text-[color:var(--brand-ink)]"
                          >
                            {index + 1}
                          </span>
                          <p className="text-[length:var(--text-app-cell)] leading-6 text-[color:var(--text-secondary)]">
                            {insight}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <QuietNote>
                      Publish and sync performance data to unlock recommendations grounded in real results.
                    </QuietNote>
                  )}
                </CardBody>
              </Card>

              <Card className="min-w-0 overflow-hidden xl:col-span-7">
                <CardHeader
                  as="h2"
                  title="Top-performing content"
                  description={`Ranked by cumulative views in the last ${WINDOW_DAYS} days.`}
                  divided
                  action={<CardLink href="/app/content">All content</CardLink>}
                />
                <CardBody pad="none">
                  {topContentCards.length > 0 ? (
                    <ol className="divide-y divide-[var(--border-subtle)]">
                      {topContentCards.map((item, index) => (
                        <li key={`${item.id}:${item.platform}`}>
                          <Link
                            href={`/app/content/${item.id}`}
                            className="group flex items-center gap-[var(--space-3)] px-[var(--app-panel-pad)] py-[var(--space-3)] transition-colors duration-[var(--dur-instant)] hover:bg-[var(--surface-secondary)]"
                          >
                            <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] bg-[linear-gradient(145deg,var(--brand-soft),var(--brand-soft-border))] text-[color:var(--brand-ink)]">
                              {item.thumbnailUrl ? (
                                // Signed tenant media may be served by different hosts per deployment,
                                // so a fixed-size lazy image is safer than a global remote allowlist.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.thumbnailUrl}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  width={48}
                                  height={48}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <TrendingUp aria-hidden="true" size={18} strokeWidth={1.8} />
                              )}
                              <span className="app-figure absolute bottom-1 right-1 rounded-[var(--radius-chip)] bg-[rgb(255_255_255_/_0.9)] px-1 text-[length:var(--text-app-label-xs)] font-[var(--weight-heading)] shadow-[var(--elevation-card)]">
                                {index + 1}
                              </span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)] group-hover:text-[color:var(--brand-primary)]">
                                {item.title}
                              </span>
                              <span className="mt-0.5 block text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                                {PLATFORM_LABELS.get(item.platform) ?? item.platform}
                              </span>
                            </span>
                            <span className="grid shrink-0 grid-cols-2 gap-[var(--space-4)] text-right sm:grid-cols-3">
                              <MiniMetric label="Views" value={compactFormatter.format(item.views)} />
                              <MiniMetric
                                label="Retention"
                                value={item.completionRateBp === null ? "—" : `${(item.completionRateBp / 100).toFixed(1)}%`}
                              />
                              <MiniMetric
                                label="Engagement"
                                value={item.engagementRateBp === null ? "—" : `${(item.engagementRateBp / 100).toFixed(1)}%`}
                                className="hidden sm:block"
                              />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="p-[var(--app-panel-pad)]">
                      <QuietNote>No published content has synced performance data in this window.</QuietNote>
                    </div>
                  )}
                </CardBody>
              </Card>
            </DashGrid>

            <Card>
              <CardHeader
                as="h2"
                title={overviewCopy.sections.platforms}
                description={`Views and volume by channel, last ${WINDOW_DAYS} days.`}
                divided
                action={<CardLink href="/app/analytics">Analytics</CardLink>}
              />
              {platforms.length > 0 ? (
                <>
                  <CardBody>
                    <CategoryBars
                      data={platforms.map((row) => ({
                        id: row.platform,
                        label: PLATFORM_LABELS.get(row.platform) ?? row.platform,
                        value: row.views,
                        detail: `${countFormatter.format(row.posts)} posts`,
                      }))}
                      formatValue={(value) => compactFormatter.format(value)}
                    />
                  </CardBody>
                  <CardBody pad="none" className="border-t border-[var(--border-subtle)]">
                    <DataTable
                      caption="Platform performance"
                      columns={platformColumns}
                      rows={platforms as readonly PlatformRow[]}
                      rowKey={(row) => row.platform}
                    />
                  </CardBody>
                </>
              ) : (
                <CardBody>
                  <QuietNote>{overviewCopy.noPlatformData}</QuietNote>
                </CardBody>
              )}
            </Card>
          </>
        )}
      </PageStack>
    </AppPage>
  );
}

/**
 * One step of the first-run checklist.
 *
 * The completed state is carried by a filled teal tile with a checkmark AND by the
 * word "Done", never by colour alone. The step number stays visible when
 * incomplete so the sequence is readable as a sequence.
 */
function SetupCard({
  step,
  index,
  done,
}: {
  step: SetupStep;
  index: number;
  done: boolean;
}) {
  return (
    <Card as="article" interactive className="flex h-full flex-col" pad="default">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-full)]",
            "text-[length:var(--text-app-label)] font-[var(--weight-heading)]",
            done
              ? "bg-[var(--brand-primary)] text-[color:var(--text-on-brand)]"
              : "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
          )}
        >
          {done ? <Check size={14} strokeWidth={3} /> : index + 1}
        </span>
        {done && (
          <span
            className={cn(
              "rounded-[var(--radius-chip)] px-2 py-0.5",
              "bg-[var(--brand-soft)] text-[length:var(--text-app-label)]",
              "font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
            )}
          >
            Done
          </span>
        )}
      </div>

      <h3 className="app-card-title mt-[var(--space-3)] text-[color:var(--text-primary)]">
        {step.title}
      </h3>
      <p className="mt-1 flex-1 text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
        {step.body}
      </p>

      <CardLink href={step.href} className="mt-[var(--space-4)]">
        {step.action}
      </CardLink>
    </Card>
  );
}

/* ==========================================================================
   RAIL CARDS
   ======================================================================== */

/**
 * Production credit status.
 *
 * Shows held credits as a share of granted, because "why is my balance lower than
 * I expected?" is answered by the hold, not by the balance. Zero granted renders as
 * a plain figure rather than a 0/0 bar, which would read as an error.
 */
function CreditCard({ available, reserved }: { available: number; reserved: number }) {
  return (
    <Card pad="default" className="min-w-0">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <h2 className="app-card-title text-[color:var(--text-primary)]">
          {overviewCopy.sections.credits}
        </h2>
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-chip)] bg-[var(--brand-soft)] text-[color:var(--brand-ink)]"
        >
          <Zap size={14} strokeWidth={1.75} />
        </span>
      </div>

      <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-metric)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
        {countFormatter.format(available)}
        <span className="ml-1 text-[length:var(--text-app-meta)] font-normal text-[color:var(--text-muted)]">
          available
        </span>
      </p>

      {reserved > 0 && (
        <p className="mt-1 text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]">
          <span className="app-figure">{countFormatter.format(reserved)}</span> held for work in
          flight
        </p>
      )}

      <CardLink href="/app/usage" className="mt-[var(--space-3)]">
        Usage and top-up
      </CardLink>
    </Card>
  );
}

/**
 * Account health.
 *
 * The count of accounts needing attention leads when there are any, because that is
 * the actionable half. Both halves are always stated in words as well as colour.
 */
function AccountHealthCard({
  healthy,
  attention,
  total,
}: {
  healthy: number;
  attention: number;
  total: number;
}) {
  return (
    <Card pad="default" className="min-w-0">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <h2 className="app-card-title text-[color:var(--text-primary)]">
          {overviewCopy.sections.accounts}
        </h2>
        {attention > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-[var(--radius-chip)] px-2 py-0.5",
              "bg-[var(--warning-soft)] text-[length:var(--text-app-label)]",
              "font-[var(--weight-strong)] text-[color:var(--warning)]",
            )}
          >
            Action needed
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="mt-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
          {overviewCopy.noAccounts}
        </p>
      ) : (
        <>
          <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-metric)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
            {countFormatter.format(healthy)}
            <span className="text-[color:var(--text-muted)]">/{countFormatter.format(total)}</span>
            <span className="ml-1 text-[length:var(--text-app-meta)] font-normal text-[color:var(--text-muted)]">
              healthy
            </span>
          </p>
          <Progress
            percent={(healthy / total) * 100}
            label="Accounts in a healthy state"
            showValue={false}
            className="mt-[var(--space-3)]"
          />
          {attention > 0 && (
            <p className="mt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--warning)]">
              {attention === 1
                ? "1 account needs reconnecting"
                : `${attention} accounts need reconnecting`}
            </p>
          )}
        </>
      )}

      <CardLink href="/app/accounts" className="mt-[var(--space-3)]">
        Manage accounts
      </CardLink>
    </Card>
  );
}

/** The single best-performing channel, by views in the window. */
function BestPlatformCard({ row }: { row: PlatformRow | null }) {
  return (
    <Card pad="default" className="min-w-0">
      <h2 className="app-card-title text-[color:var(--text-primary)]">Best-performing platform</h2>
      {row ? (
        <>
          <p className="mt-[var(--space-2)] text-[length:var(--text-metric-s)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
            {PLATFORM_LABELS.get(row.platform) ?? row.platform}
          </p>
          <p className="app-figure mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
            {compactFormatter.format(row.views)} views · {countFormatter.format(row.posts)} posts
          </p>
        </>
      ) : (
        <p className="mt-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
          {overviewCopy.noPlatformData}
        </p>
      )}
    </Card>
  );
}

/**
 * Live generation state.
 *
 * Teal only where the machine is genuinely working — an idle queue is neutral, not
 * teal, or the accent stops meaning anything.
 */
function GenerationCard({
  running,
  queued,
  failed,
}: {
  running: number;
  queued: number;
  failed: number;
}) {
  const idle = running === 0 && queued === 0 && failed === 0;

  return (
    <Card pad="default" className="min-w-0">
      <h2 className="app-card-title text-[color:var(--text-primary)]">
        {overviewCopy.sections.generation}
      </h2>

      {idle ? (
        <p className="mt-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
          {overviewCopy.noJobs}
        </p>
      ) : (
        <dl className="mt-[var(--space-3)] grid grid-cols-3 gap-[var(--space-2)]">
          <div>
            <dt className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              Running
            </dt>
            <dd className="app-figure flex items-center gap-1.5 text-[length:var(--text-metric-s)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
              {running > 0 && (
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-[var(--radius-full)] bg-[var(--brand-mark)] motion-safe:animate-pulse"
                />
              )}
              {countFormatter.format(running)}
            </dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              Queued
            </dt>
            <dd className="app-figure text-[length:var(--text-metric-s)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
              {countFormatter.format(queued)}
            </dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              Failed
            </dt>
            <dd
              className={cn(
                "app-figure text-[length:var(--text-metric-s)] font-[var(--weight-heading)]",
                failed > 0 ? "text-[color:var(--error)]" : "text-[color:var(--text-primary)]",
              )}
            >
              {countFormatter.format(failed)}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

/* ==========================================================================
   SMALL PARTS
   ======================================================================== */

/**
 * A KPI tile with its period comparison.
 *
 * `changePercent` is null when the previous window was zero, and that renders as
 * "no prior data" rather than as a percentage — a delta against a zero baseline is
 * not a measurable change, and "+100%" would imply it was.
 */
function TrendKpi({
  label,
  trend,
  format,
  icon,
  asBasisPoints = false,
}: {
  label: string;
  trend: Trend;
  format: Intl.NumberFormat;
  icon: React.ReactNode;
  asBasisPoints?: boolean;
}) {
  const value = asBasisPoints ? `${(trend.value / 100).toFixed(2)}%` : format.format(trend.value);

  return (
    <KpiCard
      label={label}
      value={value}
      icon={icon}
      detail={
        trend.changePercent === null ? (
          <span className="text-[color:var(--text-muted)]">no prior data</span>
        ) : (
          <>
            <Delta percent={trend.changePercent} />
            <span className="text-[color:var(--text-muted)]">vs previous</span>
          </>
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
    <div className="border-t border-[var(--border-subtle)] py-[var(--space-3)] first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-[var(--space-3)]">
        <span className="text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
          {label}
        </span>
        <span className="app-figure text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
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

/** A card's trailing link. Teal, small, and never a button — it navigates. */
function CardLink({
  href,
  children,
  className,
}: {
  href: string;
  children: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-chip)]",
        "text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:text-[color:var(--brand-primary-hover)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        className,
      )}
    >
      {children}
      <ArrowRight aria-hidden="true" size={13} strokeWidth={2} />
    </Link>
  );
}

/** An empty-panel note. One line, muted, never a paragraph inside a card. */
function QuietNote({ children }: { children: string }) {
  return (
    <p className="max-w-[52ch] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
      {children}
    </p>
  );
}

function MiniMetric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <span className={className}>
      <span className="app-label block">{label}</span>
      <span className="app-figure mt-0.5 block text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
        {value}
      </span>
    </span>
  );
}

function buildInsights({
  platforms,
  topContent,
  funnel,
  generation,
}: {
  platforms: readonly PlatformTotal[];
  topContent: readonly TopContentItem[];
  funnel: { contentItems: number; variants: number; scheduled: number; published: number };
  generation: { running: number; queued: number; failed: number };
}): string[] {
  const insights: string[] = [];
  const leading = topContent[0];

  if (leading?.completionRateBp !== null && leading?.completionRateBp !== undefined) {
    insights.push(
      `“${leading.title}” is the strongest retained post at ${(leading.completionRateBp / 100).toFixed(1)}%. Use its opening structure as the next hook benchmark.`,
    );
  }

  const [first, second] = platforms;
  if (first && second && first.posts > 0 && second.posts > 0) {
    const firstPerPost = first.views / first.posts;
    const secondPerPost = second.views / second.posts;
    if (secondPerPost > 0) {
      const lift = Math.round(((firstPerPost - secondPerPost) / secondPerPost) * 100);
      if (lift > 0) {
        insights.push(
          `${PLATFORM_LABELS.get(first.platform) ?? first.platform} is delivering ${lift}% more views per post than ${PLATFORM_LABELS.get(second.platform) ?? second.platform}. Prioritize a fresh variant there.`,
        );
      }
    }
  }

  if (funnel.contentItems > 0 && funnel.variants < funnel.contentItems * 2) {
    insights.push(
      `${funnel.contentItems} content items currently have ${funnel.variants} platform variants. Adapting the strongest items can expand distribution without starting a new campaign.`,
    );
  }

  if (generation.failed > 0) {
    insights.push(
      `${generation.failed} generation ${generation.failed === 1 ? "job needs" : "jobs need"} attention before the current batch can move cleanly into review.`,
    );
  } else if (funnel.scheduled === 0 && funnel.published > 0) {
    insights.push("Nothing is scheduled next. Reuse a proven format to protect publishing consistency.");
  }

  return insights.slice(0, 3);
}
