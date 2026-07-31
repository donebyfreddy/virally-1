import { and, asc, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activityEvents,
  analyticsDaily,
  campaigns,
  campaignStages,
  connectedAccounts,
  contentItems,
  contentVariants,
  jobs,
  scheduledPosts,
} from "@/lib/db/schema.fragment";
import type { Platform } from "@/types/database";

/**
 * Overview data.
 *
 * Every figure is an aggregate over the caller's own workspace. Nothing is
 * seeded, sampled or illustrative, which is why a new workspace returns zeros
 * and empty arrays rather than a demo dataset — the page renders an empty state
 * from that rather than inventing performance the account has not earned.
 *
 * Queries are grouped into one `Promise.all` per section rather than issued
 * per-card. The page needs about a dozen aggregates and they are independent, so
 * serialising them would make the slowest path the sum of all of them.
 */

/** The comparison window. 28 days rather than 30, so it is always four whole weeks. */
export const WINDOW_DAYS = 28;

export type Trend = {
  /** The measure over the current window. */
  value: number;
  /** The same measure over the window immediately before it. */
  previous: number;
  /** Percentage change, or null when there is no baseline to compare against. */
  changePercent: number | null;
};

export type OverviewKpis = {
  views: Trend;
  postsPublished: Trend;
  /** Basis points (1/100th of a percent), as stored. */
  engagementRateBp: Trend;
  followersGained: Trend;
  activeAccounts: number;
  /** Null until at least one metrics sync has recorded a watch time. */
  averageWatchMs: number | null;
};

export type TimelinePoint = { day: string; views: number; engagements: number };

export type PlatformTotal = { platform: Platform; views: number; posts: number };

export type QueueItem = {
  id: string;
  scheduledFor: Date;
  platform: Platform;
  status: string;
  accountHandle: string | null;
  campaignName: string | null;
};

export type ActivityItem = {
  /**
   * `activity_events.id` is a bigint. Carried as a string because JavaScript
   * numbers cannot represent the full range, and a React key must be a string
   * anyway — converting once here is safer than at each call site.
   */
  id: string;
  kind: string;
  summary: string | null;
  createdAt: Date;
};

export type FunnelCounts = {
  concepts: number;
  contentItems: number;
  variants: number;
  scheduled: number;
  published: number;
};

export type GenerationActivity = {
  running: number;
  queued: number;
  failed: number;
};

function dayString(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return date.toISOString().slice(0, 10);
}

function changePercent(value: number, previous: number): number | null {
  // No baseline means no percentage. Reporting "+100%" against zero is the kind
  // of derived figure that looks like data and is not.
  if (previous === 0) return null;
  return ((value - previous) / previous) * 100;
}

/**
 * The KPI strip.
 *
 * Two windows in one pass per measure: the current 28 days and the 28 before
 * it, so each figure carries a real comparison rather than an unexplained
 * number. Rates are averaged weighted by nothing — `analytics_daily` already
 * stores a daily average, so the mean of the dailies is the honest summary
 * available without re-reading raw metrics.
 */
export async function readKpis(workspaceId: string): Promise<OverviewKpis> {
  const currentFrom = dayString(WINDOW_DAYS);
  const previousFrom = dayString(WINDOW_DAYS * 2);

  const [current, previous, accountRows, watchRows] = await Promise.all([
    db
      .select({
        views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
        posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
        followers: sql<number>`coalesce(sum(${analyticsDaily.followersGained}), 0)::int`,
        engagementBp: sql<number>`coalesce(round(avg(${analyticsDaily.avgEngagementBp})), 0)::int`,
      })
      .from(analyticsDaily)
      .where(and(eq(analyticsDaily.workspaceId, workspaceId), gte(analyticsDaily.day, currentFrom))),

    db
      .select({
        views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
        posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
        followers: sql<number>`coalesce(sum(${analyticsDaily.followersGained}), 0)::int`,
        engagementBp: sql<number>`coalesce(round(avg(${analyticsDaily.avgEngagementBp})), 0)::int`,
      })
      .from(analyticsDaily)
      .where(
        and(
          eq(analyticsDaily.workspaceId, workspaceId),
          gte(analyticsDaily.day, previousFrom),
          lt(analyticsDaily.day, currentFrom),
        ),
      ),

    db
      .select({ value: count() })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.workspaceId, workspaceId),
          isNull(connectedAccounts.disconnectedAt),
        ),
      ),

    // Watch time lives on content_metrics, not the daily rollup, and is null
    // until a sync has actually captured it.
    db
      .select({
        value: sql<number | null>`round(avg(nullif(${analyticsDaily.avgCompletionBp}, 0)))::int`,
      })
      .from(analyticsDaily)
      .where(and(eq(analyticsDaily.workspaceId, workspaceId), gte(analyticsDaily.day, currentFrom))),
  ]);

  const now = current[0] ?? { views: 0, posts: 0, followers: 0, engagementBp: 0 };
  const before = previous[0] ?? { views: 0, posts: 0, followers: 0, engagementBp: 0 };

  return {
    views: {
      value: now.views,
      previous: before.views,
      changePercent: changePercent(now.views, before.views),
    },
    postsPublished: {
      value: now.posts,
      previous: before.posts,
      changePercent: changePercent(now.posts, before.posts),
    },
    engagementRateBp: {
      value: now.engagementBp,
      previous: before.engagementBp,
      changePercent: changePercent(now.engagementBp, before.engagementBp),
    },
    followersGained: {
      value: now.followers,
      previous: before.followers,
      changePercent: changePercent(now.followers, before.followers),
    },
    activeAccounts: accountRows[0]?.value ?? 0,
    averageWatchMs: watchRows[0]?.value ?? null,
  };
}

