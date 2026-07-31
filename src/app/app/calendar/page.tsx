import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import {
  campaigns,
  connectedAccounts,
  contentItems,
  contentVariants,
  scheduledPosts,
} from "@/lib/db/schema.fragment";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter } from "@/components/app-ui/Card";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { MonthGrid, WeekGrid, type CalendarEntry } from "@/components/calendar/MonthGrid";
import { AgendaList, DayTimeline } from "@/components/calendar/AgendaList";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { PLATFORM_OPTIONS } from "@/content/create";
import {
  CALENDAR_STEP_UNIT,
  CALENDAR_VIEWS,
  POST_STATUS_OPTIONS,
  calendarCopy,
  type CalendarView,
} from "@/content/calendar";

export const metadata: Metadata = {
  title: "Calendar",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const VALID_PLATFORMS = new Set<string>(PLATFORM_OPTIONS.map((option) => option.id));
const VALID_STATUSES = new Set<string>(POST_STATUS_OPTIONS.map((option) => option.id));
const VALID_VIEWS = new Set<string>(CALENDAR_VIEWS.map((option) => option.id));

/** Campaigns offered in the filter. Capped, and ordered so the cap is stable. */
const CAMPAIGN_OPTION_LIMIT = 200;

/**
 * A native `<select>` is as wide as its widest option and a campaign name has no
 * length limit, so one long name would push the filter row past a 390px
 * viewport. `FilterBar`'s select carries no max width of its own, so the cap is
 * applied to the data on the way in.
 */
const CAMPAIGN_LABEL_MAX = 32;

function optionLabel(name: string): string {
  return name.length > CAMPAIGN_LABEL_MAX ? `${name.slice(0, CAMPAIGN_LABEL_MAX - 1)}…` : name;
}

/**
 * Calendar.
 *
 * Four views over one query. Month, week and day differ in the range the page
 * loads — a month, a Monday-first week, a single day — so each is a real view
 * rather than the same data relabelled; agenda is the linear form of whatever
 * range is loaded, and the grids fall back to it below `md`.
 *
 * View and range both live in the URL and both are validated, so a filtered
 * calendar is a shareable link, the back button steps through it, and the page
 * stays a server component that re-queries rather than fetching a year and
 * hiding cells on the client. The stepper and the switcher are `<Link>`s for the
 * same reason: `router.replace` would leave the back button doing nothing.
 *
 * Drag-to-reschedule is not implemented. Rescheduling writes to the publishing
 * pipeline, and a drag that appears to work but does not persist is worse than
 * no drag — so every view is read-and-navigate, and each post links to its
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
  const view: CalendarView =
    viewParam && VALID_VIEWS.has(viewParam) ? (viewParam as CalendarView) : "month";

  // The anchor is a day, not a month, because week and day views cannot be
  // addressed by one. `month=YYYY-MM` is still accepted so links minted before
  // the week and day views existed keep resolving.
  const anchor =
    parseDay(single("date")) ?? parseMonth(single("month")) ?? startOfUtcDay(new Date());

  const range = rangeFor(view, anchor);
  const todayIso = isoDay(new Date());

  const query = single("q")?.trim() ?? "";
  const platformParam = single("platform");
  const statusParam = single("status");
  const campaignParam = single("campaign");

  const conditions: SQL[] = [
    eq(scheduledPosts.workspaceId, context.workspaceId),
    gte(scheduledPosts.scheduledFor, range.start),
    lt(scheduledPosts.scheduledFor, range.end),
  ];

  // Each filter is validated against its own option set before reaching SQL, so
  // a hand-edited URL cannot introduce a predicate of its own.
  if (platformParam && VALID_PLATFORMS.has(platformParam)) {
    conditions.push(sql`${scheduledPosts.platform}::text = ${platformParam}`);
  }
  if (statusParam && VALID_STATUSES.has(statusParam)) {
    conditions.push(sql`${scheduledPosts.status}::text = ${statusParam}`);
  }
  if (campaignParam && /^[0-9a-f-]{36}$/i.test(campaignParam)) {
    conditions.push(eq(scheduledPosts.campaignId, campaignParam));
  }
  if (query) {
    // Both, because a post is found by either name a user remembers it under.
    const search = or(
      ilike(contentItems.title, `%${query}%`),
      ilike(campaigns.name, `%${query}%`),
    );
    if (search) conditions.push(search);
  }

  const [rows, campaignOptions] = await Promise.all([
    db
      .select({
        id: scheduledPosts.id,
        scheduledFor: scheduledPosts.scheduledFor,
        platform: scheduledPosts.platform,
        status: scheduledPosts.status,
        timezone: scheduledPosts.timezone,
        contentVariantId: scheduledPosts.contentVariantId,
        titleOverride: contentVariants.titleOverride,
        itemTitle: contentItems.title,
        campaignName: campaigns.name,
        username: connectedAccounts.username,
        displayName: connectedAccounts.displayName,
        avatarUrl: connectedAccounts.avatarUrl,
      })
      .from(scheduledPosts)
      .leftJoin(campaigns, eq(scheduledPosts.campaignId, campaigns.id))
      .leftJoin(connectedAccounts, eq(scheduledPosts.connectedAccountId, connectedAccounts.id))
      .leftJoin(contentVariants, eq(scheduledPosts.contentVariantId, contentVariants.id))
      .leftJoin(contentItems, eq(contentVariants.contentItemId, contentItems.id))
      .where(and(...conditions))
      .orderBy(asc(scheduledPosts.scheduledFor)),

    db
      .select({ id: campaigns.id, label: campaigns.name })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, context.workspaceId), isNull(campaigns.deletedAt)))
      .orderBy(asc(campaigns.name))
      .limit(CAMPAIGN_OPTION_LIMIT),
  ]);

  const entries: readonly CalendarEntry[] = rows.map((row) => ({
    id: row.id,
    // Serialised for the component boundary and for the UTC day key every view
    // buckets by.
    scheduledFor: row.scheduledFor.toISOString(),
    platform: row.platform,
    status: row.status,
    timezone: row.timezone,
    // The variant's override wins, because that is the copy that will actually
    // be posted for this platform.
    title: row.titleOverride ?? row.itemTitle,
    campaignName: row.campaignName,
    accountName: row.username ?? row.displayName,
    avatarUrl: row.avatarUrl,
    href: row.contentVariantId ? `/app/content?variant=${row.contentVariantId}` : null,
  }));

  const filtered = Boolean(query || platformParam || statusParam || campaignParam);
  const rangeLabel = labelFor(view, range.start);
  const stepUnit = CALENDAR_STEP_UNIT[view];

  // Every generated URL carries the filters and nothing else: an unrecognised
  // param the user arrived with is not propagated.
  const carried = new URLSearchParams();
  if (query) carried.set("q", query);
  if (platformParam && VALID_PLATFORMS.has(platformParam)) carried.set("platform", platformParam);
  if (statusParam && VALID_STATUSES.has(statusParam)) carried.set("status", statusParam);
  if (campaignParam && /^[0-9a-f-]{36}$/i.test(campaignParam)) {
    carried.set("campaign", campaignParam);
  }

  const hrefFor = (nextView: CalendarView, nextDate: string): string => {
    const next = new URLSearchParams(carried);
    next.set("view", nextView);
    next.set("date", nextDate);
    return `/app/calendar?${next.toString()}`;
  };

  const dayHref = (isoDate: string): string => hrefFor("day", isoDate);

  // Drops the filters and keeps the place. Built without `carried`, which is the
  // thing being cleared.
  const clearHref = `/app/calendar?view=${view}&date=${isoDay(anchor)}`;

  // Built once and placed by each view, so the sentence a user reads about an
  // empty range does not depend on which view they are in.
  const emptyNote =
    entries.length === 0 ? (
      <EmptyNote
        title={
          filtered
            ? calendarCopy.noMatches.title(rangeLabel)
            : calendarCopy.empty.title(rangeLabel)
        }
        // Omitted when filtered: the title already says what happened, and the
        // link says what to do about it.
        detail={filtered ? undefined : calendarCopy.empty.note}
        actionHref={filtered ? clearHref : "/app/content"}
        actionLabel={filtered ? calendarCopy.clearFilters : calendarCopy.reviewContent}
      />
    ) : null;

  return (
    <AppPage width="full">
      <PageStack>
        <PageHeader
          title={calendarCopy.title}
          description={calendarCopy.body}
          meta={[calendarCopy.count(entries.length), calendarCopy.timezoneNote]}
        />

        <Card>
          {/* Range and view sit above the grid, never over it: a calendar covered
              by its own controls is a calendar you cannot read while filtering. */}
          <CardBody
            pad="tight"
            className="flex flex-wrap items-center gap-[var(--space-2)] border-b border-[var(--border-subtle)]"
          >
            <StepLink
              href={hrefFor(view, isoDay(shift(view, anchor, -1)))}
              label={calendarCopy.previous(stepUnit)}
              direction="previous"
            />

            <h2 className="app-section-title whitespace-nowrap text-[color:var(--text-primary)]">
              {rangeLabel}
            </h2>

            <StepLink
              href={hrefFor(view, isoDay(shift(view, anchor, 1)))}
              label={calendarCopy.next(stepUnit)}
              direction="next"
            />

            <Link
              href={hrefFor(view, todayIso)}
              className={cn(
                "flex h-8 items-center gap-[var(--space-1)] rounded-[var(--radius-control)] px-[var(--space-2)]",
                "text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]",
                "transition-colors duration-[var(--dur-instant)]",
                "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              )}
            >
              <CalendarDays aria-hidden="true" size={14} strokeWidth={1.75} />
              {calendarCopy.today}
            </Link>

            <ViewSwitcher current={view} anchorIso={isoDay(anchor)} hrefFor={hrefFor} />
          </CardBody>

          <CardBody pad="tight" className="border-b border-[var(--border-subtle)]">
            <FilterBar
              searchPlaceholder="Search titles and campaigns"
              filters={[
                { key: "platform", label: "Platform", options: PLATFORM_OPTIONS },
                { key: "status", label: "Status", options: POST_STATUS_OPTIONS },
                {
                  key: "campaign",
                  label: "Campaign",
                  options: campaignOptions.map((option) => ({
                    id: option.id,
                    label: optionLabel(option.label),
                  })),
                },
              ]}
            />
          </CardBody>

          {/* The empty range, stated in a line ABOVE the grid — never in place of
              it. See `EmptyNote`. Month and week take it as a band here; the day
              view carries the same node on its rail, so each view shows it once. */}
          {entries.length === 0 && (view === "month" || view === "week") && (
            // Untinted deliberately: the month grid's weekday header band is
            // already `--surface-secondary`, and two tinted rows stacked behind
            // one hairline read as a single two-line header rather than as a
            // message above a table.
            <CardBody pad="tight" className="border-b border-[var(--border-subtle)]">
              {emptyNote}
            </CardBody>
          )}

          <CardBody pad="none">
            {(view === "month" || view === "week") && (
              <>
                {/* Rendered whether or not anything is scheduled. A dated grid
                    with empty cells is still the thing the user came to read,
                    and every cell is still a link into its day. */}
                <div className="hidden md:block">
                  {view === "month" ? (
                    <MonthGrid
                      monthStartIso={range.start.toISOString()}
                      todayIso={todayIso}
                      entries={entries}
                      dayHref={dayHref}
                      rangeLabel={rangeLabel}
                    />
                  ) : (
                    <WeekGrid
                      weekStartIso={range.start.toISOString()}
                      todayIso={todayIso}
                      entries={entries}
                      dayHref={dayHref}
                      rangeLabel={rangeLabel}
                    />
                  )}
                </div>

                {/* Below `md` the grid is replaced by the agenda, which has no
                    structure to preserve — so an empty range is just the band
                    above, and nothing renders here. */}
                {entries.length > 0 && (
                  <div className="p-[var(--app-panel-pad)] md:hidden">
                    <AgendaList entries={entries} todayIso={todayIso} />
                  </div>
                )}
              </>
            )}

            {view === "day" && (
              <div className="p-[var(--app-panel-pad)]">
                <DayTimeline
                  entries={entries}
                  rangeLabel={rangeLabel}
                  emptyNote={emptyNote}
                />
              </div>
            )}

            {view === "agenda" && (
              <div className="p-[var(--app-panel-pad)]">
                {entries.length > 0 ? (
                  <AgendaList entries={entries} todayIso={todayIso} />
                ) : (
                  /* The one view that may show a compact empty state: a linear
                     list has no dated structure to keep. */
                  <EmptyState
                    bare
                    icon={<CalendarDays size={20} strokeWidth={1.75} />}
                    title={
                      filtered
                        ? calendarCopy.noMatches.title(rangeLabel)
                        : calendarCopy.empty.title(rangeLabel)
                    }
                    body={filtered ? calendarCopy.noMatches.body : calendarCopy.empty.body}
                    actions={
                      filtered ? (
                        <ButtonLink href={clearHref} variant="secondary">
                          {calendarCopy.clearFilters}
                        </ButtonLink>
                      ) : (
                        <ButtonLink href="/app/content">{calendarCopy.reviewContent}</ButtonLink>
                      )
                    }
                  />
                )}
              </div>
            )}
          </CardBody>

          {/* Stated plainly rather than implied by a missing affordance. */}
          <CardFooter>
            <p className="max-w-[80ch] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              {calendarCopy.reschedulingUnavailable}
            </p>
          </CardFooter>
        </Card>
      </PageStack>
    </AppPage>
  );
}

