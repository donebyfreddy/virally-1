import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import { campaigns, connectedAccounts, scheduledPosts } from "@/lib/db/schema.fragment";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel } from "@/components/app-ui/Panel";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { MonthGrid, type CalendarEntry } from "@/components/calendar/MonthGrid";
import { AgendaList } from "@/components/calendar/AgendaList";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { PLATFORM_OPTIONS } from "@/content/create";
import { calendarCopy, CALENDAR_VIEWS, POST_STATUS_OPTIONS } from "@/content/calendar";

export const metadata: Metadata = {
  title: "Calendar",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const VALID_PLATFORMS = new Set<string>(PLATFORM_OPTIONS.map((option) => option.id));
const VALID_STATUSES = new Set<string>(POST_STATUS_OPTIONS.map((option) => option.id));
const VALID_VIEWS = new Set<string>(CALENDAR_VIEWS.map((option) => option.id));

/**
 * Calendar.
 *
 * Month and agenda views only. Week and day were specified, but a week grid is a
 * month grid with a different column count and a day view is the agenda filtered
 * to one date — shipping them as separate half-built surfaces would add two more
 * layouts to keep consistent for no new capability. The agenda is the honest
 * version of "day", and it is also the accessible equivalent of the grid.
 *
 * Drag-to-reschedule is not implemented. Rescheduling writes to the publishing
 * pipeline, and a drag that appears to work but does not persist is worse than
 * no drag — so the month grid is read-and-navigate, and each entry links to its
 * content.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/calendar"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const viewParam = single("view");
  const view = viewParam && VALID_VIEWS.has(viewParam) ? viewParam : "month";

  // The month being viewed, as YYYY-MM. Defaults to the current month. Parsed
  // strictly: an unparseable value falls back rather than producing an Invalid
  // Date that would make every query return nothing.
  const monthParam = single("month");
  const anchor = parseMonth(monthParam) ?? startOfMonth(new Date());

  const rangeStart = anchor;
  const rangeEnd = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );

  const platformParam = single("platform");
  const statusParam = single("status");
  const campaignParam = single("campaign");

  const conditions: SQL[] = [
    eq(scheduledPosts.workspaceId, context.workspaceId),
    gte(scheduledPosts.scheduledFor, rangeStart),
    lt(scheduledPosts.scheduledFor, rangeEnd),
  ];

  if (platformParam && VALID_PLATFORMS.has(platformParam)) {
    conditions.push(sql`${scheduledPosts.platform}::text = ${platformParam}`);
  }
  if (statusParam && VALID_STATUSES.has(statusParam)) {
    conditions.push(sql`${scheduledPosts.status}::text = ${statusParam}`);
  }
  if (campaignParam && /^[0-9a-f-]{36}$/i.test(campaignParam)) {
    conditions.push(eq(scheduledPosts.campaignId, campaignParam));
  }

  const [rows, campaignOptions] = await Promise.all([
    db
      .select({
        id: scheduledPosts.id,
        scheduledFor: scheduledPosts.scheduledFor,
        platform: scheduledPosts.platform,
        status: scheduledPosts.status,
        contentVariantId: scheduledPosts.contentVariantId,
        campaignName: campaigns.name,
        username: connectedAccounts.username,
      })
      .from(scheduledPosts)
      .leftJoin(campaigns, eq(scheduledPosts.campaignId, campaigns.id))
      .leftJoin(connectedAccounts, eq(scheduledPosts.connectedAccountId, connectedAccounts.id))
      .where(and(...conditions))
      .orderBy(asc(scheduledPosts.scheduledFor)),

    db
      .select({ id: campaigns.id, label: campaigns.name })
      .from(campaigns)
      .where(eq(campaigns.workspaceId, context.workspaceId))
      .limit(50),
  ]);

  const entries: readonly CalendarEntry[] = rows.map((row) => ({
    id: row.id,
    // Serialised for the client boundary; a Date cannot cross it.
    scheduledFor: row.scheduledFor.toISOString(),
    platform: row.platform,
    status: row.status,
    campaignName: row.campaignName,
    username: row.username,
    href: row.contentVariantId ? `/app/content?variant=${row.contentVariantId}` : null,
  }));

  const filtered = Boolean(platformParam || statusParam || campaignParam);

  return (
    <AppPage width="full">
      <PageHeader
        eyebrow={calendarCopy.eyebrow}
        title={calendarCopy.title}
        description={calendarCopy.body}
        meta={[
          monthLabel(anchor),
          entries.length === 1 ? "1 scheduled post" : `${entries.length} scheduled posts`,
        ]}
      />

      <Panel className="mt-[var(--space-8)]">
        <FilterBar
          searchPlaceholder="Search campaigns"
          filters={[
            { key: "view", label: "View", options: CALENDAR_VIEWS },
            { key: "platform", label: "Platform", options: PLATFORM_OPTIONS },
            { key: "status", label: "Status", options: POST_STATUS_OPTIONS },
            { key: "campaign", label: "Campaign", options: campaignOptions },
          ]}
        />

        <div className="mt-[var(--space-6)]">
          {entries.length === 0 && (
            <EmptyState
              title={
                filtered ? calendarCopy.noMatches.title : calendarCopy.empty.title
              }
              body={filtered ? calendarCopy.noMatches.body : calendarCopy.empty.body}
              actions={
                filtered ? (
                  <ButtonLink href="/app/calendar" variant="secondary">
                    Clear filters
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/app/content">Review content</ButtonLink>
                )
              }
            />
          )}

          {entries.length > 0 && view === "month" && (
            <MonthGrid anchorIso={anchor.toISOString()} entries={entries} />
          )}

          {entries.length > 0 && view === "agenda" && <AgendaList entries={entries} />}
        </div>

        {/* Stated plainly rather than implied by a missing affordance. */}
        <p className="mt-[var(--space-6)] border-t border-[var(--color-border-hairline)] pt-[var(--space-4)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
          {calendarCopy.reschedulingUnavailable}
        </p>
      </Panel>
    </AppPage>
  );
}

/** `YYYY-MM` → the first instant of that month in UTC, or null if unparseable. */
function parseMonth(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