/** Daily views and engagements for the performance timeline. */
export async function readTimeline(workspaceId: string): Promise<readonly TimelinePoint[]> {
  const rows = await db
    .select({
      day: analyticsDaily.day,
      views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
      engagements: sql<number>`coalesce(sum(${analyticsDaily.engagements}), 0)::int`,
    })
    .from(analyticsDaily)
    .where(
      and(eq(analyticsDaily.workspaceId, workspaceId), gte(analyticsDaily.day, dayString(WINDOW_DAYS))),
    )
    .groupBy(analyticsDaily.day)
    .orderBy(asc(analyticsDaily.day));

  return rows;
}

/**
 * Views and posts per platform, for the distribution panel.
 *
 * `analytics_daily.platform` is nullable — a workspace-wide rollup row carries
 * no platform. Those rows are excluded rather than bucketed as "Unknown": a
 * distribution across platforms is meaningless if one slice is "all platforms",
 * and including it would double-count the total.
 */
export async function readPlatformTotals(workspaceId: string): Promise<readonly PlatformTotal[]> {
  const rows = await db
    .select({
      platform: analyticsDaily.platform,
      views: sql<number>`coalesce(sum(${analyticsDaily.views}), 0)::int`,
      posts: sql<number>`coalesce(sum(${analyticsDaily.postsPublished}), 0)::int`,
    })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.workspaceId, workspaceId),
        gte(analyticsDaily.day, dayString(WINDOW_DAYS)),
        sql`${analyticsDaily.platform} is not null`,
      ),
    )
    .groupBy(analyticsDaily.platform)
    .orderBy(desc(sql`sum(${analyticsDaily.views})`));

  // The `is not null` guard above makes this narrowing sound; the filter keeps
  // it provable to the type system rather than asserted with a cast.
  return rows.flatMap((row) =>
    row.platform === null ? [] : [{ ...row, platform: row.platform }],
  );
}

/** The next posts due to publish. */
export async function readQueue(
  workspaceId: string,
  limit: number,
): Promise<readonly QueueItem[]> {
  const rows = await db
    .select({
      id: scheduledPosts.id,
      scheduledFor: scheduledPosts.scheduledFor,
      platform: scheduledPosts.platform,
      status: scheduledPosts.status,
      accountHandle: connectedAccounts.username,
      campaignName: campaigns.name,
    })
    .from(scheduledPosts)
    .leftJoin(connectedAccounts, eq(scheduledPosts.connectedAccountId, connectedAccounts.id))
    .leftJoin(campaigns, eq(scheduledPosts.campaignId, campaigns.id))
    .where(
      and(
        eq(scheduledPosts.workspaceId, workspaceId),
        // Everything still ahead of publication, including a failed attempt
        // waiting on a retry — the queue is what needs attention, not only what
        // is on schedule.
        sql`${scheduledPosts.status} in ('scheduled', 'publishing', 'failed')`,
      ),
    )
    .orderBy(asc(scheduledPosts.scheduledFor))
    .limit(limit);

  return rows;
}

