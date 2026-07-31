import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  CheckCheck,
  CircleDashed,
  Clock,
  Hourglass,
  Send,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { PLATFORM_OPTIONS } from "@/content/create";
import { POST_STATUS_LABELS, calendarCopy } from "@/content/calendar";

/**
 * The calendar's grids and the shared vocabulary every view draws a post with.
 *
 * All server components. There is no interaction here beyond following a link,
 * so a client boundary would ship the whole range's data twice — once as HTML,
 * once as props — for no behaviour.
 *
 * Both grids are real `<table>`s with `scope="col"` headers. A calendar is a
 * two-dimensional table of dates, and the element gives screen readers row and
 * column association for free; a div grid has to reimplement that with ARIA and
 * usually gets it wrong.
 *
 * The status vocabulary and the two post renderers live here rather than in a
 * fourth file because every view has to draw a post identically — a month chip
 * and an agenda card differing in which colour means "failed" is the specific
 * inconsistency that makes a calendar untrustworthy.
 */

export type CalendarEntry = {
  id: string;
  /** ISO string — Dates cannot cross the server/client boundary. */
  scheduledFor: string;
  platform: string;
  status: string;
  /** The destination account's own zone. Named on the post when it is not UTC. */
  timezone: string;
  /** Variant title override, else the content item's title. */
  title: string | null;
  campaignName: string | null;
  /** `@username`, else the account's display name. */
  accountName: string | null;
  avatarUrl: string | null;
  href: string | null;
};

/** How many posts a month cell shows before collapsing the rest into a count. */
const PER_DAY_LIMIT = 3;

const WEEKDAYS = [
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
  { short: "Sun", long: "Sunday" },
] as const;

/**
 * Everything here is UTC, matching the query bounds the page uses.
 *
 * A grid has to pick one frame of reference to decide which cell a post sits in.
 * See `calendarCopy.timezoneNote` for why that frame is UTC rather than each
 * post's own zone.
 */
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

const fullDayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/* ==========================================================================
   STATUS VOCABULARY
   ======================================================================== */

/**
 * Each status is drawn as an icon plus a colour, never a colour alone.
 *
 * `rule` is the chip's leading bar and takes the 3:1 `-mark` token, which is
 * what those tokens are for. `text` and `chip` carry words, so they take the
 * 4.5:1 ink of the same pair — a 3:1 stroke colour used as an 11px label is
 * exactly the substitution the pairing exists to prevent.
 *
 * The rule is a filled element rather than a `border-l` on the chip: the chip
 * already carries a hairline on all four sides, and `border` plus `border-l-2`
 * plus two border colours is three utilities competing for the same declaration.
 */
const TONES = {
  neutral: {
    text: "text-[color:var(--text-secondary)]",
    rule: "bg-[var(--text-muted)]",
    chip: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  brand: {
    text: "text-[color:var(--brand-primary)]",
    rule: "bg-[var(--brand-mark)]",
    chip: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]",
  },
  info: {
    text: "text-[color:var(--info)]",
    rule: "bg-[var(--info-mark)]",
    chip: "bg-[var(--info-soft)] text-[color:var(--info)]",
  },
  warning: {
    text: "text-[color:var(--warning)]",
    rule: "bg-[var(--warning-mark)]",
    chip: "bg-[var(--warning-soft)] text-[color:var(--warning)]",
  },
  success: {
    text: "text-[color:var(--success)]",
    rule: "bg-[var(--success-mark)]",
    chip: "bg-[var(--success-soft)] text-[color:var(--success)]",
  },
  error: {
    text: "text-[color:var(--error)]",
    rule: "bg-[var(--error-mark)]",
    chip: "bg-[var(--error-soft)] text-[color:var(--error)]",
  },
} satisfies Record<string, { text: string; rule: string; chip: string }>;

/**
 * Teal for the states where the machine is genuinely working or committed,
 * amber for the one that needs a person, green only once it is actually out.
 * `draft` and `cancelled` are neutral: nothing is pending on them.
 */
const STATUS_CONFIG: Readonly<Record<string, { tone: keyof typeof TONES; icon: LucideIcon }>> = {
  draft: { tone: "neutral", icon: CircleDashed },
  awaiting_review: { tone: "warning", icon: Clock },
  approved: { tone: "info", icon: Check },
  scheduled: { tone: "brand", icon: CalendarClock },
  queued: { tone: "brand", icon: Hourglass },
  uploading: { tone: "brand", icon: Upload },
  publishing: { tone: "brand", icon: Send },
  published: { tone: "success", icon: CheckCheck },
  failed: { tone: "error", icon: AlertTriangle },
  cancelled: { tone: "neutral", icon: Ban },
};