/**
 * "Nothing scheduled here", as one line.
 *
 * A calendar's dated grid IS its value: the user orients by the dates and clicks
 * a day, and both of those still work on an empty month. Replacing the grid with
 * a centred empty state hides the page's primary interface behind a message —
 * the softer version of the problem this redesign exists to fix.
 *
 * So the guidance shrinks to a line and moves out of the grid's way: bold fact,
 * one sentence of cause, one inline link. Two lines at 1280px, three at 390px.
 * The link is a `<Link>` rather than a button because it is inside a sentence,
 * where WCAG 2.2's target-size minimum exempts it and a 36px button would be the
 * loudest thing on an otherwise quiet row.
 */
function EmptyNote({
  title,
  detail,
  actionHref,
  actionLabel,
}: {
  title: string;
  detail?: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-[var(--space-2)] gap-y-1 text-[length:var(--text-app-meta)]">
      <CalendarDays
        aria-hidden="true"
        size={14}
        strokeWidth={1.75}
        className="shrink-0 text-[color:var(--text-muted)]"
      />

      <span className="font-[var(--weight-strong)] text-[color:var(--text-primary)]">{title}</span>

      {detail && <span className="text-[color:var(--text-muted)]">{detail}</span>}

      <Link
        href={actionHref}
        className={cn(
          "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-chip)]",
          "font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        )}
      >
        {actionLabel}
        <ArrowRight aria-hidden="true" size={13} strokeWidth={2} />
      </Link>
    </p>
  );
}

/**
 * The range stepper's two arrows.
 *
 * Icon-only and 32px, so each carries the transparent 44px inset the theme
 * prescribes. They are separated by the range label rather than sitting next to
 * each other, which is also what keeps the two 44px targets from overlapping and
 * stealing clicks from one another.
 */
function StepLink({
  href,
  label,
  direction,
}: {
  href: string;
  label: string;
  direction: "previous" | "next";
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]",
        "border border-[var(--border-default)] bg-[var(--surface-primary)]",
        "text-[color:var(--text-secondary)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:border-[var(--border-strong)] hover:text-[color:var(--text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
      )}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={2} />
    </Link>
  );
}

