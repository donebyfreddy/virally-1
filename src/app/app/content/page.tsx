import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import { campaigns, contentItems } from "@/lib/db/schema.fragment";
import { relativeDay, formatDuration } from "@/lib/format";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel } from "@/components/app-ui/Panel";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { Badge } from "@/components/primitives/Badge";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import {
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_OPTIONS,
  contentCopy,
} from "@/content/content-library";
import type { ReviewStatus } from "@/types/database";

export const metadata: Metadata = {
  title: "Content",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
const countFormatter = new Intl.NumberFormat("en-US");

const STATUS_OPTIONS: readonly { id: ReviewStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "awaiting_review", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "archived", label: "Archived" },
];

const VALID_STATUSES = new Set<string>(STATUS_OPTIONS.map((option) => option.id));
const VALID_TYPES = new Set<string>(CONTENT_TYPE_OPTIONS.map((option) => option.id));

type ContentRow = {
  id: string;
  title: string | null;
  contentType: string;
  language: string;
  status: ReviewStatus;
  durationMs: number | null;
  origin: string;
  updatedAt: Date;
  campaignName: string | null;
  variantCount: number;
  platforms: string | null;
};

/**
 * Content.
 *
 * Lists content ITEMS with their variant count, rather than listing every
 * variant. A 5-concept campaign across 4 platforms and 2 languages produces 40
 * variants from 5 items — a flat variant list is unreadable at that
 * multiplication, and the item is the unit a person actually reasons about.
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

  const conditions: SQL[] = [
    eq(contentItems.workspaceId, context.workspaceId),
    isNull(contentItems.deletedAt),
  ];

  if (query) conditions.push(ilike(contentItems.title, `%${query}%`));
  if (statusParam && VALID_STATUSES.has(statusParam)) {
    conditions.push(eq(contentItems.status, statusParam as ReviewStatus));
  }
  if (typeParam && VALID_TYPES.has(typeParam)) {
    conditions.push(sql`${contentItems.contentType} = ${typeParam}`);
  }
  // Campaign arrives from a link on the campaign detail page. Validated as a
  // uuid shape before it reaches SQL rather than trusted as an opaque string.
  if (campaignParam && /^[0-9a-f-]{36}$/i.test(campaignParam)) {
    conditions.push(eq(contentItems.campaignId, campaignParam));
  }

  const where = and(...conditions);

  // The campaign filter options are the workspace's own campaigns, so the
  // control can never offer a campaign the user cannot see.
  const [rows, totalRows, campaignOptions] = await Promise.all([
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
        campaignName: campaigns.name,
        variantCount: sql<number>`(
          select count(*)::int from content_variants cv
          where cv.content_item_id = ${contentItems.id}
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
      .orderBy(desc(contentItems.updatedAt))
      .limit(PAGE_SIZE),

    db.select({ value: sql<number>`count(*)::int` }).from(contentItems).where(where),

    db
      .select({ id: campaigns.id, label: campaigns.name })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, context.workspaceId), isNull(campaigns.deletedAt)))
      .orderBy(desc(campaigns.updatedAt))
      .limit(50),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const filtered = Boolean(query || statusParam || typeParam || campaignParam);

  const columns: readonly Column<ContentRow>[] = [
    {
      id: "title",
      header: "Item",
      cell: (row) => (
        <PrimaryCell
          title={row.title ?? "Untitled item"}
          detail={row.campaignName ?? undefined}
        />
      ),
    },
    {
      id: "type",
      header: "Format",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          {CONTENT_TYPE_LABELS[row.contentType] ?? row.contentType}
        </span>
      ),
    },
    {
      id: "platforms",
      header: "Platforms",
      hideBelow: "lg",
      cell: (row) =>
        row.platforms ? (
          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            {row.platforms}
          </span>
        ) : (
          <span className="text-[color:var(--color-text-muted)]">—</span>
        ),
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
      hideBelow: "md",
      cell: (row) =>
        row.durationMs ? formatDuration(row.durationMs / 1000) : <span className="text-[color:var(--color-text-muted)]">—</span>,
    },
    {
      id: "language",
      header: "Lang",
      hideBelow: "xl",
      cell: (row) => (
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase text-[color:var(--color-text-muted)]">
          {row.language}
        </span>
      ),
    },
    {
      id: "origin",
      header: "Origin",
      hideBelow: "xl",
      cell: (row) =>
        // Mock-generated output is labelled wherever it appears, so a reviewer
        // never mistakes a deterministic placeholder for a real generation.
        row.origin === "mock" ? <Badge tone="warning">Demo</Badge> : null,
    },
    {
      id: "status",
      header: "Approval",
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
        eyebrow={contentCopy.eyebrow}
        title={contentCopy.title}
        description={contentCopy.body}
        meta={[
          total === 1 ? "1 item" : `${countFormatter.format(total)} items`,
          context.workspaceName,
        ]}
      />

      <Panel className="mt-[var(--space-8)]">
        <FilterBar
          searchPlaceholder="Search content"
          filters={[
            { key: "status", label: "Approval", options: STATUS_OPTIONS },
            { key: "type", label: "Format", options: CONTENT_TYPE_OPTIONS },
            { key: "campaign", label: "Campaign", options: campaignOptions },
          ]}
        />

        <div className="mt-[var(--space-6)]">
          {rows.length > 0 && (
            <>
              <DataTable
                caption={contentCopy.tableCaption}
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                rowHref={(row) => `/app/content/${row.id}`}
              />
              {total > rows.length && (
                <p className="mt-[var(--space-4)] font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                  {contentCopy.truncated(rows.length, total)}
                </p>
              )}
            </>
          )}

          {rows.length === 0 && filtered && (
            <EmptyState
              title={contentCopy.noMatches.title}
              body={contentCopy.noMatches.body}
              actions={
                <ButtonLink href="/app/content" variant="secondary">
                  Clear filters
                </ButtonLink>
              }
            />
          )}

          {rows.length === 0 && !filtered && (
            <EmptyState
              title={contentCopy.empty.title}
              body={contentCopy.empty.body}
              actions={
                <>
                  <ButtonLink href="/app/create">Create a campaign</ButtonLink>
                  <ButtonLink href="/app/library" variant="secondary">
                    Open the library
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      </Panel>
    </AppPage>
  );
}
