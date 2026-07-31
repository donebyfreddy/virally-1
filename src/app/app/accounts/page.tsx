import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { AlertTriangle, AtSign, Check, Gauge, Plus, Send } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { accountSlots } from "@/lib/db/schema";
import { connectedAccounts, contentMetrics, scheduledPosts } from "@/lib/db/schema.fragment";
import { workspaceAccountSlotLimit } from "@/lib/db/authorization";
import {
  capacityNotice,
  nextFreeSlotNumbers,
  slotPresentation,
  usageSummary,
  type OccupiedSlot,
  type SlotUsage,
} from "@/lib/accounts/slots";
import { archiveAccountSlot, markAccountRegistered } from "@/lib/accounts/actions";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader, SectionHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { CellThumb, DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { AuthMessage } from "@/components/auth/AuthMessage";
import {
  AccountSlotCard,
  HealthChip,
  PlatformMark,
  formatSyncedAt,
  slotIdentity,
  type SlotActivity,
} from "@/components/accounts/AccountSlotCard";
import { EmptySlotTile } from "@/components/accounts/EmptySlotTile";
import {
  accountErrors,
  accountsPage,
  authorisationBoundary,
  creationBoundary,
  launchKitPage,
  PLATFORM_LABELS,
  slotActions,
} from "@/content/accounts";
import { PLATFORM_OPTIONS } from "@/content/create";
import {
  PLATFORM_REQUIREMENTS,
  allAdapterAvailability,
  availabilityLabel,
  type AdapterAvailability,
} from "@/providers/social/adapter";
import type { Platform } from "@/types/database";

export const metadata: Metadata = {
  title: "Accounts",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The window "recent reach" describes. Stated on the page, not implied. */
const REACH_WINDOW_DAYS = 28;

/** Posts in these states are genuinely queued for a future publish. */
const PENDING_PUBLISH = ["approved", "scheduled", "queued"] as const;

/** The two states where a live authorisation cannot publish until someone acts. */
const NEEDS_RECONNECTION = ["reconnection_required", "limited_permissions"] as const;

const countFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type SlotRow = OccupiedSlot & { activity: SlotActivity };

/**
 * The account network.
 *
 * The compliance surface, and the one screen where the slot/account distinction has
 * to be unmistakable. Four things are load-bearing:
 *
 *   - Reconnection leads. An account whose authorisation the platform ended is the
 *     only thing on this page that stops content going out, so it sits above the
 *     full list rather than being something the user has to find in it.
 *   - Occupied slots and empty slots are drawn by different components with
 *     different structures, so the grid never reads as "ten accounts".
 *   - Health is never colour-only: every state carries an icon and a word, and the
 *     required action is spelled out underneath.
 *   - Every connector reports its real state. With no platform credentials
 *     configured that state is "Configuration required" naming the exact missing
 *     variables, and no connect button is rendered anywhere — one that looked live
 *     and failed on click would be the dishonest option.
 *
 * Filtering happens in SQL from the URL, so a filtered list is a shareable link and
 * the back button undoes a filter. The KPI strip and the attention panel are
 * queried unfiltered on purpose: they describe the workspace, not the current view.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/accounts"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const errorCode = single("error");
  const preparedSlot = Number(single("prepared"));
  const view = single("view") === "grid" ? "grid" : "table";

  // Each filter resolves to its own option rather than to a bare string, so an
  // unrecognised value is dropped instead of reaching SQL, and the statuses a
  // label means cannot drift from the predicate that implements it.
  const platformOption = PLATFORM_OPTIONS.find((option) => option.id === single("platform")) ?? null;
  const stateOption =
    accountsPage.stateOptions.find((option) => option.id === single("state")) ?? null;
  const filtered = Boolean(platformOption || stateOption);

  const inWorkspace = and(
    eq(accountSlots.workspaceId, context.workspaceId),
    isNull(accountSlots.archivedAt),
  );

  const listConditions: SQL[] = [
    eq(accountSlots.workspaceId, context.workspaceId),
    isNull(accountSlots.archivedAt),
  ];
  if (platformOption) listConditions.push(eq(accountSlots.platform, platformOption.id));
  if (stateOption) {
    listConditions.push(
      inArray(accountSlots.status, [...stateOption.statuses]),
    );
  }

  const slotColumns = {
    id: accountSlots.id,
    slotNumber: accountSlots.slotNumber,
    platform: accountSlots.platform,
    status: accountSlots.status,
    displayLabel: accountSlots.displayLabel,
    brandId: accountSlots.brandId,
    launchKitId: accountSlots.accountLaunchKitId,
    accountId: connectedAccounts.id,
    username: connectedAccounts.username,
    displayName: connectedAccounts.displayName,
    avatarUrl: connectedAccounts.avatarUrl,
    followerCount: connectedAccounts.followerCount,
    lastSyncedAt: connectedAccounts.lastSyncedAt,
  };

  /**
   * The newest metrics snapshot for each post.
   *
   * `content_metrics` is append-only and each row is the platform's counter AT that
   * hour, so this predicate — not a sum over the series — is what makes a total
   * current. Summing the series raw counts one post once per sync.
   */
  const latestSnapshot = sql`${contentMetrics.capturedAt} = (
    select max(latest.captured_at) from content_metrics latest
    where latest.scheduled_post_id = ${contentMetrics.scheduledPostId}
  )`;

  const publishedSince = new Date();
  publishedSince.setUTCDate(publishedSince.getUTCDate() - REACH_WINDOW_DAYS);

  // Ten reads, one round trip. Sequentially this page would pay ten network
  // latencies before rendering anything.
  const [
    rows,
    summaryRows,
    attentionRows,
    slotNumberRows,
    scheduledRows,
    reachRows,
    scheduledTotalRows,
    archivedRows,
    unslottedRows,
    slotLimit,
  ] = await Promise.all([
    db
      .select(slotColumns)
      .from(accountSlots)
      .leftJoin(connectedAccounts, eq(connectedAccounts.id, accountSlots.connectedAccountId))
      .where(and(...listConditions))
      .orderBy(asc(accountSlots.slotNumber)),

    // Unfiltered workspace totals for the KPI strip.
    db
      .select({
        total: sql<number>`count(*)::int`,
        // Mirrors `hasLiveAuthorisation` in lib/accounts/slots.ts, restated in SQL
        // because the count has to describe the whole workspace rather than the
        // rows this page happens to have fetched.
        live: sql<number>`count(*) filter (where ${accountSlots.status} in ('connected', 'limited_permissions', 'reconnection_required', 'suspended_by_user'))::int`,
        connected: sql<number>`count(*) filter (where ${accountSlots.status} = 'connected')::int`,
        reconnect: sql<number>`count(*) filter (where ${accountSlots.status} = 'reconnection_required')::int`,
        limited: sql<number>`count(*) filter (where ${accountSlots.status} = 'limited_permissions')::int`,
      })
      .from(accountSlots)
      .where(inWorkspace),

    // The actionable half, unfiltered, reconnection before limited permissions:
    // one has stopped publishing outright, the other will stop at the last step.
    db
      .select(slotColumns)
      .from(accountSlots)
      .leftJoin(connectedAccounts, eq(connectedAccounts.id, accountSlots.connectedAccountId))
      .where(and(inWorkspace, inArray(accountSlots.status, [...NEEDS_RECONNECTION])))
      .orderBy(
        sql`case when ${accountSlots.status} = 'reconnection_required' then 0 else 1 end`,
        asc(accountSlots.slotNumber),
      ),

    // Archived slots keep their numbers, so the empty-tile previews must skip
    // them too — a freed number is never reused.
    db
      .select({ slotNumber: accountSlots.slotNumber })
      .from(accountSlots)
      .where(eq(accountSlots.workspaceId, context.workspaceId)),

    db
      .select({ accountId: scheduledPosts.connectedAccountId, value: count() })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.workspaceId, context.workspaceId),
          inArray(scheduledPosts.status, [...PENDING_PUBLISH]),
          gte(scheduledPosts.scheduledFor, new Date()),
        ),
      )
      .groupBy(scheduledPosts.connectedAccountId),

    // Reach for posts published in the window, from each post's newest snapshot.
    // Null — not 0 — where no post reported a reach figure: a platform that does
    // not expose the counter is a different fact from an account nobody saw.
    db
      .select({
        accountId: contentMetrics.connectedAccountId,
        reach: sql<number | null>`case when count(${contentMetrics.reach}) = 0 then null
          else sum(coalesce(${contentMetrics.reach}, 0))::int end`,
      })
      .from(contentMetrics)
      .innerJoin(scheduledPosts, eq(scheduledPosts.id, contentMetrics.scheduledPostId))
      .where(
        and(
          eq(contentMetrics.workspaceId, context.workspaceId),
          gte(scheduledPosts.publishedAt, publishedSince),
          latestSnapshot,
        ),
      )
      .groupBy(contentMetrics.connectedAccountId),

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

    db
      .select({
        id: accountSlots.id,
        slotNumber: accountSlots.slotNumber,
        platform: accountSlots.platform,
        displayLabel: accountSlots.displayLabel,
      })
      .from(accountSlots)
      .where(
        and(
          eq(accountSlots.workspaceId, context.workspaceId),
          isNotNull(accountSlots.archivedAt),
        ),
      )
      .orderBy(asc(accountSlots.slotNumber)),

    /**
     * Connected accounts no slot points at.
     *
     * Should be empty: a slot is claimed as part of connecting. It is surfaced
     * rather than ignored because the alternative is an account that exists, can
     * be published to, and is invisible on the screen that lists every account.
     */
    db
      .select({
        id: connectedAccounts.id,
        platform: connectedAccounts.platform,
        username: connectedAccounts.username,
        displayName: connectedAccounts.displayName,
        avatarUrl: connectedAccounts.avatarUrl,
        health: connectedAccounts.health,
      })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.workspaceId, context.workspaceId),
          isNull(connectedAccounts.disconnectedAt),
          sql`not exists (
            select 1 from account_slots slot
            where slot.connected_account_id = ${connectedAccounts.id}
              and slot.workspace_id = ${context.workspaceId}
          )`,
        ),
      ),

    workspaceAccountSlotLimit(context.workspaceId),
  ]);

  const summary = summaryRows[0] ?? { total: 0, live: 0, connected: 0, reconnect: 0, limited: 0 };
  const scheduledTotal = scheduledTotalRows[0]?.value ?? 0;

  const scheduledByAccount = new Map(scheduledRows.map((row) => [row.accountId, row.value]));
  const reachByAccount = new Map(reachRows.map((row) => [row.accountId, row.reach]));
  const brandsById = new Map(context.brands.map((brand) => [brand.id, brand.name]));

  const usage: SlotUsage = {
    slotLimit,
    activeSlots: summary.total,
    connectedSlots: summary.connected,
    archivedSlots: archivedRows.length,
    availableSlots: Math.max(0, slotLimit - summary.total),
  };

  const toRow = (row: (typeof rows)[number]): SlotRow => ({
    kind: "occupied",
    id: row.id,
    slotNumber: row.slotNumber,
    platform: row.platform,
    status: row.status,
    displayLabel: row.displayLabel,
    brandName: row.brandId ? brandsById.get(row.brandId) ?? null : null,
    launchKitId: row.launchKitId,
    account: row.accountId
      ? {
          id: row.accountId,
          username: row.username,
          displayName: row.displayName,
          avatarUrl: row.avatarUrl,
          followerCount: row.followerCount,
          lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        }
      : null,
    activity: {
      scheduled: row.accountId ? scheduledByAccount.get(row.accountId) ?? 0 : 0,
      reach: row.accountId ? reachByAccount.get(row.accountId) ?? null : null,
    },
  });

  const slots = rows.map(toRow);
  const attention = attentionRows.map(toRow);

  // Empty tiles come from `limit - active`, NOT from "which numbers in 1..limit
  // are unused". Those differ once a slot has been archived: with slots 1–4 and
  // 6–11 active against a limit of 10, capacity is full, and filling the gap at 5
  // would render a tile the user cannot actually claim.
  const previewNumbers = nextFreeSlotNumbers(
    slotNumberRows.map((row) => row.slotNumber),
    usage.availableSlots,
  );

  const mayConnect = can(context.role, "accounts.connect");
  const capacity = capacityNotice(usage);
  const availability = allAdapterAvailability();

  const errorMessage = errorCode ? accountErrors[errorCode] ?? null : null;
  const preparedNotice =
    Number.isFinite(preparedSlot) && preparedSlot > 0
      ? launchKitPage.preparedNotice(preparedSlot)
      : null;
  const hasNotice = Boolean(errorMessage || preparedNotice || capacity || !mayConnect);

  const columns: readonly Column<SlotRow>[] = [
    {
      id: "account",
      header: accountsPage.columns.account,
      cell: (row) => (
        <PrimaryCell
          leading={<CellThumb src={row.account?.avatarUrl ?? null} alt="" fallback={slotIdentity(row)} />}
          title={slotIdentity(row)}
          detail={
            [row.account?.username ? `@${row.account.username}` : null, `Slot ${String(row.slotNumber).padStart(2, "0")}`]
              .filter(Boolean)
              .join(" · ")
          }
        />
      ),
    },
    {
      id: "platform",
      header: accountsPage.columns.platform,
      cell: (row) => (
        <span className="flex items-center gap-[var(--space-2)] whitespace-nowrap">
          <PlatformMark platform={row.platform} />
          {PLATFORM_LABELS[row.platform]}
        </span>
      ),
    },
    {
      id: "health",
      header: accountsPage.columns.health,
      cell: (row) => <HealthChip status={row.status} />,
    },
    {
      id: "brand",
      header: accountsPage.columns.brand,
      hideBelow: "xl",
      cell: (row) => row.brandName ?? <NotReported />,
    },
    {
      id: "followers",
      header: accountsPage.columns.followers,
      numeric: true,
      hideBelow: "md",
      cell: (row) =>
        row.account?.followerCount === null || row.account?.followerCount === undefined ? (
          <NotReported />
        ) : (
          compactFormatter.format(row.account.followerCount)
        ),
    },
    {
      id: "scheduled",
      header: accountsPage.columns.scheduled,
      numeric: true,
      hideBelow: "lg",
      cell: (row) => countFormatter.format(row.activity.scheduled),
    },
    {
      id: "reach",
      header: accountsPage.columns.reach,
      numeric: true,
      hideBelow: "lg",
      cell: (row) =>
        row.activity.reach === null ? <NotReported /> : compactFormatter.format(row.activity.reach),
    },
    {
      id: "sync",
      header: accountsPage.columns.lastSync,
      hideBelow: "md",
      cell: (row) => {
        const synced = formatSyncedAt(row.account?.lastSyncedAt ?? null);
        return synced ? (
          <span className="app-figure whitespace-nowrap text-[color:var(--text-muted)]">{synced}</span>
        ) : (
          <span className="whitespace-nowrap text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {accountsPage.neverSynced}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: accountsPage.columns.actions,
      cell: (row) => <SlotActions slot={row} mayConnect={mayConnect} />,
    },
  ];

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={accountsPage.heading}
          description={accountsPage.intro}
          meta={[context.workspaceName, usageSummary(usage)]}
          actions={
            mayConnect && usage.availableSlots > 0 ? (
              <ButtonLink href="/app/accounts/launch">
                <Plus aria-hidden="true" size={15} strokeWidth={2.25} />
                {slotActions.prepare}
              </ButtonLink>
            ) : undefined
          }
        />

        {/* Notices, most urgent first. */}
        {hasNotice && (
          <div className="flex flex-col gap-[var(--space-3)]">
            {errorMessage && <AuthMessage tone="error" body={errorMessage} />}
            {preparedNotice && <AuthMessage tone="success" body={preparedNotice} />}
            {capacity && <AuthMessage tone="notice" body={capacity} />}
            {!mayConnect && <AuthMessage tone="notice" body={accountsPage.readOnlyNotice} />}
          </div>
        )}

        <KpiGrid columns={5}>
          <KpiCard
            label={accountsPage.kpis.connected}
            value={countFormatter.format(summary.live)}
            icon={<AtSign size={14} strokeWidth={1.75} />}
            detail={
              summary.live === 0 ? (
                <span className="text-[color:var(--text-muted)]">
                  {accountsPage.kpiDetail.noneConnected}
                </span>
              ) : undefined
            }
          />
          <KpiCard
            label={accountsPage.kpis.healthy}
            value={countFormatter.format(summary.connected)}
            tone={summary.connected > 0 ? "success" : "neutral"}
            icon={<Check size={14} strokeWidth={2} />}
            detail={
              <span className="text-[color:var(--text-muted)]">
                {summary.connected === 0
                  ? accountsPage.kpiDetail.healthyNone
                  : summary.connected === summary.live
                    ? accountsPage.kpiDetail.healthyAll
                    : `of ${countFormatter.format(summary.live)} connected`}
              </span>
            }
          />
          <KpiCard
            label={accountsPage.kpis.reconnect}
            value={countFormatter.format(summary.reconnect)}
            tone={summary.reconnect > 0 ? "warning" : "neutral"}
            icon={<AlertTriangle size={14} strokeWidth={1.75} />}
            href={summary.reconnect > 0 ? "#attention" : undefined}
            detail={
              summary.reconnect > 0 ? (
                <span className="text-[color:var(--warning)]">Waiting on a person</span>
              ) : (
                <span className="text-[color:var(--text-muted)]">
                  {accountsPage.kpiDetail.reconnectNone}
                </span>
              )
            }
          />
          <KpiCard
            label={accountsPage.kpis.scheduled}
            value={countFormatter.format(scheduledTotal)}
            icon={<Send size={14} strokeWidth={1.75} />}
            href="/app/calendar"
          />
          <KpiCard
            label={accountsPage.kpis.limit}
            value={`${countFormatter.format(usage.activeSlots)} / ${countFormatter.format(usage.slotLimit)}`}
            icon={<Gauge size={14} strokeWidth={1.75} />}
            detail={
              <span className="text-[color:var(--text-muted)]">
                {usage.availableSlots > 0
                  ? accountsPage.kpiDetail.slotsAvailable(usage.availableSlots)
                  : accountsPage.kpiDetail.slotsFull}
              </span>
            }
          />
        </KpiGrid>

        {/* Compliance copy, quoted verbatim from the design reference §11. Not a
            tooltip, not truncated, and asserted by an e2e test — so it stays out
            of PageHeader's description slot, which is capped by measure. */}
        <p className="max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
          {authorisationBoundary} {creationBoundary}
        </p>

        {/* The actionable half leads. An account whose authorisation the platform
            ended is the only thing on this page that stops content going out. */}
        {attention.length > 0 && (
          <Card id="attention" className="scroll-mt-20">
            <CardHeader
              as="h2"
              title={accountsPage.attention.heading}
              description={accountsPage.attention.body}
              divided
              action={
                <span
                  className={cn(
                    "rounded-[var(--radius-chip)] px-2 py-0.5",
                    "bg-[var(--warning-soft)] text-[length:var(--text-app-label)]",
                    "font-[var(--weight-strong)] text-[color:var(--warning)]",
                  )}
                >
                  {accountsPage.attention.chip}
                </span>
              }
            />
            <CardBody pad="none">
              <ul>
                {attention.map((slot) => (
                  <li
                    key={slot.id}
                    className={cn(
                      "flex flex-wrap items-start justify-between gap-[var(--space-3)]",
                      "border-b border-[var(--border-subtle)] p-[var(--app-panel-pad)] last:border-b-0",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-[var(--space-2)]">
                        <span className="truncate font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                          {slotIdentity(slot)}
                        </span>
                        <HealthChip status={slot.status} />
                      </p>
                      <p className="mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                        {PLATFORM_LABELS[slot.platform]}
                        {slot.account?.username ? ` · @${slot.account.username}` : ""}
                        {` · Slot ${String(slot.slotNumber).padStart(2, "0")}`}
                      </p>
                      <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                        {slotPresentation(slot.status).requiredAction}
                      </p>
                    </div>
                    <ButtonLink href={`/app/accounts/${slot.id}`} variant="secondary">
                      {accountsPage.attention.openSlot}
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </CardBody>
            {/* Why there is no reconnect button here. Every connector's real state
                is listed at the bottom of the page; on a deployment with no
                platform credentials there is nothing a button could start. */}
            <CardFooter>
              <span>{accountsPage.attention.reconnectRoute}</span>
              <a
                href="#platforms"
                className={cn(
                  "rounded-[var(--radius-chip)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                )}
              >
                {accountsPage.attention.reconnectLink}
              </a>
            </CardFooter>
          </Card>
        )}

        <Card>
          <CardHeader as="h2" title={accountsPage.accounts.heading} />
          <CardBody pad="tight" className="border-b border-[var(--border-subtle)]">
            <FilterBar
              search={false}
              views={["table", "grid"]}
              filters={[
                { key: "platform", label: "Platform", options: PLATFORM_OPTIONS },
                {
                  key: "state",
                  label: "State",
                  options: accountsPage.stateOptions.map((option) => ({
                    id: option.id,
                    label: option.label,
                  })),
                },
              ]}
            />
          </CardBody>

          {slots.length > 0 && view === "table" && (
            <CardBody pad="none">
              <DataTable
                caption={accountsPage.accounts.tableCaption}
                columns={columns}
                rows={slots}
                rowKey={(row) => row.id}
                rowHref={(row) => `/app/accounts/${row.id}`}
              />
            </CardBody>
          )}

          {slots.length > 0 && view === "grid" && (
            <CardBody>
              <ul
                aria-label={accountsPage.accounts.gridLabel}
                className="grid gap-[var(--app-panel-gap)] lg:grid-cols-2"
              >
                {slots.map((slot) => (
                  <AccountSlotCard key={slot.id} slot={slot} activity={slot.activity} />
                ))}
              </ul>
            </CardBody>
          )}

          {slots.length > 0 && (
            <CardFooter>{accountsPage.accounts.reachWindowNote(REACH_WINDOW_DAYS)}</CardFooter>
          )}

          {slots.length === 0 && filtered && (
            <EmptyState
              bare
              icon={<AtSign size={20} strokeWidth={1.75} />}
              title={accountsPage.noMatches.title}
              body={accountsPage.noMatches.body}
              actions={
                <ButtonLink href="/app/accounts" variant="secondary">
                  {accountsPage.accounts.clearFilters}
                </ButtonLink>
              }
            />
          )}

          {slots.length === 0 && !filtered && (
            <EmptyState
              bare
              icon={<AtSign size={20} strokeWidth={1.75} />}
              title={accountsPage.empty.title}
              body={accountsPage.empty.body}
              actions={
                mayConnect ? (
                  <ButtonLink href="/app/accounts/launch">{slotActions.prepare}</ButtonLink>
                ) : undefined
              }
            />
          )}
        </Card>

        {/* Capacity, drawn as an offer rather than as more account cards. Hidden
            while a filter is applied: an empty slot has no platform and no state,
            so it cannot honestly be part of a filtered result. */}
        {previewNumbers.length > 0 && !filtered && (
          <section aria-labelledby="capacity-heading">
            <SectionHeader
              id="capacity-heading"
              title={accountsPage.capacity.heading}
              description={accountsPage.capacity.body}
            />
            <ul
              aria-label={accountsPage.capacity.gridLabel}
              className="mt-[var(--space-4)] grid gap-[var(--app-panel-gap)] sm:grid-cols-2 xl:grid-cols-3"
            >
              {previewNumbers.map((previewNumber) => (
                <EmptySlotTile
                  key={previewNumber}
                  previewNumber={previewNumber}
                  canClaim={mayConnect}
                />
              ))}
            </ul>
          </section>
        )}

        {unslottedRows.length > 0 && (
          <Card>
            <CardHeader
              as="h2"
              title={accountsPage.unslotted.heading}
              description={accountsPage.unslotted.body}
              divided
            />
            <CardBody>
              <ul className="flex flex-col gap-[var(--space-3)]">
                {unslottedRows.map((account) => (
                  <li key={account.id} className="flex items-center gap-[var(--space-3)]">
                    <CellThumb
                      src={account.avatarUrl}
                      alt=""
                      fallback={account.displayName ?? account.username ?? "Account"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                        {account.displayName ?? account.username ?? accountsPage.unslotted.unnamed}
                      </span>
                      <span className="block truncate text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                        {PLATFORM_LABELS[account.platform]} · {account.health.replace(/_/g, " ")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        {archivedRows.length > 0 && (
          <Card>
            <CardHeader
              as="h2"
              title={accountsPage.archived.heading}
              description={accountsPage.archived.body}
              divided
            />
            <CardBody>
              <ul className="flex flex-wrap gap-[var(--space-2)]">
                {archivedRows.map((slot) => (
                  <li
                    key={slot.id}
                    className={cn(
                      "flex items-center gap-[var(--space-2)] rounded-[var(--radius-chip)]",
                      "bg-[var(--surface-muted)] px-2 py-1",
                      "text-[length:var(--text-app-label)] text-[color:var(--text-muted)]",
                    )}
                  >
                    <span className="app-figure">
                      {launchKitPage.slotLabel(slot.slotNumber)}
                    </span>
                    <span>
                      {PLATFORM_LABELS[slot.platform]}
                      {slot.displayLabel ? ` · ${slot.displayLabel}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        {/* Every connector's real state, including why it cannot be used. Stated
            before a user invests in setting one up rather than after their first
            failure. */}
        <Card id="platforms" className="scroll-mt-20">
          <CardHeader
            as="h2"
            title={accountsPage.platforms.heading}
            description={accountsPage.platforms.body}
            divided
          />
          <CardBody pad="none">
            <ul>
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => {
                const state = availability[platform];
                return (
                  <li
                    key={platform}
                    className="border-b border-[var(--border-subtle)] p-[var(--app-panel-pad)] last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
                      <span className="flex items-center gap-[var(--space-2)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                        <PlatformMark platform={platform} />
                        {PLATFORM_LABELS[platform]}
                      </span>
                      <AvailabilityChip availability={state} />
                    </div>

                    {/* The exact reason, not a generic unavailable message. */}
                    {state.state === "configuration_required" && (
                      <p className="mt-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                        {accountsPage.platforms.missingEnv}:{" "}
                        <code className="app-figure">{state.missingEnv.join(", ")}</code>
                      </p>
                    )}
                    {(state.state === "adapter_not_implemented" ||
                      state.state === "awaiting_platform_approval") && (
                      <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                        {state.detail}
                      </p>
                    )}

                    <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                      {PLATFORM_REQUIREMENTS[platform].approval}
                    </p>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </PageStack>
    </AppPage>
  );
}

/* ==========================================================================
   SMALL PARTS
   ======================================================================== */

/** A fact the platform did not report. An em dash, plus its reason for AT. */
function NotReported() {
  return (
    <span className="text-[color:var(--text-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{accountsPage.notReported}</span>
    </span>
  );
}

/**
 * Per-row operations.
 *
 * Only actions that can actually succeed are rendered. There is no reconnect
 * control anywhere on this page because no authorisation route exists yet on this
 * deployment — a button that produced a 404 would be worse than the sentence
 * explaining what has to happen instead.
 */
function SlotActions({ slot, mayConnect }: { slot: SlotRow; mayConnect: boolean }) {
  const canRegister = mayConnect && slot.status === "launch_kit_ready";
  const canArchive = mayConnect && !slot.account && slot.status !== "archived";

  if (!canRegister && !canArchive) {
    return (
      <span className="text-[color:var(--text-muted)]">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{accountsPage.noAction}</span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-[var(--space-1)]">
      {canRegister && (
        <form action={markAccountRegistered}>
          <input type="hidden" name="slotId" value={slot.id} />
          <Button type="submit" variant="text">
            {slotActions.markRegistered}
          </Button>
        </form>
      )}
      {canArchive && (
        <form action={archiveAccountSlot}>
          <input type="hidden" name="slotId" value={slot.id} />
          <Button type="submit" variant="text">
            {slotActions.archive}
          </Button>
        </form>
      )}
    </span>
  );
}

/** Connector state. A word and an icon; never a bare colour. */
function AvailabilityChip({ availability }: { availability: AdapterAvailability }) {
  const available = availability.state === "available";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] px-2 py-1",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        available
          ? "bg-[var(--success-soft)] text-[color:var(--success)]"
          : "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
      )}
    >
      {available ? (
        <Check aria-hidden="true" size={12} strokeWidth={2.5} className="shrink-0" />
      ) : (
        <AlertTriangle aria-hidden="true" size={12} strokeWidth={2} className="shrink-0" />
      )}
      {availabilityLabel(availability)}
    </span>
  );
}
