/**
 * Calendar copy and option sets.
 */

/**
 * The views that exist.
 *
 * Month and agenda only. A week grid is a month grid with seven columns and a day
 * view is the agenda filtered to one date — shipping those as separate surfaces
 * would add layouts to maintain without adding capability. The agenda also serves
 * as the accessible equivalent of the grid.
 */
export const CALENDAR_VIEWS: readonly { id: string; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "agenda", label: "Agenda" },
];

/** `scheduled_posts.status` values. */
export const POST_STATUS_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "scheduled", label: "Scheduled" },
  { id: "publishing", label: "Publishing" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

export const POST_STATUS_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  POST_STATUS_OPTIONS.map((option) => [option.id, option.label]),
);

export const calendarCopy = {
  eyebrow: "CALENDAR",
  title: "What publishes, where, and when.",
  body: "Every scheduled and published post across connected accounts. Times are shown in each post's own timezone, which is the account's, not yours.",

  empty: {
    title: "Nothing is scheduled this month.",
    body: "Approved content variants get a publish time and a destination account at the schedule stage of a campaign. Until then they wait in Content.",
  },

  noMatches: {
    title: "No posts match those filters this month.",
    body: "Nothing scheduled in this month matches the current combination. Clearing the filters will show the whole month again.",
  },

  /**
   * Stated rather than left as a missing affordance.
   *
   * Rescheduling writes to the publishing pipeline. A drag that appears to move a
   * post but does not persist is worse than no drag at all, so the grid is
   * read-and-navigate until that write path exists — at which point the keyboard
   * equivalent ships in the same change, not after it.
   */
  reschedulingUnavailable:
    "Drag-to-reschedule is not enabled. Moving a post rewrites its publishing job, and that write path is part of the publishing phase — a drag that looked like it worked without persisting would be worse than none. When it ships it will arrive with its keyboard equivalent in the same change.",

  gridLabel: (month: string) => `Scheduled posts for ${month}`,
  agendaLabel: "Scheduled posts, in time order",
  moreCount: (count: number) => `+${count} more`,
} as const;