function statusStyle(status: string) {
  // A status added to the enum without being added here renders neutral with its
  // raw value rather than throwing on a page whose job is to report state.
  const config = STATUS_CONFIG[status] ?? { tone: "neutral" as const, icon: CircleDashed };
  return { ...TONES[config.tone], icon: config.icon };
}

function platformLabel(platform: string): string {
  return PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
}

function statusLabel(status: string): string {
  return POST_STATUS_LABELS[status] ?? status;
}

/** Everything known about a post, in one string, for assistive technology. */
function entryLabel(entry: CalendarEntry): string {
  const date = new Date(entry.scheduledFor);
  return [
    `${fullDayFormatter.format(date)}, ${timeFormatter.format(date)}`,
    platformLabel(entry.platform),
    entry.accountName ? `@${entry.accountName}` : null,
    entry.title,
    entry.campaignName,
    statusLabel(entry.status),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What a post is called on screen.
 *
 * Campaign first. `content_items.title` is `not null default 'Untitled'`, so a
 * title exists whether or not anyone wrote one, and a month cell reading
 * "Untitled" three times tells the planner less than the campaign that produced
 * those posts. The title is still shown next to it wherever there is room.
 */
function entryPrimary(entry: CalendarEntry): string {
  return entry.campaignName ?? entry.title ?? platformLabel(entry.platform);
}

/** `YYYY-MM-DD` in UTC — the key every view buckets by. */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function bucketByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  // One pass. Filtering per cell would be 42 passes over the month.
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.scheduledFor);
    const list = byDay.get(key);
    if (list) list.push(entry);
    else byDay.set(key, [entry]);
  }
  return byDay;
}

function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* ==========================================================================
   MONTH
   ======================================================================== */

type DayCell = { iso: string; day: number; inMonth: boolean };

