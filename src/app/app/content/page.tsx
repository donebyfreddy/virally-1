import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  ArrowRight,
  Clock,
  Film,
  Image as ImageIcon,
  Layers,
  LayoutList,
  Plus,
  Send,
  Type,
} from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  campaigns,
  contentItems,
  contentMetrics,
  contentVariants,
  mediaAssets,
  scheduledPosts,
} from "@/lib/db/schema.fragment";
import { getStorageAdapter, type StorageBucket } from "@/lib/storage";
import { formatDuration, formatMetric, relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader, SectionHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { CellThumb, DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { PLATFORM_OPTIONS } from "@/content/create";
import {
  APPROVAL_OPTIONS,
  CONTENT_SORT_OPTIONS,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_OPTIONS,
  contentCopy,
  contentRoutes,
} from "@/content/content-library";
import type { ReviewStatus } from "@/types/database";

export const metadata: Metadata = {
  title: "Content",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 36;
const countFormatter = new Intl.NumberFormat("en-US");

/**
 * Thumbnail URL lifetime.
 *
 * Longer than the adapter's 5-minute default: this page is `force-dynamic`, so a
 * user who opens it and then scrolls back several minutes later would otherwise
 * hit expired URLs and see broken tiles across the grid.
 */
const THUMBNAIL_TTL_SECONDS = 900;

const VALID_STATUSES = new Set<string>(APPROVAL_OPTIONS.map((option) => option.id));
const VALID_TYPES = new Set<string>(CONTENT_TYPE_OPTIONS.map((option) => option.id));
const VALID_PLATFORMS = new Set<string>(PLATFORM_OPTIONS.map((option) => option.id));
const VALID_SORTS = new Set<string>(CONTENT_SORT_OPTIONS.map((option) => option.id));

type ContentRow = {
  id: string;
  title: string;
  contentType: string;
  language: string;
  status: ReviewStatus;
  durationMs: number | null;
  origin: string;
  updatedAt: Date;
  campaignId: string | null;
  campaignName: string | null;
  variantCount: number;
  publishedCount: number;
  /** Comma-separated platform ids, or null when the item has no variants. */
  platforms: string | null;
};

/** Everything the list knows about one item, after the second query phase. */
type ContentCard = ContentRow & {
  thumbnailUrl: string | null;
  /** Null means no platform reported the figure — never rendered as 0. */
  views: number | null;
  engagements: number | null;
};

function platformLabels(platforms: string | null): string[] {
  if (!platforms) return [];
  return platforms
    .split(", ")
    .map(
      (platform) =>
        PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform,
    );
}

function formatLabel(contentType: string): string {
  return CONTENT_TYPE_LABELS[contentType] ?? contentType;
}

/**
 * Content.
 *
 * Lists content ITEMS with their variant count, rather than listing every
 * variant. A 5-concept campaign across 4 platforms and 2 languages produces 40
 * variants from 5 items — a flat variant list is unreadable at that
 * multiplication, and the item is the unit a person actually reasons about.
 *
 * Every filter is applied in SQL from a validated URL param, so a filtered list
 * is a shareable link and the back button undoes a filter. The KPI strip is
 * queried unfiltered on purpose: a "total items" figure computed from the current
 * 36-row slice would describe the filter rather than the workspace.
 *
 * Two query phases, not one. Thumbnails and performance figures are keyed by the
 * ids on this page, which are only known once the first phase returns — and the
 * thumbnail URLs then have to be signed, which is asynchronous per object.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/content"));

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
  const typeParam = single("type");
  const campaignParam = single("campaign");
  const platformParam = single("platform");
  const variantParam = single("variant");
  const sortParam = single("sort");
  const view = single("view") === "table" ? "table" : "grid";

  const status = statusParam && VALID_STATUSES.has(statusParam) ? statusParam : null;
  const sort = sortParam && VALID_SORTS.has(sortParam) ? sortParam : "recent";

  // Everything except the review state. The status tabs need counts that respect
  // the other filters but not their own dimension — a tab showing 0 because the
  // status filter excluded it would make every tab except the active one read 0.
  const base: SQL[] = [
    eq(contentItems.workspaceId, context.workspaceId),
    isNull(contentItems.deletedAt),
  ];

  if (query) base.push(ilike(contentItems.title, `%${query}%`));
  if (typeParam && VALID_TYPES.has(typeParam)) {
    // Compared as SQL rather than through `eq`, because the column carries a
    // `$type<>` union and the validated param is a plain string — casting it into
    // that union would assert what `VALID_TYPES` has already proved.
    base.push(sql`${contentItems.contentType} = ${typeParam}`);
  }
  // Campaign arrives from a link on the campaign detail page. Validated as a
  // uuid shape before it reaches SQL rather than trusted as an opaque string.
  if (campaignParam && /^[0-9a-f-]{36}$/i.test(campaignParam)) {
    base.push(eq(contentItems.campaignId, campaignParam));
  }
  if (platformParam && VALID_PLATFORMS.has(platformParam)) {
    // Membership, not equality: the platform lives on the item's variants.
    base.push(sql`exists (
      select 1 from content_variants cv
      where cv.content_item_id = ${contentItems.id} and cv.platform::text = ${platformParam}
    )`);
  }
  if (variantParam && VALID_STATUSES.has(variantParam)) {
    // A distinct dimension from the tabs above, not a duplicate of them: the tabs
    // read the ITEM's review state, this reads whether any of its variants sits in
    // a given state. "Which items have something approved and ready to publish" is
    // not answerable from the item's own status, because approval is per variant.
    base.push(sql`exists (
      select 1 from content_variants cv
      where cv.content_item_id = ${contentItems.id} and cv.status::text = ${variantParam}
    )`);
  }

  const baseWhere = and(...base);
  const where = status ? and(baseWhere, eq(contentItems.status, status as ReviewStatus)) : baseWhere;
  const inWorkspace = and(
    eq(contentItems.workspaceId, context.workspaceId),
    isNull(contentItems.deletedAt),
  );

  // `desc()` alone puts nulls first in Postgres, which would head "Longest first"
  // with every item that has no duration at all.
  const orderBy =
    sort === "created"
      ? desc(contentItems.createdAt)
      : sort === "title"
        ? asc(contentItems.title)
        : sort === "duration"
          ? sql`${contentItems.durationMs} desc nulls last`
          : desc(contentItems.updatedAt);

  const [rows, totalRows, campaignOptions, statusCounts, summaryRows, variantRows, publishedRows] =
    await Promise.all([
      db
        .select({
          id: contentItems.id,
          title: contentItems.title,
          contentType: contentItems.contentType,
          language: contentItems.language,
          status: contentItems.status,
          durationMs: contentItems.durationMs,
          origin: contentItems.origin,
          updatedAt: contentItems.updatedAt,
          campaignId: contentItems.campaignId,
          campaignName: campaigns.name,
          variantCount: sql<number>`(
            select count(*)::int from content_variants cv
            where cv.content_item_id = ${contentItems.id}
          )`,
          // Published means a post actually went out, read from scheduled_posts
          // rather than inferred from the item's review status.
          publishedCount: sql<number>`(
            select count(*)::int from scheduled_posts sp
            join content_variants cv on cv.id = sp.content_variant_id
            where cv.content_item_id = ${contentItems.id} and sp.status = 'published'
          )`,
          // The distinct platforms this item has been recomposed for, as a single
          // string — cheaper than a second query per row and enough for a cell.
          platforms: sql<string | null>`(
            select string_agg(distinct cv.platform::text, ', ' order by cv.platform::text)
            from content_variants cv where cv.content_item_id = ${contentItems.id}
          )`,
        })
        .from(contentItems)
        .leftJoin(campaigns, eq(contentItems.campaignId, campaigns.id))
        .where(where)
        .orderBy(orderBy)
        .limit(PAGE_SIZE),

      db.select({ value: sql<number>`count(*)::int` }).from(contentItems).where(where),

      // The campaign filter's options are the workspace's own campaigns, so the
      // control can never offer a campaign the user cannot see.
      db
        .select({ id: campaigns.id, label: campaigns.name })
        .from(campaigns)
        .where(and(eq(campaigns.workspaceId, context.workspaceId), isNull(campaigns.deletedAt)))
        .orderBy(desc(campaigns.updatedAt))
        .limit(50),

      db
        .select({ status: contentItems.status, value: sql<number>`count(*)::int` })
        .from(contentItems)
        .where(baseWhere)
        .groupBy(contentItems.status),

      db
        .select({
          total: sql<number>`count(*)::int`,
          review: sql<number>`count(*) filter (where ${contentItems.status} = 'awaiting_review')::int`,
        })
        .from(contentItems)
        .where(inWorkspace),

      // Joined back to the item so variants of a soft-deleted item do not inflate
      // a figure the user can no longer reach.
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(contentVariants)
        .innerJoin(contentItems, eq(contentItems.id, contentVariants.contentItemId))
        .where(and(eq(contentVariants.workspaceId, context.workspaceId), isNull(contentItems.deletedAt))),

      db
        .select({ value: sql<number>`count(*)::int` })
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.workspaceId, context.workspaceId),
            eq(scheduledPosts.status, "published"),
          ),
        ),
    ]);

  const itemIds = rows.map((row) => row.id);

  const [thumbnailRows, metricRows] = await Promise.all([
    itemIds.length === 0
      ? []
      : db
          .select({
            contentItemId: contentVariants.contentItemId,
            bucket: mediaAssets.bucket,
            storagePath: mediaAssets.storagePath,
          })
          .from(contentVariants)
          .innerJoin(mediaAssets, eq(mediaAssets.id, contentVariants.thumbnailAssetId))
          .where(
            and(inArray(contentVariants.contentItemId, itemIds), isNull(mediaAssets.deletedAt)),
          )
          .orderBy(asc(contentVariants.contentItemId), asc(contentVariants.createdAt)),

    itemIds.length === 0
      ? []
      : db
          .select({
            contentItemId: contentVariants.contentItemId,
            // Cast to bigint and read as a string: the driver returns numeric as a
            // string, so typing the sum as `number` here would be a lie.
            views: sql<string | null>`sum(${contentMetrics.views})::bigint`,
            // Null only when not one of the four interaction counters was reported
            // for any post. `nullif(sum, 0)` would erase a genuine zero, which is a
            // different fact from "the platform does not expose this".
            engagements: sql<string | null>`case
              when count(${contentMetrics.likes}) + count(${contentMetrics.comments})
                 + count(${contentMetrics.shares}) + count(${contentMetrics.saves}) = 0
              then null
              else sum(
                coalesce(${contentMetrics.likes}, 0) + coalesce(${contentMetrics.comments}, 0)
                + coalesce(${contentMetrics.shares}, 0) + coalesce(${contentMetrics.saves}, 0)
              )::bigint
            end`,
          })
          .from(contentMetrics)
          .innerJoin(contentVariants, eq(contentVariants.id, contentMetrics.contentVariantId))
          .where(
            and(
              eq(contentMetrics.workspaceId, context.workspaceId),
              inArray(contentVariants.contentItemId, itemIds),
              // `content_metrics` is an append-only hourly series, so summing it
              // raw would count the same post once per snapshot. Only the newest
              // snapshot per post is a current total, and the lookup rides
              // `content_metrics_post_time_idx`.
              sql`${contentMetrics.capturedAt} = (
                select max(latest.captured_at) from content_metrics latest
                where latest.scheduled_post_id = ${contentMetrics.scheduledPostId}
              )`,
            ),
          )
          .groupBy(contentVariants.contentItemId),
  ]);

  // First variant with a thumbnail wins, ordered above so the choice is stable
  // across renders rather than dependent on the planner.
  const thumbnailAssets = new Map<string, { bucket: StorageBucket; storagePath: string }>();
  for (const row of thumbnailRows) {
    if (!thumbnailAssets.has(row.contentItemId)) {
      thumbnailAssets.set(row.contentItemId, { bucket: row.bucket, storagePath: row.storagePath });
    }
  }

  // Media lives in object storage and is only ever read through a short-lived
  // signed URL, never a public one. Signed in parallel: a real adapter may make a
  // network call per object, and up to 36 of those in series would dominate TTFB.
  const storage = getStorageAdapter();
  const thumbnailUrls = new Map(
    await Promise.all(
      [...thumbnailAssets].map(
        async ([itemId, asset]) =>
          [
            itemId,
            await storage.getSignedUrl(asset.bucket, asset.storagePath, THUMBNAIL_TTL_SECONDS),
          ] as const,
      ),
    ),
  );

  const metrics = new Map(
    metricRows.map((row) => [
      row.contentItemId,
      {
        views: row.views === null ? null : Number(row.views),
        engagements: row.engagements === null ? null : Number(row.engagements),
      },
    ]),
  );

  const cards: ContentCard[] = rows.map((row) => ({
    ...row,
    thumbnailUrl: thumbnailUrls.get(row.id) ?? null,
    views: metrics.get(row.id)?.views ?? null,
    engagements: metrics.get(row.id)?.engagements ?? null,
  }));

  const total = totalRows[0]?.value ?? 0;
  const summary = summaryRows[0] ?? { total: 0, review: 0 };
  const variantTotal = variantRows[0]?.value ?? 0;
  const publishedTotal = publishedRows[0]?.value ?? 0;

  const filtered = Boolean(
    query || status || typeParam || campaignParam || platformParam || variantParam,
  );
  const canCreate = can(context.role, "content.create");

  const countsByStatus = new Map(statusCounts.map((row) => [row.status as string, row.value]));
  const unfilteredTotal = statusCounts.reduce((sum, row) => sum + row.value, 0);

  /** A tab href preserves every other param and resets pagination. */
  const tabHref = (next: string | null): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "status" || key === "page") continue;
      const first = Array.isArray(value) ? value[0] : value;
      if (first) search.set(key, first);
    }
    if (next) search.set("status", next);
    const serialised = search.toString();
    return serialised ? `/app/content?${serialised}` : "/app/content";
  };

  const tabs = [
    {
      id: "all",
      label: contentCopy.allStatuses,
      count: unfilteredTotal,
      href: tabHref(null),
      active: status === null,
    },
    ...APPROVAL_OPTIONS.map((option) => ({
      id: option.id,
      label: option.label,
      count: countsByStatus.get(option.id) ?? 0,
      href: tabHref(option.id),
      active: status === option.id,
    })),
  ];

  const columns: readonly Column<ContentCard>[] = [
    {
      id: "title",
      header: "Item",
      cell: (row) => (
        <PrimaryCell
          title={row.title}
          detail={row.campaignName ?? undefined}
          leading={<CellThumb src={row.thumbnailUrl} fallback={row.title} />}
        />
      ),
    },
    {
      id: "type",
      header: "Format",
      hideBelow: "sm",
      cell: (row) => (
        <span className="whitespace-nowrap">{formatLabel(row.contentType)}</span>
      ),
    },
    {
      id: "platforms",
      header: "Platforms",
      hideBelow: "lg",
      cell: (row) => <PlatformCell platforms={row.platforms} />,
    },
    {
      id: "variants",
      header: "Variants",
      numeric: true,
      hideBelow: "sm",
      cell: (row) => countFormatter.format(row.variantCount),
    },
    {
      id: "duration",
      header: "Duration",
      numeric: true,
      hideBelow: "xl",
      cell: (row) =>
        row.durationMs ? (
          formatDuration(row.durationMs / 1000)
        ) : (
          <Absent />
        ),
    },
    {
      id: "views",
      header: "Views",
      numeric: true,
      hideBelow: "md",
      cell: (row) => (row.views === null ? <Absent /> : formatMetric(row.views, "compact")),
    },
    {
      id: "engagements",
      header: "Engagement",
      numeric: true,
      hideBelow: "lg",
      cell: (row) =>
        row.engagements === null ? <Absent /> : formatMetric(row.engagements, "compact"),
    },
    {
      id: "published",
      header: "Published",
      numeric: true,
      hideBelow: "xl",
      cell: (row) => countFormatter.format(row.publishedCount),
    },
    {
      id: "status",
      header: "Approval",
      cell: (row) => (
        <span className="flex items-center gap-[var(--space-2)]">
          <StatusChip status={row.status} />
          {row.origin === "mock" && <DemoChip />}
        </span>
      ),
    },
    {
      id: "updated",
      header: "Updated",
      hideBelow: "md",
      cell: (row) => (
        <span className="whitespace-nowrap text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
          {relativeDay(row.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={contentCopy.title}
          description={contentCopy.body}
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
            label={contentCopy.kpis.items}
            value={countFormatter.format(summary.total)}
            icon={<Film size={14} strokeWidth={1.75} />}
          />
          <KpiCard
            label={contentCopy.kpis.review}
            value={countFormatter.format(summary.review)}
            tone={summary.review > 0 ? "warning" : "neutral"}
            icon={<Clock size={14} strokeWidth={1.75} />}
            href={summary.review > 0 ? "/app/content?status=awaiting_review" : undefined}
            detail={
              summary.review > 0 ? (
                <span className="text-[color:var(--warning)]">Waiting on a person</span>
              ) : (
                <span className="text-[color:var(--text-muted)]">Nothing waiting</span>
              )
            }
          />
          <KpiCard
            label={contentCopy.kpis.variants}
            value={countFormatter.format(variantTotal)}
            icon={<Layers size={14} strokeWidth={1.75} />}
            detail={
              <span className="text-[color:var(--text-muted)]">
                {summary.total > 0
                  ? `${(variantTotal / summary.total).toFixed(1)} per item`
                  : "Created when an item is recomposed"}
              </span>
            }
          />
          <KpiCard
            label={contentCopy.kpis.published}
            value={countFormatter.format(publishedTotal)}
            icon={<Send size={14} strokeWidth={1.75} />}
            href="/app/calendar"
          />
        </KpiGrid>

        <Card>
          {/* The rail sits ON the card's own hairline, so the nav pulls itself down
              a pixel rather than the band carrying a second rule of its own. */}
          <div className="border-b border-[var(--border-subtle)] pt-[var(--space-2)]">
            <nav aria-label={contentCopy.statusTabsLabel} className="-mb-px overflow-x-auto">
              <ul className="flex min-w-max items-center gap-[var(--space-1)] px-[var(--app-panel-pad-tight)]">
                {tabs.map((tab) => (
                  <li key={tab.id}>
                    <Link
                      href={tab.href}
                      aria-current={tab.active ? "page" : undefined}
                      className={cn(
                        "relative flex h-9 items-center gap-[var(--space-2)] px-[var(--space-3)]",
                        "rounded-t-[var(--radius-chip)] text-[length:var(--text-app-cell)]",
                        "transition-colors duration-[var(--dur-instant)]",
                        // The ring is inset rather than offset outward. The strip
                        // scrolls horizontally, and `overflow-x` forces the other
                        // axis to scroll too — an outward 2px ring on a tab would be
                        // clipped by that container on the very interaction it
                        // exists for. Still 2px of --focus-ring, never removed.
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                        // The 2px rail is a stroke, so it wears --brand-mark; the
                        // label is text and wears the text-safe --brand-primary.
                        "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:content-['']",
                        tab.active
                          ? "font-[var(--weight-strong)] text-[color:var(--brand-primary)] after:bg-[var(--brand-mark)]"
                          : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]",
                      )}
                    >
                      {tab.label}
                      <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                        {countFormatter.format(tab.count)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <CardBody pad="tight" className="border-b border-[var(--border-subtle)]">
            <FilterBar
              searchPlaceholder="Search content"
              views={["grid", "table"]}
              filters={[
                { key: "campaign", label: "Campaign", options: campaignOptions },
                { key: "platform", label: "Platform", options: PLATFORM_OPTIONS },
                { key: "type", label: "Format", options: CONTENT_TYPE_OPTIONS },
                { key: "variant", label: "Variant approval", options: APPROVAL_OPTIONS },
                { key: "sort", label: "Sort", options: CONTENT_SORT_OPTIONS },
              ]}
            />
          </CardBody>

          {cards.length > 0 && view === "grid" && (
            <CardBody>
              <ul
                aria-label={contentCopy.gridLabel}
                className="grid gap-[var(--app-panel-gap)] sm:grid-cols-2 xl:grid-cols-3"
              >
                {cards.map((row) => (
                  <li key={row.id}>
                    <ContentTile row={row} />
                  </li>
                ))}
              </ul>
            </CardBody>
          )}

          {cards.length > 0 && view === "table" && (
            <CardBody pad="none">
              <DataTable
                caption={contentCopy.tableCaption}
                columns={columns}
                rows={cards}
                rowKey={(row) => row.id}
                rowHref={(row) => `/app/content/${row.id}`}
              />
            </CardBody>
          )}

          {/* Stated rather than silent. A capped list that looks complete is worse
              than one that says it is capped. */}
          {cards.length > 0 && total > cards.length && (
            <CardFooter>{contentCopy.truncated(cards.length, total)}</CardFooter>
          )}

          {cards.length === 0 && filtered && (
            <EmptyState
              bare
              icon={<LayoutList size={20} strokeWidth={1.75} />}
              title={contentCopy.noMatches.title}
              body={contentCopy.noMatches.body}
              actions={
                <ButtonLink href="/app/content" variant="secondary">
                  Clear filters
                </ButtonLink>
              }
            />
          )}

          {cards.length === 0 && !filtered && (
            <EmptyState
              bare
              icon={<Film size={20} strokeWidth={1.75} />}
              title={contentCopy.empty.title}
              body={contentCopy.empty.body}
              actions={
                <>
                  {canCreate && <ButtonLink href="/app/create">Create a campaign</ButtonLink>}
                  <ButtonLink href="/app/library" variant="secondary">
                    Open the library
                  </ButtonLink>
                </>
              }
            />
          )}
        </Card>

        {/* Onboarding, not an afterthought. The empty state above is deliberately
            compact so this fits on the same screen — a first-run user needs the
            next action more than a larger apology. */}
        {summary.total === 0 && (
          <section aria-labelledby="content-routes-heading">
            <SectionHeader
              id="content-routes-heading"
              title={contentCopy.onboardingHeading}
              description={contentCopy.onboardingBody}
            />
            <ul className="mt-[var(--space-4)] grid gap-[var(--app-panel-gap)] sm:grid-cols-3">
              {contentRoutes.map((route) => (
                <li key={route.id}>
                  <Card as="article" interactive className="flex h-full flex-col">
                    <CardHeader title={route.title} as="h3" />
                    <CardBody className="flex flex-1 flex-col pt-[var(--space-2)]">
                      <p className="flex-1 text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                        {route.body}
                      </p>
                      <Link
                        href={route.href}
                        className={cn(
                          "mt-[var(--space-4)] inline-flex items-center gap-[var(--space-1)]",
                          "rounded-[var(--radius-chip)]",
                          "text-[length:var(--text-app-cell)] font-[var(--weight-strong)]",
                          "text-[color:var(--brand-ink)]",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                        )}
                      >
                        {route.cta}
                        <ArrowRight aria-hidden="true" size={14} strokeWidth={2} />
                      </Link>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PageStack>
    </AppPage>
  );
}

/**
 * Grid-view content card.
 *
 * Media-dominant, because on this surface the still IS the identity of the row —
 * a title alone does not tell a reviewer which of five hooks they are looking at.
 * The well is a fixed 4:3 with the thumbnail contained rather than cropped: a 9:16
 * still cropped to a landscape box loses the framing that is the thing being
 * judged, and a grid of 9:16 tiles pushes three items per screen.
 */
function ContentTile({ row }: { row: ContentCard }) {
  return (
    <Card as="article" interactive className="flex h-full flex-col overflow-hidden">
      <div className="relative flex aspect-[4/3] items-center justify-center bg-[var(--surface-muted)]">
        {row.thumbnailUrl ? (
          // A signed storage URL on a per-deployment host, which next/image cannot
          // optimise without a remote-pattern allowlist per tenant. The parts that
          // matter here are the reserved intrinsic box and lazy loading, both set.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={640}
            height={480}
            className="size-full object-contain"
          />
        ) : (
          // No placeholder poster. Until a variant has a thumbnail asset there is
          // no still to show, and a grey frame implies the render exists.
          <FormatGlyph contentType={row.contentType} />
        )}

        {row.origin === "mock" && (
          <span className="absolute left-[var(--space-2)] top-[var(--space-2)]">
            <DemoChip />
          </span>
        )}

        {row.durationMs !== null && (
          <span
            className={cn(
              "app-figure absolute bottom-[var(--space-2)] right-[var(--space-2)]",
              "rounded-[var(--radius-chip)] bg-[var(--surface-primary)] px-1.5 py-0.5",
              "text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]",
              "shadow-[var(--elevation-card)]",
            )}
          >
            {formatDuration(row.durationMs / 1000)}
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-[var(--space-3)] p-[var(--app-panel-pad)] pb-[var(--space-3)]">
        <div className="min-w-0">
          <h3 className="app-card-title truncate text-[color:var(--text-primary)]">
            <Link
              href={`/app/content/${row.id}`}
              className="rounded-[var(--radius-chip)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {row.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
            {[formatLabel(row.contentType), row.campaignName, row.language.toUpperCase()]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <StatusChip status={row.status} compact />
      </div>

      <div className="flex flex-1 flex-col gap-[var(--space-3)] px-[var(--app-panel-pad)] pb-[var(--app-panel-pad)]">
        <PlatformCell platforms={row.platforms} />

        <dl className="grid grid-cols-3 gap-[var(--space-2)]">
          <TileStat
            label="Views"
            value={row.views === null ? null : formatMetric(row.views, "compact")}
          />
          <TileStat
            label="Engagement"
            value={row.engagements === null ? null : formatMetric(row.engagements, "compact")}
          />
          <TileStat label="Variants" value={countFormatter.format(row.variantCount)} />
        </dl>

        <div className="mt-auto flex items-end justify-between gap-[var(--space-2)] pt-[var(--space-1)]">
          <span className="whitespace-nowrap text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {relativeDay(row.updatedAt)}
            {row.publishedCount > 0 &&
              ` · ${countFormatter.format(row.publishedCount)} published`}
          </span>

          <span className="flex items-center gap-[var(--space-3)]">
            {row.campaignId && (
              <Link
                href={`/app/campaigns/${row.campaignId}`}
                className={cn(
                  "rounded-[var(--radius-chip)] text-[length:var(--text-app-label)]",
                  "text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-instant)]",
                  "hover:text-[color:var(--text-primary)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                )}
              >
                {contentCopy.openCampaign}
                <span className="sr-only"> for {row.title}</span>
              </Link>
            )}
            <Link
              href={`/app/content/${row.id}`}
              className={cn(
                "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-chip)]",
                "text-[length:var(--text-app-label)] font-[var(--weight-strong)]",
                "text-[color:var(--brand-ink)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              )}
            >
              {contentCopy.openEditor}
              <span className="sr-only"> for {row.title}</span>
              <ArrowRight aria-hidden="true" size={13} strokeWidth={2} />
            </Link>
          </span>
        </div>
      </div>
    </Card>
  );
}

/**
 * One figure on a tile.
 *
 * `null` renders an em dash with a stated reason rather than a zero: "no platform
 * reported this" and "this got no views" are different claims, and only one of
 * them is true of an unpublished item.
 */
function TileStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="app-label truncate">{label}</dt>
      <dd
        className={cn(
          "app-figure text-[length:var(--text-metric-s)] font-[var(--weight-heading)]",
          value === null ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-primary)]",
        )}
      >
        {value ?? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{contentCopy.metricUnreported}</span>
          </>
        )}
      </dd>
    </div>
  );
}

/** A figure the platforms have not reported, in a table cell. */
function Absent() {
  return (
    <span className="text-[color:var(--text-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{contentCopy.metricUnreported}</span>
    </span>
  );
}

/**
 * Platforms for an item.
 *
 * Named, not glyphed. Platform logos at 14px are a row of indistinct smudges, and
 * two names plus a count is both shorter and unambiguous.
 */
function PlatformCell({ platforms }: { platforms: string | null }) {
  const labels = platformLabels(platforms);
  if (labels.length === 0) {
    return (
      <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
        No variants yet
      </span>
    );
  }

  const shown = labels.slice(0, 2);
  const rest = labels.length - shown.length;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((label) => (
        <span
          key={label}
          className={cn(
            "whitespace-nowrap rounded-[var(--radius-chip)] bg-[var(--surface-muted)] px-1.5 py-0.5",
            "text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]",
          )}
        >
          {label}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          +{rest}
          <span className="sr-only"> more: {labels.slice(2).join(", ")}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Provenance marker for deterministic mock output.
 *
 * Labelled wherever it appears, so a reviewer never mistakes a placeholder
 * generation for a real one.
 */
function DemoChip() {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-chip)]",
        "bg-[var(--warning-soft)] px-1.5 py-0.5",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        "text-[color:var(--warning)]",
      )}
    >
      {contentCopy.demoLabel}
    </span>
  );
}

/** Stand-in for a missing still. Decorative — the format is stated in the copy. */
function FormatGlyph({ contentType }: { contentType: string }) {
  const shared = "text-[color:var(--text-muted)]";
  if (contentType === "image" || contentType === "carousel") {
    return <ImageIcon aria-hidden="true" size={28} strokeWidth={1.25} className={shared} />;
  }
  if (contentType === "text") {
    return <Type aria-hidden="true" size={28} strokeWidth={1.25} className={shared} />;
  }
  return <Film aria-hidden="true" size={28} strokeWidth={1.25} className={shared} />;
}
