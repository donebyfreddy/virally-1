import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, gte, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { ArrowRight, LayoutGrid, Plus, Sparkles } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { campaigns, campaignStages, creditLedger, scheduledPosts } from "@/lib/db/schema.fragment";
import { currentPeriod } from "@/lib/creative/usage";
import { relativeDay, formatMetric } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader, SectionHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { Progress } from "@/components/app-ui/Progress";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { PLATFORM_OPTIONS, GOAL_OPTIONS } from "@/content/create";
import { campaignsCopy, campaignTemplates, STAGE_LABELS } from "@/content/campaigns";
import type { Platform, ReviewStatus } from "@/types/database";

export const metadata: Metadata = {
  title: "Campaigns",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const countFormatter = new Intl.NumberFormat("en-US");

const STATUS_OPTIONS: readonly { id: ReviewStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "awaiting_review", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "archived", label: "Archived" },
];

const VALID_STATUSES = new Set<string>(STATUS_OPTIONS.map((option) => option.id));
const VALID_PLATFORMS = new Set<string>(PLATFORM_OPTIONS.map((option) => option.id));
const VALID_GOALS = new Set<string>(GOAL_OPTIONS.map((option) => option.id));

/** Posts in these states are genuinely queued for a future publish. */
const PENDING_PUBLISH = ["approved", "scheduled", "queued"] as const;

type CampaignRow = {
  id: string;
  name: string;
  objective: string | null;
  status: ReviewStatus;
  platforms: Platform[];
  contentCount: number;
  publishedCount: number;
  conceptsCount: number;
  updatedAt: Date;
  activeStage: string | null;
  blockedStage: string | null;
};

function platformLabels(platforms: readonly Platform[]): string[] {
  return platforms.map(
    (platform) => PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform,
  );
}

function goalLabel(objective: string | null): string | null {
  if (!objective) return null;
  return GOAL_OPTIONS.find((option) => option.id === objective)?.label ?? objective;
}

