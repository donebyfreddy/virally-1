import { EntryChip, type CalendarEntry } from "./MonthGrid";
import { calendarCopy } from "@/content/calendar";

/**
 * Agenda view.
 *
 * Also the accessible equivalent of the month grid: a linear, date-grouped list
 * is easier to read with a screen reader than a table of mostly-empty cells, and
 * it is the only usable shape at 390px. Offered as a real view rather than hidden
 * behind a toggle, because plenty of sighted users prefer it too.
 */

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function AgendaList({ entries }: { entries: readonly CalendarEntry[] }) {
  // Grouped by calendar day, preserving the query's time order within each day.
  const groups = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = entry.scheduledFor.slice(0, 10);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  return (
    <div aria-label={calendarCopy.agendaLabel} className="flex flex-col gap-[var(--space-6)]">
      {[...groups.entries()].map(([day, dayEntries]) => (
        <section key={day} aria-labelledby={`agenda-${day}`}>
          <h3
            id={`agenda-${day}`}
            className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]"
          >
            {dayFormatter.format(new Date(`${day}T00:00:00Z`))}
          </h3>

          <ul className="mt-[var(--space-3)] flex flex-col gap-[var(--space-2)]">
            {dayEntries.map((entry) => (
              <li key={entry.id}>
                <EntryChip entry={entry} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
