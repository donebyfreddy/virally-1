import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EntryCard, type CalendarEntry } from "./MonthGrid";
import { calendarCopy } from "@/content/calendar";

/**
 * The two linear views: agenda over the loaded range, and one day on a time rail.
 *
 * The agenda is also what the month and week grids fall back to below `md`. Seven
 * columns on a 390px viewport is not a tight grid, it is an unreadable one, and a
 * date-grouped list is both the usable shape at that width and the easier one to
 * read with a screen reader.
 */

const dayHeadingFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Groups by UTC day, keeping the query's time order inside each group. */
function groupByDay(entries: readonly CalendarEntry[]): [string, CalendarEntry[]][] {
  const groups = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = entry.scheduledFor.slice(0, 10);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()];
}

export function AgendaList({
  entries,
  /** `YYYY-MM-DD` for today, so the current day is marked here too. */
  todayIso,
}: {
  entries: readonly CalendarEntry[];
  todayIso: string;
}) {
  const groups = groupByDay(entries);

  return (
    // A named `<section>` rather than an `aria-label` on a bare div: a div has no
    // role, so the label was silently doing nothing on the previous version.
    <section
      aria-label={calendarCopy.agendaLabel}
      className="flex flex-col gap-[var(--space-5)]"
    >
      {groups.map(([day, dayEntries]) => (
        <div key={day}>
          <h3 className="app-card-title flex items-center gap-[var(--space-2)] text-[color:var(--text-primary)]">
            {dayHeadingFormatter.format(new Date(`${day}T00:00:00Z`))}
            {day === todayIso && (
              <span
                className={cn(
                  "rounded-[var(--radius-chip)] bg-[var(--brand-soft)] px-1.5 py-0.5",
                  "text-[length:var(--text-app-label-xs)] font-[var(--weight-strong)]",
                  "text-[color:var(--brand-ink)]",
                )}
              >
                {calendarCopy.today}
              </span>
            )}
          </h3>

          <ul className="mt-[var(--space-2)] flex flex-col gap-[var(--space-2)]">
            {dayEntries.map((entry) => (
              <li key={entry.id}>
                <EntryCard entry={entry} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * One day, on a time rail.
 *
 * Only the times that have something in them. Twenty-four hour rows would be a
 * mostly-empty column pushing the three slots that matter below the fold, and a
 * publishing day is a handful of slots rather than a spread of continuous work.
 * Posts sharing a minute stack under one time, which is the common case when a
 * plan fans one variant out across several accounts.
 *
 * The rail sits beside the posts from `sm` up and above them below it, where 56px
 * of fixed gutter is a tenth of the viewport.
 */
export function DayTimeline({
  entries,
  /** The day itself, already formatted, for the section's accessible name. */
  rangeLabel,
  /**
   * The slim "nothing scheduled" line, rendered on the rail when the day is
   * empty.
   *
   * The day view keeps its shape either way: an empty day renders the same
   * two-column rail with an em-dash where a time would be, so the view the user
   * navigated to is still the view they see. It is passed in rather than built
   * here so the page owns the copy and the link, and it is rendered here rather
   * than above the section so the rail's gutter width lives in one file — a
   * second `sm:w-16` in the page is exactly how two columns drift apart.
   *
   * No hours are invented for the empty case. A rail of 24 fabricated slots
   * would be structure the data does not have.
   */
  emptyNote,
}: {
  entries: readonly CalendarEntry[];
  rangeLabel: string;
  emptyNote?: ReactNode;
}) {
  const slots = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = timeFormatter.format(new Date(entry.scheduledFor));
    const list = slots.get(key);
    if (list) list.push(entry);
    else slots.set(key, [entry]);
  }

  if (slots.size === 0) {
    return (
      <section
        aria-label={calendarCopy.dayLabel(rangeLabel)}
        // The same `min-h` a week-grid column reserves, so an empty day still
        // occupies the day's space instead of collapsing the card to a caption.
        // Shorter below `sm`, where 224px of reserved space is a third of the
        // viewport.
        className="flex min-h-[9rem] flex-col gap-[var(--space-2)] sm:min-h-[14rem] sm:flex-row sm:gap-[var(--space-4)]"
      >
        <p
          aria-hidden="true"
          className="app-figure shrink-0 text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)] sm:w-16 sm:pt-1.5"
        >
          —
        </p>
        <div className="min-w-0 flex-1 sm:pt-1.5">{emptyNote}</div>
      </section>
    );
  }

  return (
    <section aria-label={calendarCopy.dayLabel(rangeLabel)}>
      <ol className="flex flex-col">
        {[...slots.entries()].map(([time, slotEntries], index) => (
          <li
            key={time}
            className={cn(
              "flex flex-col gap-[var(--space-2)] pb-[var(--space-3)] sm:flex-row sm:gap-[var(--space-4)]",
              // Padding declared per side rather than `py-*` plus `pt-0`, which
              // is two utilities competing for one declaration.
              index > 0 && "border-t border-[var(--border-subtle)] pt-[var(--space-3)]",
            )}
          >
            <p className="app-figure shrink-0 text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-secondary)] sm:w-16 sm:pt-1.5">
              {time}
            </p>

            <ul className="flex min-w-0 flex-1 flex-col gap-[var(--space-2)]">
              {slotEntries.map((entry) => (
                <li key={entry.id}>
                  <EntryCard entry={entry} showTime={false} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