/**
 * Campaigns.
 *
 * Filters are applied in SQL, not after fetching. A workspace can hold thousands
 * of campaigns, and fetching all of them to hide rows on the client would move the
 * whole table across the network and break on the first real account.
 *
 * The KPI strip is queried separately rather than derived from the 25 rows on this
 * page. A "total campaigns" figure computed from a paginated, filtered slice is
 * wrong by definition, and the point of the strip is that it describes the
 * workspace rather than the current filter.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/campaigns"));

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
  const platformParam = single("platform");
  const goalParam = single("goal");
  const view = single("view") === "grid" ? "grid" : "table";

  // Each filter is validated against its own option set before reaching SQL. An
  // unrecognised value is dropped rather than passed through, so a hand-edited
  // URL cannot introduce a predicate of its own.
  const conditions: SQL[] = [
    eq(campaigns.workspaceId, context.workspaceId),
    isNull(campaigns.deletedAt),
  ];

  if (query) {
    // Case-insensitive contains, backed by the trigram index on campaigns.name.
    conditions.push(ilike(campaigns.name, `%${query}%`));
  }
  if (statusParam && VALID_STATUSES.has(statusParam)) {
    conditions.push(eq(campaigns.status, statusParam as ReviewStatus));
  }
  if (platformParam && VALID_PLATFORMS.has(platformParam)) {
    // `platforms` is an array column, so this is membership, not equality.
    conditions.push(sql`${platformParam} = any(${campaigns.platforms})`);
  }
  if (goalParam && VALID_GOALS.has(goalParam)) {
    conditions.push(eq(campaigns.objective, goalParam));
  }

  const where = and(...conditions);
  const inWorkspace = and(
    eq(campaigns.workspaceId, context.workspaceId),
    isNull(campaigns.deletedAt),
  );
  const period = currentPeriod();

  // Six queries, one round trip. Sequentially this page would pay six network
  // latencies before rendering anything.
  const [rows, totalRows, summaryRows, activeRows, scheduledRows, creditRows] = await Promise.all([
    db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        objective: campaigns.objective,
        status: campaigns.status,
        platforms: campaigns.platforms,
        contentCount: campaigns.contentCount,
        publishedCount: campaigns.publishedCount,
        conceptsCount: campaigns.conceptsCount,
        updatedAt: campaigns.updatedAt,
        // Pipeline position read from real stage rows rather than inferred from
        // counters — a campaign can be mid-scripts with zero content items.
        activeStage: sql<string | null>`(
          select cs.stage from campaign_stages cs
          where cs.campaign_id = ${campaigns.id} and cs.state = 'active'
          order by cs.created_at limit 1
        )`,
        blockedStage: sql<string | null>`(
          select cs.stage from campaign_stages cs
          where cs.campaign_id = ${campaigns.id} and cs.state = 'blocked'
          order by cs.created_at limit 1
        )`,
      })
      .from(campaigns)
      .where(where)
      .orderBy(desc(campaigns.updatedAt))
      .limit(PAGE_SIZE),

    db.select({ value: sql<number>`count(*)::int` }).from(campaigns).where(where),

    // Unfiltered workspace totals for the KPI strip.
    db
      .select({
        total: sql<number>`count(*)::int`,
        review: sql<number>`count(*) filter (where ${campaigns.status} = 'awaiting_review')::int`,
      })
      .from(campaigns)
      .where(inWorkspace),

    // "Active" means a stage is genuinely running, not that a status field says so.
    // A campaign whose last stage failed is not active.
    db
      .select({ value: sql<number>`count(distinct ${campaignStages.campaignId})::int` })
      .from(campaignStages)
      .innerJoin(campaigns, eq(campaigns.id, campaignStages.campaignId))
      .where(and(inWorkspace, eq(campaignStages.state, "active"))),

    db
      .select({ value: count() })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.workspaceId, context.workspaceId),
          inArray(scheduledPosts.status, [...PENDING_PUBLISH]),
          gte(scheduledPosts.scheduledFor, new Date()),
        ),
      ),

    // Consumption is negative in the append-only ledger, so it is negated to read
    // as a positive "used" figure. Derived from the ledger rather than a mutable
    // counter, so the number is always reconcilable against the rows behind it.
    db
      .select({
        value: sql<number>`coalesce(-sum(${creditLedger.delta}) filter (where ${creditLedger.reason} = 'consumption'), 0)::int`,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.organizationId, context.organizationId),
          gte(creditLedger.occurredAt, period.start),
        ),
      ),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const summary = summaryRows[0] ?? { total: 0, review: 0 };
  const activeCount = activeRows[0]?.value ?? 0;
  const scheduledCount = scheduledRows[0]?.value ?? 0;
  const creditsUsed = creditRows[0]?.value ?? 0;

  const filtered = Boolean(query || statusParam || platformParam || goalParam);
  const canCreate = can(context.role, "content.create");

  const columns: readonly Column<CampaignRow>[] = [
    {
      id: "name",
      header: "Campaign",
      cell: (row) => (
        <PrimaryCell
          title={row.name}
          detail={[goalLabel(row.objective), `${countFormatter.format(row.conceptsCount)} concepts`]
            .filter(Boolean)
            .join(" · ")}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      id: "stage",
      header: "Stage",
      hideBelow: "md",
      cell: (row) => <StageCell active={row.activeStage} blocked={row.blockedStage} />,
    },
    {
      id: "progress",
      header: "Published",
      hideBelow: "sm",
      width: "11rem",
      cell: (row) =>
        row.contentCount > 0 ? (
          <Progress
            percent={(row.publishedCount / row.contentCount) * 100}
            label={`${row.name} publishing progress`}
            tone={row.activeStage ? "signal" : "neutral"}
          />
        ) : (
          <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            No content yet
          </span>
        ),
    },
    {
      id: "content",
      header: "Items",
      numeric: true,
      hideBelow: "sm",
      cell: (row) => countFormatter.format(row.contentCount),
    },
    {
      id: "platforms",
      header: "Channels",
      hideBelow: "lg",
      cell: (row) => <ChannelCell platforms={row.platforms} />,
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
          title={campaignsCopy.title}
          description={campaignsCopy.body}
          actions={
            canCreate ? (
              <ButtonLink href="/app/create">
                <Plus aria-hidden="true" size={15} strokeWidth={2.25} />
                New campaign
              </ButtonLink>
            ) : undefined
          }
        />

        <KpiGrid columns={5}>
          <KpiCard
            label={campaignsCopy.kpis.total}
            value={countFormatter.format(summary.total)}
            icon={<LayoutGrid size={14} strokeWidth={1.75} />}
          />
          <KpiCard
            label={campaignsCopy.kpis.active}
            value={countFormatter.format(activeCount)}
            tone={activeCount > 0 ? "brand" : "neutral"}
            detail={
              <span className="text-[color:var(--text-muted)]">
                {activeCount === 0 ? "Nothing generating" : "Generating now"}
              </span>
            }
          />
          <KpiCard
            label={campaignsCopy.kpis.review}
            value={countFormatter.format(summary.review)}
            tone={summary.review > 0 ? "warning" : "neutral"}
            href={summary.review > 0 ? "/app/campaigns?status=awaiting_review" : undefined}
            detail={
              summary.review > 0 ? (
                <span className="text-[color:var(--warning)]">Waiting on a person</span>
              ) : (
                <span className="text-[color:var(--text-muted)]">Nothing waiting</span>
              )
            }
          />
          <KpiCard
            label={campaignsCopy.kpis.scheduled}
            value={countFormatter.format(scheduledCount)}
            href="/app/calendar"
          />
          <KpiCard
            label={campaignsCopy.kpis.credits}
            value={formatMetric(creditsUsed, "compact")}
            href="/app/usage"
          />
        </KpiGrid>

        <Card>
          <CardBody pad="tight" className="border-b border-[var(--border-subtle)]">
            <FilterBar
              searchPlaceholder="Search campaigns"
              views={["table", "grid"]}
              filters={[
                { key: "status", label: "Status", options: STATUS_OPTIONS },
                { key: "platform", label: "Channel", options: PLATFORM_OPTIONS },
                { key: "goal", label: "Goal", options: GOAL_OPTIONS },
              ]}
            />
          </CardBody>

          {rows.length > 0 && view === "table" && (
            <CardBody pad="none">
              <DataTable
                caption={campaignsCopy.tableCaption}
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                rowHref={(row) => `/app/campaigns/${row.id}`}
              />
            </CardBody>
          )}

          {rows.length > 0 && view === "grid" && (
            <CardBody>
              <ul
                aria-label={campaignsCopy.gridLabel}
                className="grid gap-[var(--app-panel-gap)] sm:grid-cols-2 xl:grid-cols-3"
              >
                {rows.map((row) => (
                  <li key={row.id}>
                    <CampaignTile row={row} />
                  </li>
                ))}
              </ul>
            </CardBody>
          )}

          {/* Stated rather than silent. A capped list that looks complete is worse
              than one that says it is capped. */}
          {rows.length > 0 && total > rows.length && (
            <CardFooter>{campaignsCopy.truncated(rows.length, total)}</CardFooter>
          )}

          {rows.length === 0 && filtered && (
            <EmptyState
              bare
              icon={<LayoutGrid size={20} strokeWidth={1.75} />}
              title={campaignsCopy.noMatches.title}
              body={campaignsCopy.noMatches.body}
              actions={
                <ButtonLink href="/app/campaigns" variant="secondary">
                  Clear filters
                </ButtonLink>
              }
            />
          )}

          {rows.length === 0 && !filtered && (
            <EmptyState
              bare
              icon={<Sparkles size={20} strokeWidth={1.75} />}
              title={campaignsCopy.empty.title}
              body={campaignsCopy.empty.body}
              actions={
                canCreate ? (
                  <>
                    <ButtonLink href="/app/create">Create campaign</ButtonLink>
                    <ButtonLink href="#templates" variant="secondary">
                      Explore templates
                    </ButtonLink>
                  </>
                ) : undefined
              }
            />
          )}
        </Card>

        {/* Onboarding, not an afterthought. The empty state above is deliberately
            compact so this fits on the same screen — a first-run user needs a
            worked example more than they need a large apology. */}
        {summary.total === 0 && canCreate && (
          <section id="templates" aria-labelledby="templates-heading" className="scroll-mt-20">
            <SectionHeader
              id="templates-heading"
              title={campaignsCopy.onboardingHeading}
              description={campaignsCopy.onboardingBody}
            />
            <ul className="mt-[var(--space-4)] grid gap-[var(--app-panel-gap)] sm:grid-cols-2 xl:grid-cols-4">
              {campaignTemplates.map((template) => (
                <li key={template.id}>
                  <Card as="article" interactive className="flex h-full flex-col">
                    <CardHeader title={template.name} as="h3" />
                    <CardBody className="flex flex-1 flex-col pt-[var(--space-2)]">
                      <p className="flex-1 text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                        {template.summary}
                      </p>
                      <p className="app-figure mt-[var(--space-3)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                        {template.outputs}
                      </p>
                      <Link
                        href={template.href}
                        className={cn(
                          "mt-[var(--space-4)] inline-flex items-center gap-[var(--space-1)]",
                          "rounded-[var(--radius-chip)]",
                          "text-[length:var(--text-app-cell)] font-[var(--weight-strong)]",
                          "text-[color:var(--brand-ink)]",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                        )}
                      >
                        Use this template
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
 * Pipeline position.
 *
 * Blocked outranks active, because a blocked stage is the thing a person has to
 * act on. Both states carry a word as well as a colour.
 */
function StageCell({ active, blocked }: { active: string | null; blocked: string | null }) {
  if (blocked) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] px-2 py-1",
          "bg-[var(--warning-soft)] text-[length:var(--text-app-label)]",
          "font-[var(--weight-strong)] leading-4 text-[color:var(--warning)]",
        )}
      >
        Blocked: {STAGE_LABELS[blocked] ?? blocked}
      </span>
    );
  }

  if (active) {
    return (
      <span className="inline-flex items-center gap-[var(--space-2)] whitespace-nowrap text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]">
        {/* The one place a pulse is licensed: it means work is genuinely in
            flight. `motion-safe` only, so under reduced motion the label carries
            the state on its own. */}
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-[var(--radius-full)] bg-[var(--brand-mark)] motion-safe:animate-pulse"
        />
        {STAGE_LABELS[active] ?? active}
      </span>
    );
  }

  return <span className="text-[color:var(--text-muted)]">—</span>;
}

