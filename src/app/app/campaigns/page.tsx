import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { Plus } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema.fragment";
import { relativeDay } from "@/lib/format";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel } from "@/components/app-ui/Panel";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { Progress } from "@/components/app-ui/Progress";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { Badge } from "@/components/primitives/Badge";
import { PLATFORM_OPTIONS, GOAL_OPTIONS } from "@/content/create";
import { campaignsCopy, STAGE_LABELS } from "@/content/campaigns";
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

/**
 * Campaigns.
 *
 * Filters are applied in SQL, not after fetching. A workspace can hold thousands
 * of campaigns, and fetching all of them to hide rows on the client would move
 * the whole table across the network and break on the first real account.
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

  const [rows, totalRows] = await Promise.all([
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
  ]);

  const total = totalRows[0]?.value ?? 0;
  const filtered = Boolean(query || statusParam || platformParam || goalParam);
  const canCreate = can(context.role, "content.create");

  const columns: readonly Column<CampaignRow>[] = [
    {
      id: "name",
      header: "Campaign",
      cell: (row) => (
        <PrimaryCell
          title={row.name}
          detail={
            [
              row.objective
                ? (GOAL_OPTIONS.find((option) => option.id === row.objective)?.label ?? row.objective)
                : null,
              `${countFormatter.format(row.conceptsCount)} concepts`,
            ]
              .filter(Boolean)
              .join(" · ")
          }
        />
      ),
    },
    {
      id: "stage",
      header: "Pipeline stage",
      hideBelow: "md",
      cell: (row) => {
        if (row.blockedStage) {
          return (
            <Badge tone="warning">
              Blocked: {STAGE_LABELS[row.blockedStage] ?? row.blockedStage}
            </Badge>
          );
        }
        if (row.activeStage) {
          // Teal: the machine is genuinely working on this stage.
          return (
            <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-signal)]">
              {STAGE_LABELS[row.activeStage] ?? row.activeStage}
            </span>
          );
        }
        return <span className="text-[color:var(--color-text-muted)]">—</span>;
      },
    },
    {
      id: "platforms",
      header: "Channels",
      hideBelow: "lg",
      cell: (row) =>
        row.platforms.length > 0 ? (
          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            {row.platforms
              .map(
                (platform) =>
                  PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform,
              )
              .join(", ")}
          </span>
        ) : (
          <span className="text-[color:var(--color-text-muted)]">—</span>
        ),
    },
    {
      id: "progress",
      header: "Published",
      hideBelow: "sm",
      width: "10rem",
      cell: (row) =>
        row.contentCount > 0 ? (
          <Progress
            percent={(row.publishedCount / row.contentCount) * 100}
            label={`${row.name} publishing progress`}
          />
        ) : (
          <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
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
      id: "status",
      header: "Status",
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      id: "updated",
      header: "Updated",
      hideBelow: "md",
      cell: (row) => (
        <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          {relativeDay(row.updatedAt)}
        </span>
      ),
    },
  ];

  return (
    <AppPage>
      <PageHeader
        eyebrow={campaignsCopy.eyebrow}
        title={campaignsCopy.title}
        description={campaignsCopy.body}
        meta={[
          total === 1 ? "1 campaign" : `${countFormatter.format(total)} campaigns`,
          context.workspaceName,
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

      <Panel className="mt-[var(--space-8)]">
        <FilterBar
          searchPlaceholder="Search campaigns"
          filters={[
            { key: "status", label: "Status", options: STATUS_OPTIONS },
            { key: "platform", label: "Channel", options: PLATFORM_OPTIONS },
            { key: "goal", label: "Goal", options: GOAL_OPTIONS },
          ]}
        />

        <div className="mt-[var(--space-6)]">
          {rows.length > 0 && (
            <>
              <DataTable
                caption={campaignsCopy.tableCaption}
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                rowHref={(row) => `/app/campaigns/${row.id}`}
              />

              {/* Stated rather than silent. A capped list that looks complete is
                  worse than one that says it is capped. */}
              {total > rows.length && (
                <p className="mt-[var(--space-4)] font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                  {campaignsCopy.truncated(rows.length, total)}
                </p>
              )}
            </>
          )}

          {rows.length === 0 && filtered && (
            <EmptyState
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
              title={campaignsCopy.empty.title}
              body={campaignsCopy.empty.body}
              actions={
                canCreate ? (
                  <ButtonLink href="/app/create">Create first campaign</ButtonLink>
                ) : undefined
              }
            />
          )}
        </div>
      </Panel>
    </AppPage>
  );
}