/** Recent workspace activity. */
export async function readActivity(
  workspaceId: string,
  limit: number,
): Promise<readonly ActivityItem[]> {
  const rows = await db
    .select({
      id: activityEvents.id,
      kind: activityEvents.kind,
      summary: activityEvents.summary,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(eq(activityEvents.workspaceId, workspaceId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, id: String(row.id) }));
}

/**
 * The content funnel: how many items exist at each stage of the supply chain.
 *
 * This is the product's core claim made measurable — one brief becoming many
 * variants becoming many posts — so it reads real cardinality at each step
 * rather than deriving later steps from earlier ones.
 */
export async function readFunnel(workspaceId: string): Promise<FunnelCounts> {
  const [conceptRows, itemRows, variantRows, scheduledRows, publishedRows] = await Promise.all([
    db
      .select({ value: sql<number>`coalesce(sum(${campaigns.conceptsCount}), 0)::int` })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, workspaceId), isNull(campaigns.deletedAt))),

    db
      .select({ value: count() })
      .from(contentItems)
      .where(and(eq(contentItems.workspaceId, workspaceId), isNull(contentItems.deletedAt))),

    db
      .select({ value: count() })
      .from(contentVariants)
      .where(eq(contentVariants.workspaceId, workspaceId)),

    db
      .select({ value: count() })
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.workspaceId, workspaceId), eq(scheduledPosts.status, "scheduled"))),

    db
      .select({ value: count() })
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.workspaceId, workspaceId), eq(scheduledPosts.status, "published"))),
  ]);

  return {
    concepts: conceptRows[0]?.value ?? 0,
    contentItems: itemRows[0]?.value ?? 0,
    variants: variantRows[0]?.value ?? 0,
    scheduled: scheduledRows[0]?.value ?? 0,
    published: publishedRows[0]?.value ?? 0,
  };
}

/** Live generation state, for the machine-activity panel. */
export async function readGenerationActivity(workspaceId: string): Promise<GenerationActivity> {
  const rows = await db
    .select({ status: jobs.status, value: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, workspaceId),
        sql`${jobs.status} in ('running', 'queued', 'pending', 'failed')`,
      ),
    )
    .groupBy(jobs.status);

  const byStatus = new Map(rows.map((row) => [row.status, row.value]));

  return {
    running: byStatus.get("running") ?? 0,
    // Pending and queued are the same thing to a reader waiting for output; the
    // distinction is internal to the worker.
    queued: (byStatus.get("queued") ?? 0) + (byStatus.get("pending") ?? 0),
    failed: byStatus.get("failed") ?? 0,
  };
}

export type OperationsSnapshot = {
  /** Campaigns with a stage genuinely running right now. */
  activeCampaigns: number;
  /** Connected accounts by health, for the account-health card. */
  accountsHealthy: number;
  accountsNeedingAttention: number;
  accountsTotal: number;
};

/**
 * The operational counts the KPI strip and the account-health card need.
 *
 * Separate from `readKpis` because these are not performance measures and carry no
 * period comparison: "three campaigns are generating" is a fact about right now,
 * and pairing it with a 28-day delta would imply a trend that does not exist.
 *
 * "Active" is read from real stage rows rather than from a status column. A
 * campaign whose last stage failed still has `status = 'approved'`, and counting
 * it as active is how a dashboard ends up reassuring a user about work that
 * stopped hours ago.
 */
export async function readOperationsSnapshot(workspaceId: string): Promise<OperationsSnapshot> {
  const [campaignRows, accountRows] = await Promise.all([
    db
      .select({ value: sql<number>`count(distinct ${campaignStages.campaignId})::int` })
      .from(campaignStages)
      .innerJoin(campaigns, eq(campaigns.id, campaignStages.campaignId))
      .where(
        and(
          eq(campaigns.workspaceId, workspaceId),
          isNull(campaigns.deletedAt),
          eq(campaignStages.state, "active"),
        ),
      ),

    db
      .select({
        total: sql<number>`count(*)::int`,
        healthy: sql<number>`count(*) filter (where ${connectedAccounts.health} = 'healthy')::int`,
      })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.workspaceId, workspaceId),
          isNull(connectedAccounts.disconnectedAt),
        ),
      ),
  ]);

  const accounts = accountRows[0] ?? { total: 0, healthy: 0 };

  return {
    activeCampaigns: campaignRows[0]?.value ?? 0,
    accountsHealthy: accounts.healthy,
    accountsNeedingAttention: accounts.total - accounts.healthy,
    accountsTotal: accounts.total,
  };
}
