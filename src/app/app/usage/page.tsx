import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { AlertTriangle, AtSign, Clock, Send, Wallet, Zap } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  accountSlots,
  campaigns,
  creditLedger,
  creditReservations,
  planLimits,
  scheduledPosts,
  subscriptionPlans,
  subscriptions,
  topUpPackages,
  workspaceLimits,
} from "@/lib/db/schema";
import { workspaceAccountSlotLimit } from "@/lib/db/authorization";
import { isAnyProviderConfigured } from "@/lib/creative";
import { tenantScope } from "@/lib/creative/scope";
import { ledgerReasonLabel, readUsageSummary } from "@/lib/creative/usage";
import { cn } from "@/lib/cn";
import { AppPage, DashGrid, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { Progress } from "@/components/app-ui/Progress";
import { EmptyState } from "@/components/app-ui/States";
import { CategoryBars } from "@/components/app-ui/charts/CategoryBars";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { Button } from "@/components/primitives/Button";
import { usageCopy } from "@/content/usage";

export const metadata: Metadata = {
  title: "Usage",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Months of history in the trend panel, including the current one. */
const TREND_MONTHS = 6;
/** Campaigns listed in the attribution panel before the list states it is capped. */
const CAMPAIGN_LIMIT = 8;

const countFormatter = new Intl.NumberFormat("en-US");

/**
 * UTC everywhere, deliberately.
 *
 * The ledger's period is a UTC calendar month (`currentPeriod`), so rendering an
 * entry in the server's local zone would put a charge in a different month from
 * the one it is summed into.
 */
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * The year is included deliberately. The ledger is append-only and its last 25
 * entries can span years in a quiet workspace, so "Mar 14, 09:22" would be
 * ambiguous about which March it was.
 */
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  occurredAt: Date;
};

type ReservationRow = {
  id: string;
  credits: number;
  purpose: string;
  createdAt: Date;
  expiresAt: Date;
};

/**
 * Usage.
 *
 * Two hard rules govern this page, and both are about what it must NOT show.
 *
 * 1. INTERNAL PROVIDER COST NEVER APPEARS. `generation_runs.cost_cents` and
 *    `provider_runs.actual_internal_cents` are our margin, not the customer's
 *    price — see the header of src/lib/creative/usage.ts, which keeps the cost
 *    query in `readCostBreakdown` and names it for its audience. Nothing here
 *    reads it, and no figure on this page is denominated in currency except a
 *    top-up package's own list price.
 *
 * 2. CREDITS ARE THE LEDGER UNIT. Every credit figure is a sum over the
 *    append-only `credit_ledger`, directly or through `readUsageSummary`, so any
 *    number here can be traced to the rows that produced it. There are two
 *    incompatible "credit" notions in this codebase — `lib/content/plan.ts`
 *    counts cents of list price, the ledger counts Production Credits, roughly
 *    25x apart — and only the Production Credit, the one that is reserved and
 *    posted, is shown.
 */
export default async function UsagePage() {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/usage"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);
  const { context } = resolution;

  // Server-side gate. Usage exposes spend, which is billing information —
  // hiding the nav item is not authorisation.
  if (!can(context.role, "billing.view")) {
    return (
      <AppPage width="text">
        <AuthMessage
          tone="notice"
          title="Not available to your role"
          body="Viewing usage and spend requires the billing.view permission. Your role can create and review content, but not see billing. An administrator can change this from the Team page."
        />
      </AppPage>
    );
  }

  const scope = tenantScope(context.organizationId, context.workspaceId);
  const { organizationId, workspaceId } = context;

  // The same UTC-month boundary `currentPeriod()` computes, taken once here so
  // that every query below is cut on one instant rather than on nine slightly
  // different "now"s.
  const periodStart = startOfUtcMonth(new Date());
  const trendStart = addUtcMonths(periodStart, -(TREND_MONTHS - 1));

  const monthExpr = sql<string>`to_char(date_trunc('month', ${creditLedger.occurredAt}), 'YYYY-MM')`;

  // Eight aggregates plus the summary, one round trip. Sequentially this page
  // would pay nine network latencies before rendering anything.
  const [
    summary,
    trendRows,
    campaignRows,
    planRows,
    overrideRows,
    slotRows,
    slotLimit,
    publishedRows,
    topUpRows,
  ] = await Promise.all([
    readUsageSummary(scope),

    // Monthly trend, straight off the ledger. Consumption is negative in the
    // ledger, so it is negated to read as a positive "used" figure.
    db
      .select({
        month: monthExpr,
        used: sql<number>`coalesce(-sum(${creditLedger.delta}) filter (where ${creditLedger.reason} = 'consumption'), 0)::int`,
        granted: sql<number>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.reason} in ('plan_grant', 'top_up')), 0)::int`,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.organizationId, organizationId),
          gte(creditLedger.occurredAt, trendStart),
        ),
      )
      .groupBy(monthExpr)
      .orderBy(monthExpr),

    /*
     * Credits per campaign, still summed from ledger rows.
     *
     * The ledger has no campaign column — it holds money, not attribution — so
     * the campaign is reached through the reservation that authorised the
     * charge. `settleReservation` writes its consumption entry with the
     * deterministic key `charge:<reservation id>` (src/lib/creative/credits.ts),
     * which is what makes that join possible without a foreign key.
     *
     * The join is deliberately not the source of the TOTAL: the unattributed
     * remainder below is computed as `usedThisPeriod` minus what matched, so if
     * this join ever stopped matching, the panel would report everything as
     * unattributed rather than silently reporting a smaller, plausible total.
     */
    db
      .select({
        campaignId: creditReservations.campaignId,
        campaignName: campaigns.name,
        credits: sql<number>`coalesce(-sum(${creditLedger.delta}), 0)::int`,
      })
      .from(creditLedger)
      .innerJoin(
        creditReservations,
        sql`${creditLedger.idempotencyKey} = 'charge:' || ${creditReservations.id}::text`,
      )
      .leftJoin(campaigns, eq(campaigns.id, creditReservations.campaignId))
      .where(
        and(
          eq(creditLedger.organizationId, organizationId),
          eq(creditReservations.organizationId, organizationId),
          eq(creditLedger.reason, "consumption"),
          gte(creditLedger.occurredAt, periodStart),
        ),
      )
      .groupBy(creditReservations.campaignId, campaigns.name),

    // Plan, its listed terms, and the plan-level quota row. Left joins
    // throughout: an organisation bootstrapped before billing was configured
    // carries a plan code with no matching catalogue row, and that is reported
    // rather than papered over.
    db
      .select({
        planCode: subscriptions.planCode,
        status: subscriptions.status,
        provider: subscriptions.provider,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        subscriptionCredits: subscriptions.includedCredits,
        planLabel: subscriptionPlans.label,
        planCredits: subscriptionPlans.includedCredits,
        priceCents: subscriptionPlans.priceCents,
        currency: subscriptionPlans.currency,
        interval: subscriptionPlans.interval,
        requiresContact: subscriptionPlans.requiresContact,
        planGenerationLimit: planLimits.monthlyGenerationLimit,
        planPublishLimit: planLimits.monthlyPublishLimit,
      })
      .from(subscriptions)
      .leftJoin(subscriptionPlans, eq(subscriptionPlans.code, subscriptions.planCode))
      .leftJoin(planLimits, eq(planLimits.planCode, subscriptions.planCode))
      .where(eq(subscriptions.organizationId, organizationId))
      .limit(1),

    // Per-workspace quota overrides. An absent row or a null column means
    // "fall back to the plan default" — never zero.
    db
      .select({
        generationLimit: workspaceLimits.monthlyGenerationLimit,
        publishLimit: workspaceLimits.monthlyPublishLimit,
      })
      .from(workspaceLimits)
      .where(eq(workspaceLimits.workspaceId, workspaceId))
      .limit(1),

    // Archived slots keep their number but release capacity, so they are
    // excluded here for the same reason the accounts screen excludes them.
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(accountSlots)
      .where(and(eq(accountSlots.workspaceId, workspaceId), isNull(accountSlots.archivedAt))),

    // The server's own resolver: workspace override, else plan default, else the
    // documented floor of 10. Reused rather than reimplemented so this page
    // cannot disagree with the check that actually blocks a connection.
    workspaceAccountSlotLimit(workspaceId),

    db
      .select({ value: sql<number>`count(*)::int` })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.workspaceId, workspaceId),
          eq(scheduledPosts.status, "published"),
          gte(scheduledPosts.publishedAt, periodStart),
        ),
      ),

    db
      .select({
        code: topUpPackages.code,
        label: topUpPackages.label,
        credits: topUpPackages.credits,
        priceCents: topUpPackages.priceCents,
        currency: topUpPackages.currency,
      })
      .from(topUpPackages)
      .where(eq(topUpPackages.available, true))
      .orderBy(asc(topUpPackages.position)),
  ]);

  const { balance, period } = summary;
  const granted = summary.grantedThisPeriod;
  const plan = planRows[0] ?? null;
  const override = overrideRows[0] ?? null;
  const slotsInUse = slotRows[0]?.value ?? 0;
  const publishedThisPeriod = publishedRows[0]?.value ?? 0;

  // Override first, then the plan default. Both may be null, and null means the
  // limit is not configured — which means it is not enforced, not that it is 0.
  const generationLimit = override?.generationLimit ?? plan?.planGenerationLimit ?? null;
  const publishLimit = override?.publishLimit ?? plan?.planPublishLimit ?? null;

  // A period with no grant shows the used figure alone. Dividing by zero here
  // would render NaN% inside the bar.
  const usedPercent = granted > 0 ? Math.min(100, (summary.usedThisPeriod / granted) * 100) : null;

  const attributed = campaignRows
    // `credit_reservations.campaign_id` carries no foreign key, so a deleted
    // campaign leaves the id behind with no name to resolve. Said, not hidden.
    .flatMap((row) =>
      row.campaignId === null
        ? []
        : [{ id: row.campaignId, label: row.campaignName ?? "Deleted campaign", value: row.credits }],
    )
    .sort((a, b) => b.value - a.value);

  const attributedTotal = attributed.reduce((sum, row) => sum + row.value, 0);
  const unattributed = Math.max(0, summary.usedThisPeriod - attributedTotal);

  const campaignBars = [
    ...attributed.slice(0, CAMPAIGN_LIMIT),
    ...(unattributed > 0
      ? [{ id: "unattributed", label: usageCopy.campaignsUnattributed, value: unattributed }]
      : []),
  ].map((row) => ({
    ...row,
    detail:
      summary.usedThisPeriod > 0
        ? `${Math.round((row.value / summary.usedThisPeriod) * 100)}% of period`
        : undefined,
  }));

  const generationTotal = summary.generations.reduce((sum, row) => sum + row.total, 0);

  // Buying credits is `billing.manage`, not `billing.view`: an analyst may read
  // this page and must not be offered a purchase they cannot make.
  const canBuy = can(context.role, "billing.manage");

  const ledgerColumns: readonly Column<LedgerRow>[] = [
    {
      id: "entry",
      header: "Entry",
      cell: (row) => (
        <PrimaryCell title={ledgerReasonLabel(row.reason)} detail={row.note ?? undefined} />
      ),
    },
    {
      id: "occurred",
      header: "Occurred",
      hideBelow: "sm",
      cell: (row) => (
        <span className="app-figure whitespace-nowrap text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
          {dateTimeFormatter.format(row.occurredAt)}
        </span>
      ),
    },
    {
      id: "delta",
      header: "Change",
      numeric: true,
      width: "8rem",
      cell: (row) => (
        // The sign is carried by the glyph, not by colour alone, so direction
        // survives a colour-vision difference.
        <span
          className={cn(
            "whitespace-nowrap font-[var(--weight-strong)]",
            row.delta > 0 ? "text-[color:var(--success)]" : "text-[color:var(--text-primary)]",
          )}
        >
          {row.delta > 0 ? "+" : "−"}
          {countFormatter.format(Math.abs(row.delta))}
          <span className="sr-only">
            {row.delta > 0 ? " credits added" : " credits deducted"}
          </span>
        </span>
      ),
    },
  ];

  const reservationColumns: readonly Column<ReservationRow>[] = [
    {
      id: "purpose",
      header: "Held for",
      cell: (row) => (
        <PrimaryCell
          title={usageCopy.purposeLabels[row.purpose] ?? row.purpose}
          detail={`Reserved ${dateTimeFormatter.format(row.createdAt)}`}
        />
      ),
    },
    {
      id: "expires",
      header: "Releases",
      hideBelow: "sm",
      cell: (row) => (
        <span className="app-figure whitespace-nowrap text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
          {dateTimeFormatter.format(row.expiresAt)}
        </span>
      ),
    },
    {
      id: "credits",
      header: "Credits",
      numeric: true,
      width: "8rem",
      cell: (row) => countFormatter.format(row.credits),
    },
  ];

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={usageCopy.heading}
          description={usageCopy.body}
          meta={[context.workspaceName, `Period from ${dateFormatter.format(period.start)}`]}
          actions={
            canBuy ? (
              // Disabled with a stated reason rather than hidden: buying credits
              // is a real capability of this role, and it needs a billing
              // provider that no deployment has yet.
              <Button disabled title={usageCopy.topUpUnavailable}>
                {usageCopy.topUpLabel}
              </Button>
            ) : undefined
          }
        />

        {!isAnyProviderConfigured() && (
          <div className="max-w-[46rem]">
            <AuthMessage
              tone="notice"
              title={usageCopy.unmeteredTitle}
              body={usageCopy.unmeteredBody}
            />
          </div>
        )}

        {/* Four related figures together: "available" alone does not answer why
            the balance is lower than the user expected. */}
        <KpiGrid columns={4}>
          <KpiCard
            label={usageCopy.availableLabel}
            value={countFormatter.format(balance.available)}
            icon={<Wallet size={14} strokeWidth={1.75} />}
            tone={balance.available > 0 ? "brand" : "neutral"}
            detail={
              <span className="text-[color:var(--text-muted)]">{usageCopy.availableDetail}</span>
            }
          />
          <KpiCard
            label={usageCopy.reservedLabel}
            value={countFormatter.format(balance.reserved)}
            icon={<Clock size={14} strokeWidth={1.75} />}
            detail={
              <span className="text-[color:var(--text-muted)]">{usageCopy.reservedDetail}</span>
            }
          />
          <KpiCard
            label={usageCopy.usedLabel}
            value={countFormatter.format(summary.usedThisPeriod)}
            icon={<Zap size={14} strokeWidth={1.75} />}
            detail={
              <span className="text-[color:var(--text-muted)]">
                {granted > 0
                  ? `of ${countFormatter.format(granted)} granted`
                  : "no grant this period"}
              </span>
            }
          />
          <KpiCard
            label={usageCopy.includedLabel}
            value={countFormatter.format(granted)}
            detail={
              <span className="text-[color:var(--text-muted)]">{usageCopy.includedDetail}</span>
            }
          />
        </KpiGrid>

        <DashGrid>
          {/* The trend takes two thirds: it is the page's primary reading. Bars
              rather than a line — six discrete monthly totals are a comparison,
              not a continuous signal, and the bar row prints every figure. */}
          <Card className="min-w-0 lg:col-span-2 xl:col-span-8">
            <CardHeader
              as="h2"
              title={usageCopy.trendHeading}
              description={usageCopy.trendHint}
              divided
            />
            {trendRows.length > 0 ? (
              <CardBody>
                <CategoryBars
                  data={trendRows.map((row) => ({
                    id: row.month,
                    label: monthLabel(row.month),
                    value: row.used,
                    detail:
                      row.granted > 0
                        ? `of ${countFormatter.format(row.granted)} granted`
                        : "no grant",
                  }))}
                  // Scaled against the largest figure of either measure, so a
                  // month's bar is comparable with the grant it ran against
                  // rather than only with other months' consumption.
                  max={Math.max(
                    ...trendRows.map((row) => Math.max(row.used, row.granted)),
                    1,
                  )}
                  formatValue={(value) => `${countFormatter.format(value)} used`}
                />
              </CardBody>
            ) : (
              <EmptyState
                bare
                icon={<Zap size={20} strokeWidth={1.75} />}
                title={usageCopy.noTrendTitle}
                body={usageCopy.noTrendBody}
              />
            )}
          </Card>

          <div className="flex min-w-0 flex-col gap-[var(--app-panel-gap)] lg:col-span-2 xl:col-span-4">
            <Card pad="default" className="min-w-0">
              <h2 className="app-card-title text-[color:var(--text-primary)]">
                {usageCopy.planHeading}
              </h2>

              {plan ? (
                <>
                  <dl className="mt-[var(--space-3)] flex flex-col">
                    <SettingRow
                      label={usageCopy.planCodeLabel}
                      value={plan.planLabel ?? plan.planCode}
                    />
                    <SettingRow
                      label={usageCopy.planStatusLabel}
                      value={
                        usageCopy.subscriptionStatusLabels[plan.status] ?? plan.status
                      }
                    />
                    <SettingRow
                      label={usageCopy.planPeriodLabel}
                      value={
                        plan.currentPeriodStart && plan.currentPeriodEnd
                          ? `${dateFormatter.format(plan.currentPeriodStart)} – ${dateFormatter.format(plan.currentPeriodEnd)}`
                          : null
                      }
                    />
                    <SettingRow
                      label={usageCopy.planIncludedLabel}
                      value={
                        // The organisation's own recorded grant first, then the
                        // plan's listed allowance. Zero on an unconfigured
                        // subscription is not a grant of zero, so it reports as
                        // not reported.
                        plan.subscriptionCredits > 0
                          ? countFormatter.format(plan.subscriptionCredits)
                          : plan.planCredits != null && plan.planCredits > 0
                            ? countFormatter.format(plan.planCredits)
                            : null
                      }
                    />
                    {plan.priceCents != null && !plan.requiresContact && (
                      <SettingRow
                        label={usageCopy.planPriceLabel}
                        value={`${formatMoney(plan.priceCents, plan.currency ?? "EUR")} / ${plan.interval ?? "month"}`}
                      />
                    )}
                  </dl>

                  {plan.status === "unconfigured" && (
                    <p className="mt-[var(--space-3)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                      {usageCopy.planUnconfigured}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-[var(--space-2)] max-w-[52ch] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
                  {usageCopy.planNoSubscription}
                </p>
              )}
            </Card>

            <Card pad="default" className="min-w-0">
              <h2 className="app-card-title text-[color:var(--text-primary)]">
                {usageCopy.consumptionHeading}
              </h2>

              {usedPercent === null ? (
                <p className="mt-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
                  {countFormatter.format(summary.usedThisPeriod)} credits used, against no grant
                  this period.
                </p>
              ) : (
                <>
                  <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-metric)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
                    {countFormatter.format(summary.usedThisPeriod)}
                    <span className="text-[color:var(--text-muted)]">
                      /{countFormatter.format(granted)}
                    </span>
                  </p>
                  <Progress
                    percent={usedPercent}
                    label={usageCopy.consumptionHeading}
                    className="mt-[var(--space-3)]"
                  />
                </>
              )}

              <p className="mt-[var(--space-3)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                {usageCopy.consumptionHint}
              </p>
            </Card>
          </div>
        </DashGrid>

        <DashGrid>
          <Card className="min-w-0 xl:col-span-6">
            <CardHeader
              as="h2"
              title={usageCopy.campaignsHeading}
              description={usageCopy.campaignsHint}
              divided
            />
            {campaignBars.length > 0 ? (
              <CardBody>
                <CategoryBars
                  data={campaignBars}
                  // Bars are a share of the period's total consumption, so the
                  // panel reads as a distribution rather than a ranking.
                  max={Math.max(summary.usedThisPeriod, 1)}
                  formatValue={(value) => countFormatter.format(value)}
                />
              </CardBody>
            ) : (
              <EmptyState
                bare
                title={usageCopy.noCampaignsTitle}
                body={usageCopy.noCampaignsBody}
              />
            )}
            {attributed.length > CAMPAIGN_LIMIT && (
              <CardFooter>
                Showing the {CAMPAIGN_LIMIT} largest of {attributed.length} campaigns charged this
                period.
              </CardFooter>
            )}
          </Card>

          <Card className="min-w-0 xl:col-span-6">
            <CardHeader
              as="h2"
              title={usageCopy.generationsHeading}
              description={usageCopy.generationsHint}
              divided
            />
            <CardBody>
              {generationTotal > 0 ? (
                <>
                  <CategoryBars
                    data={summary.generations.map((row) => ({
                      id: row.kind,
                      label: usageCopy.kindLabels[row.kind] ?? row.kind,
                      value: row.total,
                      detail: `${Math.round((row.total / generationTotal) * 100)}% of runs`,
                    }))}
                    max={generationTotal}
                    tone="signal"
                    formatValue={(value) => countFormatter.format(value)}
                  />

                  {/* Real run states, not a computed success rate — a
                      percentage would hide that three runs are stuck. */}
                  <ul className="mt-[var(--space-4)] flex flex-col gap-[var(--space-2)] border-t border-[var(--border-subtle)] pt-[var(--space-4)]">
                    {summary.generations.map((row) => (
                      <li
                        key={row.kind}
                        className="flex flex-wrap items-baseline justify-between gap-[var(--space-3)]"
                      >
                        <span className="text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                          {usageCopy.kindLabels[row.kind] ?? row.kind}
                        </span>
                        <span className="app-figure flex gap-[var(--space-4)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                          <span>{countFormatter.format(row.completed)} done</span>
                          {row.inFlight > 0 && (
                            <span>{countFormatter.format(row.inFlight)} running</span>
                          )}
                          {row.failed > 0 && (
                            <span className="inline-flex items-center gap-1 text-[color:var(--error)]">
                              <AlertTriangle aria-hidden="true" size={12} strokeWidth={2} />
                              {countFormatter.format(row.failed)} failed
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  bare
                  title={usageCopy.noGenerationsTitle}
                  body={usageCopy.noGenerationsBody}
                />
              )}
            </CardBody>
          </Card>
        </DashGrid>

        {/* Limits, resolved exactly the way the server resolves them. A limit
            that is not configured is not enforced, and says so rather than
            rendering as zero capacity. */}
        <Card>
          <CardHeader
            as="h2"
            title={usageCopy.limitsHeading}
            description={usageCopy.limitsHint}
            divided
          />
          <CardBody className="grid gap-[var(--space-5)] md:grid-cols-3">
            <div className="min-w-0">
              <p className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]">
                <AtSign aria-hidden="true" size={13} strokeWidth={1.75} />
                {usageCopy.slotsLabel}
              </p>
              <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-metric)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
                {countFormatter.format(slotsInUse)}
                <span className="text-[color:var(--text-muted)]">
                  /{countFormatter.format(slotLimit)}
                </span>
              </p>
              <Progress
                percent={slotLimit > 0 ? (slotsInUse / slotLimit) * 100 : 0}
                label="Account slots in use"
                showValue={false}
                className="mt-[var(--space-3)]"
              />
              <p className="mt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                {usageCopy.slotsHint}
              </p>
            </div>

            <div className="min-w-0">
              <p className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]">
                <Zap aria-hidden="true" size={13} strokeWidth={1.75} />
                {usageCopy.generationLimitLabel}
              </p>
              <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-metric)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
                {generationLimit != null ? countFormatter.format(generationLimit) : <NotReported />}
              </p>
              {generationLimit == null && (
                <p className="mt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                  {usageCopy.generationLimitNone}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <p className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]">
                <Send aria-hidden="true" size={13} strokeWidth={1.75} />
                {usageCopy.publishLimitLabel}
              </p>
              <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-metric)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
                {publishLimit != null ? countFormatter.format(publishLimit) : <NotReported />}
              </p>
              <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                {countFormatter.format(publishedThisPeriod)} {usageCopy.publishedLabel.toLowerCase()}
              </p>
              {publishLimit == null && (
                <p className="mt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                  {usageCopy.publishLimitNone}
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Rendered only when credits are actually held. This answers "why is my
            balance lower than I expected"; an always-present empty section would
            be a dead region on every other visit. */}
        {summary.activeReservations.length > 0 && (
          <Card>
            <CardHeader
              as="h2"
              title={usageCopy.reservationsHeading}
              description={usageCopy.reservationsHint}
              divided
            />
            <CardBody pad="none">
              <DataTable
                caption="Credits currently held for work in flight"
                columns={reservationColumns}
                rows={summary.activeReservations}
                rowKey={(row) => row.id}
              />
            </CardBody>
          </Card>
        )}

        {/* The ledger itself, because every figure above is a sum of exactly
            these rows and a user who disputes one needs to see them. */}
        <Card>
          <CardHeader
            as="h2"
            title={usageCopy.ledgerHeading}
            description={usageCopy.ledgerHint}
            divided
          />
          {summary.recentLedger.length > 0 ? (
            <>
              <CardBody pad="none">
                <DataTable
                  caption="Credit ledger entries, most recent first"
                  columns={ledgerColumns}
                  rows={summary.recentLedger}
                  rowKey={(row) => row.id}
                />
              </CardBody>
              {/* Stated rather than silent. A capped list that looks complete is
                  worse than one that says it is capped. */}
              <CardFooter>{usageCopy.ledgerCap(summary.recentLedger.length)}</CardFooter>
            </>
          ) : (
            <EmptyState bare title={usageCopy.noLedgerTitle} body={usageCopy.noLedgerBody} />
          )}
        </Card>

        <Card>
          <CardHeader
            as="h2"
            title={usageCopy.topUpHeading}
            description={usageCopy.topUpHint}
            divided
          />
          {topUpRows.length > 0 ? (
            <CardBody>
              <ul className="grid gap-[var(--app-panel-gap)] sm:grid-cols-2 xl:grid-cols-4">
                {topUpRows.map((row) => (
                  <li key={row.code}>
                    <Card as="article" tone="muted" pad="default" className="flex h-full flex-col">
                      <h3 className="app-card-title text-[color:var(--text-primary)]">
                        {row.label}
                      </h3>
                      <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-metric-s)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
                        {countFormatter.format(row.credits)}
                        <span className="ml-1 text-[length:var(--text-app-meta)] font-normal text-[color:var(--text-muted)]">
                          credits
                        </span>
                      </p>
                      <p className="app-figure mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
                        {formatMoney(row.priceCents, row.currency)}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            </CardBody>
          ) : (
            <EmptyState bare title={usageCopy.noTopUpsTitle} body={usageCopy.noTopUpsBody} />
          )}
          <CardFooter>{usageCopy.topUpUnavailable}</CardFooter>
        </Card>
      </PageStack>
    </AppPage>
  );
}

/* ==========================================================================
   SMALL PARTS
   ======================================================================== */

/**
 * A nullable figure.
 *
 * An em dash with the reason in the accessible name, never a zero: "no limit is
 * configured" and "the limit is zero" are opposite facts, and rendering both as
 * `0` would tell a user they cannot publish at all.
 */
function NotReported() {
  return (
    <span className="text-[color:var(--text-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not reported</span>
    </span>
  );
}

/** One label/value pair inside a card's definition list. */
function SettingRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-3)] border-t border-[var(--border-subtle)] py-[var(--space-2)] first:border-t-0 first:pt-0">
      <dt className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">{label}</dt>
      <dd className="app-figure min-w-0 truncate text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
        {value ?? <NotReported />}
      </dd>
    </div>
  );
}

/** The first instant of the current UTC month — the ledger's period boundary. */
function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function addUtcMonths(from: Date, months: number): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
}

/** `2026-07` → `Jul 2026`. Parsed as UTC so the label cannot slip a month. */
function monthLabel(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * Integer minor units → a currency string.
 *
 * The only money on this page, and it is a top-up package's own list price or a
 * plan's listed price — never a derived internal cost.
 */
function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