export function MonthGrid({
  /** First instant of the month, in UTC. */
  monthStartIso,
  /** `YYYY-MM-DD` for today, passed in so the grid stays a pure function. */
  todayIso,
  entries,
  /** `YYYY-MM-DD` → the day view's URL, with the page's filters preserved. */
  dayHref,
  rangeLabel,
}: {
  monthStartIso: string;
  todayIso: string;
  entries: readonly CalendarEntry[];
  dayHref: (isoDate: string) => string;
  rangeLabel: string;
}) {
  const monthStart = new Date(monthStartIso);
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();

  // Day 0 of the next month is the last day of this one.
  const daysInMonth = utcDay(year, month + 1, 0).getUTCDate();
  // Monday-first. `getUTCDay()` is Sunday-0, so Sunday becomes 6.
  const leading = (utcDay(year, month, 1).getUTCDay() + 6) % 7;

  const cells: DayCell[] = [];
  for (let index = 0; index < Math.ceil((leading + daysInMonth) / 7) * 7; index += 1) {
    const date = utcDay(year, month, index - leading + 1);
    cells.push({
      iso: isoDay(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
    });
  }

  const weeks: DayCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));

  const byDay = bucketByDay(entries);

  return (
    <div className="overflow-x-auto">
      {/* 704px keeps every column above 100px, which is the width at which an
          11px chip stops being able to show a time and a word. Below `md` the
          page renders the agenda instead of shrinking past this. */}
      <table className="w-full min-w-[44rem] table-fixed border-collapse">
        <caption className="sr-only">{calendarCopy.monthLabel(rangeLabel)}</caption>

        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th
                key={weekday.short}
                scope="col"
                className={cn(
                  "app-label border-b border-r border-[var(--border-subtle)] last:border-r-0",
                  "bg-[var(--surface-secondary)] px-[var(--space-2)] py-[var(--space-2)] text-left",
                )}
              >
                <span aria-hidden="true">{weekday.short}</span>
                <span className="sr-only">{weekday.long}</span>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={week[0]?.iso ?? weekIndex}>
              {week.map((cell) => {
                const dayEntries = byDay.get(cell.iso) ?? [];
                const shown = dayEntries.slice(0, PER_DAY_LIMIT);
                const hidden = dayEntries.length - shown.length;
                const isToday = cell.iso === todayIso;

                return (
                  <td
                    key={cell.iso}
                    aria-current={isToday ? "date" : undefined}
                    className={cn(
                      "h-[7.5rem] border-r border-[var(--border-subtle)] last:border-r-0",
                      "p-[var(--space-2)] align-top",
                      // The final row's rule would double with the card footer's.
                      weekIndex < weeks.length - 1 && "border-b",
                      isToday
                        ? "bg-[var(--brand-soft)]"
                        : cell.inMonth
                          ? "bg-[var(--surface-primary)]"
                          : "bg-[var(--surface-secondary)]",
                    )}
                  >
                    <DateBadge cell={cell} isToday={isToday} dayHref={dayHref} />

                    {shown.length > 0 && (
                      <ul className="mt-[var(--space-1)] flex flex-col gap-[var(--space-1)]">
                        {shown.map((entry) => (
                          <li key={entry.id}>
                            <EntryChip entry={entry} />
                          </li>
                        ))}
                      </ul>
                    )}

                    {hidden > 0 && <MoreLink count={hidden} cell={cell} dayHref={dayHref} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ==========================================================================
   WEEK
   ======================================================================== */

/**
 * Week.
 *
 * Seven columns, one row, and no per-day cap — which is the whole reason it is a
 * separate view rather than a re-skin of the month. Each column has unlimited
 * vertical room, so a post can afford a second line naming its platform and
 * destination account instead of truncating to a time.
 *
 * Not an hour grid. Hour rows are only worth their height when work is spread
 * across the day; a publishing schedule clusters into a handful of slots, so
 * twenty-four rows would be twenty mostly-empty ones pushing the occupied slots
 * off screen.
 */
export function WeekGrid({
  /** First instant of the week (Monday), in UTC. */
  weekStartIso,
  todayIso,
  entries,
  dayHref,
  rangeLabel,
}: {
  weekStartIso: string;
  todayIso: string;
  entries: readonly CalendarEntry[];
  dayHref: (isoDate: string) => string;
  rangeLabel: string;
}) {
  const weekStart = new Date(weekStartIso);
  const days = WEEKDAYS.map((weekday, index) => {
    const date = utcDay(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + index);
    return { weekday, iso: isoDay(date), day: date.getUTCDate() };
  });

  const byDay = bucketByDay(entries);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] table-fixed border-collapse">
        <caption className="sr-only">{calendarCopy.weekLabel(rangeLabel)}</caption>

        <thead>
          <tr>
            {days.map((day) => {
              const isToday = day.iso === todayIso;
              return (
                <th
                  key={day.iso}
                  scope="col"
                  aria-current={isToday ? "date" : undefined}
                  // The header band stays `--surface-secondary` even for today.
                  // `app-label` is `--text-muted`, which measures 4.49:1 on
                  // `--brand-soft` — two hundredths under the text floor. The
                  // wash goes on the column body below, where nothing in it is
                  // muted; today is still named and its date still reverses out
                  // of a solid fill.
                  className={cn(
                    "border-b border-r border-[var(--border-subtle)] last:border-r-0",
                    "bg-[var(--surface-secondary)] px-[var(--space-2)] py-[var(--space-2)] text-left align-top",
                  )}
                >
                  <span className="app-label block">
                    <span aria-hidden="true">{day.weekday.short}</span>
                    <span className="sr-only">{day.weekday.long}</span>
                  </span>
                  <DateBadge
                    cell={{ iso: day.iso, day: day.day, inMonth: true }}
                    isToday={isToday}
                    dayHref={dayHref}
                    className="mt-[var(--space-1)]"
                  />
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          <tr>
            {days.map((day) => {
              const dayEntries = byDay.get(day.iso) ?? [];
              const isToday = day.iso === todayIso;

              return (
                <td
                  key={day.iso}
                  className={cn(
                    "border-r border-[var(--border-subtle)] last:border-r-0",
                    "p-[var(--space-2)] align-top",
                    isToday ? "bg-[var(--brand-soft)]" : "bg-[var(--surface-primary)]",
                  )}
                >
                  <ul className="flex min-h-[14rem] flex-col gap-[var(--space-1)]">
                    {dayEntries.map((entry) => (
                      <li key={entry.id}>
                        <EntryChip entry={entry} stacked />
                      </li>
                    ))}
                  </ul>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ==========================================================================
   CELL FURNITURE
   ======================================================================== */

/**
 * A cell's date, and the way into the day view.
 *
 * 24x24 rather than the 44px hit target the icon-only controls in this app
 * carry. It is a text control, and the theme's own note explains why the
 * `after:` overhang is not applied to those: in a grid it would reach into the
 * neighbouring cell and steal clicks from the post chips stacked under it.
 * 24x24 clears WCAG 2.2 SC 2.5.8 (Minimum) on its own.
 */
function DateBadge({
  cell,
  isToday,
  dayHref,
  className,
}: {
  cell: DayCell;
  isToday: boolean;
  dayHref: (isoDate: string) => string;
  className?: string;
}) {
  const fullDay = fullDayFormatter.format(new Date(`${cell.iso}T00:00:00Z`));

  return (
    <span className={cn("flex items-center gap-[var(--space-1)]", className)}>
      <Link
        href={dayHref(cell.iso)}
        aria-label={calendarCopy.openDay(fullDay)}
        className={cn(
          "app-figure inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--radius-chip)] px-1",
          "text-[length:var(--text-app-label)] font-[var(--weight-strong)]",
          "transition-colors duration-[var(--dur-instant)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          isToday
            ? "bg-[var(--brand-primary)] text-[color:var(--text-on-brand)]"
            : cn(
                "hover:bg-[var(--surface-muted)]",
                cell.inMonth
                  ? "text-[color:var(--text-primary)]"
                  : "text-[color:var(--text-muted)]",
              ),
        )}
      >
        {cell.day}
      </Link>

      {/* Today is not signalled by the wash alone: the date reverses out of a
          solid fill AND the word is there to read. */}
      {isToday && (
        <span className="text-[length:var(--text-app-label-xs)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]">
          {calendarCopy.today}
        </span>
      )}
    </span>
  );
}

/** The overflow count. Never a silent truncation — and it goes somewhere. */
function MoreLink({
  count,
  cell,
  dayHref,
}: {
  count: number;
  cell: DayCell;
  dayHref: (isoDate: string) => string;
}) {
  const fullDay = fullDayFormatter.format(new Date(`${cell.iso}T00:00:00Z`));

  return (
    <Link
      href={dayHref(cell.iso)}
      className={cn(
        "app-figure mt-[var(--space-1)] inline-block rounded-[var(--radius-chip)] px-1 py-0.5",
        "text-[length:var(--text-app-label-xs)] font-[var(--weight-strong)]",
        "text-[color:var(--brand-ink)] hover:bg-[var(--surface-muted)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
      )}
    >
      <span aria-hidden="true">{calendarCopy.moreCount(count)}</span>
      <span className="sr-only">{calendarCopy.moreLabel(count, fullDay)}</span>
    </Link>
  );
}

/* ==========================================================================
   POST RENDERERS
   ======================================================================== */

/**
 * One post in a grid cell.
 *
 * White on the cell rather than tinted, because today's cell is already washed
 * `--brand-soft` and a soft-tinted chip would vanish into it. The status is
 * carried by the leading rule (a `-mark` token) and the icon (a shape), so it
 * survives greyscale.
 *
 * The visible line is deliberately `aria-hidden` with one complete `sr-only`
 * label beside it: the compact form omits the platform and the status to fit,
 * and reading the time twice is worse than reading it once with everything else.
 */
export function EntryChip({
  entry,
  /** Two lines: adds the platform and destination account. For the week view. */
  stacked = false,
}: {
  entry: CalendarEntry;
  stacked?: boolean;
}) {
  const style = statusStyle(entry.status);
  const StatusIcon = style.icon;
  const label = entryLabel(entry);
  const time = timeFormatter.format(new Date(entry.scheduledFor));
  const primary = entryPrimary(entry);

  const classes = cn(
    "flex items-stretch gap-[var(--space-1)] rounded-[var(--radius-chip)]",
    "border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-[var(--space-1)]",
  );

  const body = (
    <>
      <span aria-hidden="true" className={cn("w-0.5 shrink-0 rounded-[var(--radius-full)]", style.rule)} />

      <span
        aria-hidden="true"
        className={cn(
          "flex min-w-0 flex-1 gap-[var(--space-1)]",
          stacked ? "flex-col" : "items-baseline",
        )}
      >
        <span className="flex shrink-0 items-center gap-[var(--space-1)]">
          <StatusIcon size={11} strokeWidth={2.25} className={cn("shrink-0", style.text)} />
          <span className="app-figure text-[length:var(--text-app-label-xs)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]">
            {time}
          </span>
        </span>

        <span className="min-w-0 truncate text-[length:var(--text-app-label-xs)] text-[color:var(--text-primary)]">
          {primary}
        </span>

        {stacked && (
          <span className="min-w-0 truncate text-[length:var(--text-app-label-xs)] text-[color:var(--text-muted)]">
            {platformLabel(entry.platform)}
            {entry.accountName ? ` · @${entry.accountName}` : ""}
          </span>
        )}
      </span>

      <span className="sr-only">{label}</span>
    </>
  );

  if (!entry.href) {
    return (
      <span className={classes} title={label}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={entry.href}
      title={label}
      className={cn(
        classes,
        "transition-colors duration-[var(--dur-instant)] hover:bg-[var(--surface-secondary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
      )}
    >
      {body}
    </Link>
  );
}

/**
 * One post as a row, for the agenda and day views.
 *
 * Everything material is visible here, so there is no `sr-only` duplicate: the
 * time, the title, the platform, the account and the status all read as text.
 */
export function EntryCard({
  entry,
  /** Off in the day view, where the time rail on the left already states it. */
  showTime = true,
}: {
  entry: CalendarEntry;
  showTime?: boolean;
}) {
  const style = statusStyle(entry.status);
  const StatusIcon = style.icon;
  const time = timeFormatter.format(new Date(entry.scheduledFor));
  const primary = entryPrimary(entry);

  const meta = [
    platformLabel(entry.platform),
    entry.accountName ? `@${entry.accountName}` : null,
    // Only when the campaign already took the line above, so the title is not
    // printed twice for a post with no campaign.
    entry.campaignName && entry.title ? entry.title : null,
    // Placement and the time are both UTC, so an account on another zone needs
    // its own zone named or the time is ambiguous rather than wrong.
    entry.timezone && entry.timezone !== "UTC" ? entry.timezone : null,
  ].filter(Boolean);

  const inner = (
    <>
      {showTime && (
        <time
          dateTime={entry.scheduledFor}
          className="app-figure w-14 shrink-0 text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]"
        >
          {time}
        </time>
      )}

      <AccountThumb entry={entry} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
          {primary}
        </span>
        <span className="block truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {meta.join(" · ")}
        </span>
      </span>

      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] px-2 py-1",
          "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
          style.chip,
        )}
      >
        <StatusIcon aria-hidden="true" size={12} strokeWidth={2.25} className="shrink-0" />
        {statusLabel(entry.status)}
      </span>
    </>
  );

  const classes = cn(
    "flex items-center gap-[var(--space-3)] rounded-[var(--radius-control)]",
    "border border-[var(--border-subtle)] bg-[var(--surface-secondary)]",
    "px-[var(--space-3)] py-[var(--space-2)]",
  );

  if (!entry.href) return <div className={classes}>{inner}</div>;

  return (
    <Link
      href={entry.href}
      className={cn(
        classes,
        "transition-colors duration-[var(--dur-instant)] hover:bg-[var(--surface-muted)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
      )}
    >
      {inner}
    </Link>
  );
}

/**
 * The destination account, as its avatar.
 *
 * This is the account's picture, not a still from the post: a content thumbnail
 * would need a signed URL per asset from the storage adapter, and that read path
 * does not exist yet. Hidden below `sm`, where the 40px it costs is better spent
 * on the title.
 */
function AccountThumb({ entry }: { entry: CalendarEntry }) {
  const fallback = (entry.accountName ?? platformLabel(entry.platform)).charAt(0).toUpperCase();

  if (entry.avatarUrl) {
    return (
      // Platform avatar URLs are arbitrary remote hosts, so next/image cannot
      // optimise them without a per-tenant remote-pattern allowlist. At 28px
      // what matters is the lazy load and the fixed intrinsic box.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={entry.avatarUrl}
        alt=""
        loading="lazy"
        decoding="async"
        width={28}
        height={28}
        className="hidden size-7 shrink-0 rounded-[var(--radius-full)] border border-[var(--border-subtle)] object-cover sm:block"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "hidden size-7 shrink-0 items-center justify-center rounded-[var(--radius-full)]",
        "bg-[var(--surface-muted)] text-[length:var(--text-app-label)]",
        "font-[var(--weight-heading)] text-[color:var(--text-muted)] sm:flex",
      )}
    >
      {fallback}
    </span>
  );
}
