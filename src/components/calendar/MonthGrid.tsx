import Link from "next/link";
import { cn } from "@/lib/cn";
import { PLATFORM_OPTIONS } from "@/content/create";
import { POST_STATUS_LABELS, calendarCopy } from "@/content/calendar";

/**
 * Month grid.
 *
 * A server component. There is no interaction beyond following a link, so making
 * it a client component would ship the whole month's data twice — once as HTML
 * and once as props — for no behaviour.
 *
 * Built as a real `<table>` with `scope="col"` weekday headers. A calendar month
 * IS a two-dimensional table of dates, and the semantic element gives screen
 * readers row/column association and correct navigation. A div grid would have to
 * reimplement all of that with ARIA and usually gets it wrong.
 */

export type CalendarEntry = {
  id: string;
  /** ISO string — Dates cannot cross the server/client boundary. */
  scheduledFor: string;
  platform: string;
  status: string;
  campaignName: string | null;
  username: string | null;
  href: string | null;
};

/** How many entries a day cell shows before collapsing to a count. */
const PER_DAY_LIMIT = 3;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function MonthGrid({
  /** First instant of the month, in UTC. */
  anchorIso,
  entries,
}: {
  anchorIso: string;
  entries: readonly CalendarEntry[];
}) {
  const anchor = new Date(anchorIso);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  // Monday-first offset. `getUTCDay()` is Sunday-0, so Sunday becomes 6.
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;

  // Bucket by day-of-month once rather than filtering per cell, which would be
  // 31 passes over the list.
  const byDay = new Map<number, CalendarEntry[]>();
  for (const entry of entries) {
    const date = new Date(entry.scheduledFor);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month) continue;
    const day = date.getUTCDate();
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }

  const weeks: (number | null)[][] = [];
  let cursor = 1 - firstWeekday;
  while (cursor <= daysInMonth) {
    const week: (number | null)[] = [];
    for (let index = 0; index < 7; index += 1, cursor += 1) {
      week.push(cursor >= 1 && cursor <= daysInMonth ? cursor : null);
    }
    weeks.push(week);
  }

  const monthName = anchor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="-mx-[var(--app-panel-pad)] overflow-x-auto">
      <table className="w-full min-w-[48rem] border-collapse">
        <caption className="sr-only">{calendarCopy.gridLabel(monthName)}</caption>

        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th
                key={day}
                scope="col"
                className="border-b border-[var(--color-border-hairline)] px-[var(--space-2)] pb-[var(--space-2)] text-left font-utility text-[length:var(--text-utility-xs)] font-medium uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]"
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((day, dayIndex) => {
                const dayEntries = day ? (byDay.get(day) ?? []) : [];
                const overflow = dayEntries.length - PER_DAY_LIMIT;

                return (
                  <td
                    key={dayIndex}
                    className={cn(
                      "h-[7rem] border border-[var(--color-border-hairline)] p-[var(--space-2)] align-top",
                      day === null && "bg-[var(--app-panel-inset)]",
                    )}
                  >
                    {day !== null && (
                      <>
                        <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                          {day}
                        </span>

                        <ul className="mt-[var(--space-1)] flex flex-col gap-[var(--space-1)]">
                          {dayEntries.slice(0, PER_DAY_LIMIT).map((entry) => (
                            <li key={entry.id}>
                              <EntryChip entry={entry} />
                            </li>
                          ))}
                        </ul>

                        {overflow > 0 && (
                          <span className="mt-[var(--space-1)] block font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                            {calendarCopy.moreCount(overflow)}
                          </span>
                        )}
                      </>
                    )}
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

/**
 * One scheduled post in a day cell.
 *
 * Status is carried by a leading glyph as well as a border colour, so a failed
 * post is distinguishable from a scheduled one without relying on hue.
 */
export function EntryChip({ entry }: { entry: CalendarEntry }) {
  const platformLabel =
    PLATFORM_OPTIONS.find((option) => option.id === entry.platform)?.label ?? entry.platform;
  const statusLabel = POST_STATUS_LABELS[entry.status] ?? entry.status;
  const time = timeFormatter.format(new Date(entry.scheduledFor));

  const label = `${time} · ${platformLabel}${entry.username ? ` @${entry.username}` : ""} · ${statusLabel}${entry.campaignName ? ` · ${entry.campaignName}` : ""}`;

  const body = (
    <>
      <span aria-hidden="true" className="shrink-0">
        {statusGlyph(entry.status)}
      </span>
      <span className="min-w-0 truncate">
        {time} {entry.campaignName ?? platformLabel}
      </span>
    </>
  );

  const classes = cn(
    "flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border-l-2 px-[var(--space-1)] py-0.5",
    "font-utility text-[length:var(--text-utility-xs)] tabular-nums",
    "bg-[var(--color-surface-2)]",
    statusBorder(entry.status),
  );

  if (!entry.href) {
    return (
      <span className={classes} title={label}>
        {body}
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <Link
      href={entry.href}
      title={label}
      className={cn(
        classes,
        "transition-colors duration-[var(--dur-instant)] hover:bg-[var(--color-surface-3)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
      )}
    >
      {body}
      <span className="sr-only">{label}</span>
    </Link>
  );
}

function statusBorder(status: string): string {
  switch (status) {
    case "published":
      return "border-l-[var(--color-success)] text-[color:var(--color-text-secondary)]";
    case "publishing":
      return "border-l-[var(--color-signal)] text-[color:var(--color-text-primary)]";
    case "failed":
      return "border-l-[var(--color-error)] text-[color:var(--color-error)]";
    case "cancelled":
      return "border-l-[var(--color-border)] text-[color:var(--color-text-muted)]";
    default:
      return "border-l-[var(--color-action)] text-[color:var(--color-text-primary)]";
  }
}

/** Shape redundancy for status — never colour alone. */
function statusGlyph(status: string): string {
  switch (status) {
    case "published":
      return "✓";
    case "publishing":
      return "◐";
    case "failed":
      return "✕";
    case "cancelled":
      return "–";
    default:
      return "◦";
  }
}