/**
 * Channels for a row.
 *
 * Named, not glyphed. Platform logos at 14px in a table column are a row of
 * indistinct smudges, and the column is narrow enough that two names plus a count
 * is both shorter and unambiguous.
 */
function ChannelCell({ platforms }: { platforms: readonly Platform[] }) {
  if (platforms.length === 0) {
    return <span className="text-[color:var(--text-muted)]">—</span>;
  }

  const labels = platformLabels(platforms);
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
 * Grid-view campaign card.
 *
 * Carries the same facts as the table row, reordered for a card's reading path:
 * identity, then state, then volume, then recency. No thumbnail yet — a generated
 * still only exists once the assets stage has run, and a grey placeholder box on
 * every card is worse than no box at all.
 */
function CampaignTile({ row }: { row: CampaignRow }) {
  const goal = goalLabel(row.objective);
  const progress = row.contentCount > 0 ? (row.publishedCount / row.contentCount) * 100 : 0;

  return (
    <Card as="article" interactive className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-[var(--space-3)] p-[var(--app-panel-pad)] pb-[var(--space-3)]">
        <div className="min-w-0">
          <h3 className="app-card-title truncate text-[color:var(--text-primary)]">
            <Link
              href={`/app/campaigns/${row.id}`}
              className="rounded-[var(--radius-chip)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            >
              {row.name}
            </Link>
          </h3>
          {goal && (
            <p className="mt-0.5 truncate text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
              {goal}
            </p>
          )}
        </div>
        <StatusChip status={row.status} compact />
      </div>

      <div className="flex flex-1 flex-col gap-[var(--space-3)] px-[var(--app-panel-pad)] pb-[var(--app-panel-pad)]">
        <StageCell active={row.activeStage} blocked={row.blockedStage} />

        <dl className="grid grid-cols-3 gap-[var(--space-2)]">
          <TileStat label="Items" value={countFormatter.format(row.contentCount)} />
          <TileStat label="Published" value={countFormatter.format(row.publishedCount)} />
          <TileStat label="Concepts" value={countFormatter.format(row.conceptsCount)} />
        </dl>

        {row.contentCount > 0 && (
          <Progress
            percent={progress}
            label={`${row.name} publishing progress`}
            tone={row.activeStage ? "signal" : "neutral"}
          />
        )}

        <div className="mt-auto flex items-end justify-between gap-[var(--space-2)] pt-[var(--space-1)]">
          <ChannelCell platforms={row.platforms} />
          <span className="whitespace-nowrap text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {relativeDay(row.updatedAt)}
          </span>
        </div>
      </div>
    </Card>
  );
}

function TileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="app-label truncate">{label}</dt>
      <dd className="app-figure text-[length:var(--text-metric-s)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
        {value}
      </dd>
    </div>
  );
}