/**
 * Month / Week / Day / Agenda.
 *
 * Links, not buttons: the view is a location, so it has to survive being copied
 * out of the address bar and it has to be what the back button undoes.
 * `aria-current="page"` reports the selection, and the selected item also gains a
 * surface and a shadow, so it is not signalled by colour alone.
 */
function ViewSwitcher({
  current,
  anchorIso,
  hrefFor,
}: {
  current: CalendarView;
  anchorIso: string;
  hrefFor: (view: CalendarView, date: string) => string;
}) {
  return (
    <nav
      aria-label={calendarCopy.viewSwitcherLabel}
      className={cn(
        "flex w-full items-center gap-0.5 rounded-[var(--radius-control)] p-0.5",
        "bg-[var(--surface-muted)] sm:ml-auto sm:w-auto",
      )}
    >
      {CALENDAR_VIEWS.map((option) => {
        const selected = option.id === current;
        return (
          <Link
            key={option.id}
            href={hrefFor(option.id, anchorIso)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "flex h-7 flex-1 items-center justify-center rounded-[var(--radius-chip)] px-[var(--space-3)]",
              "text-[length:var(--text-app-meta)] whitespace-nowrap sm:flex-none",
              "transition-colors duration-[var(--dur-instant)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              selected
                ? "bg-[var(--surface-primary)] font-[var(--weight-strong)] text-[color:var(--text-primary)] shadow-[var(--elevation-card)]"
                : "text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ==========================================================================
   RANGE MATHS

   All UTC. The query bounds, the day keys the grids bucket by and the times on
   screen are one frame of reference — see `calendarCopy.timezoneNote`.
   ======================================================================== */

/** `YYYY-MM-DD` → the first instant of that UTC day, or null if unparseable. */
function parseDay(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12 || !day || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  // Rejects 31 February, which `Date.UTC` would roll forward into March —
  // silently moving the user to a range they did not ask for.
  return parsed.getUTCMonth() === month - 1 ? parsed : null;
}

/** `YYYY-MM` → the first instant of that month. Kept for pre-existing links. */
function parseMonth(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Monday-first, matching the grids' column order. */
function startOfUtcWeek(date: Date): Date {
  const day = startOfUtcDay(date);
  return addUtcDays(day, -((day.getUTCDay() + 6) % 7));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Half-open, so a post at exactly midnight belongs to one range only. */
function rangeFor(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "week") {
    const start = startOfUtcWeek(anchor);
    return { start, end: addUtcDays(start, 7) };
  }
  if (view === "day") {
    const start = startOfUtcDay(anchor);
    return { start, end: addUtcDays(start, 1) };
  }
  const start = startOfUtcMonth(anchor);
  return { start, end: addUtcMonths(start, 1) };
}

/** The next or previous anchor. Steps by whatever the view shows, never less. */
function shift(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === "week") return addUtcDays(startOfUtcWeek(anchor), 7 * direction);
  if (view === "day") return addUtcDays(startOfUtcDay(anchor), direction);
  // Normalised to the 1st: carrying the day of month over would make 31 January
  // plus one month land in March.
  return addUtcMonths(startOfUtcMonth(anchor), direction);
}

const monthYearFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const fullDayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const monthDayFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function labelFor(view: CalendarView, start: Date): string {
  if (view === "day") return fullDayFormat.format(start);
  if (view === "week") {
    const end = addUtcDays(start, 6);
    // The month is only repeated when the week actually crosses one.
    const tail =
      start.getUTCMonth() === end.getUTCMonth()
        ? String(end.getUTCDate())
        : monthDayFormat.format(end);
    return `${monthDayFormat.format(start)} – ${tail}, ${end.getUTCFullYear()}`;
  }
  return monthYearFormat.format(start);
}
