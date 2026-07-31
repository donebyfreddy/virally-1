import type { PublishStatus } from "@/types/database";

/**
 * Calendar copy and option sets.
 */

/**
 * The four views, in the order the switcher renders them.
 *
 * Month, week and day are one query at three ranges, so each is a real view
 * rather than a re-skin: the range the page loads changes with the view, and the
 * grid it draws changes with it. Agenda is the linear form of the loaded range —
 * it is also what the grid falls back to below `md`, where seven columns stop
 * being tight and start being unreadable.
 */
export const CALENDAR_VIEWS = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
  { id: "agenda", label: "Agenda" },
] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number]["id"];

/**
 * The unit each view steps by.
 *
 * Agenda loads a month, so its stepper moves a month — a "next" button that
 * moved by a different amount than the range on screen would be a trap.
 */
export const CALENDAR_STEP_UNIT: Readonly<Record<CalendarView, "month" | "week" | "day">> = {
  month: "month",
  week: "week",
  day: "day",
  agenda: "month",
};

/**
 * Every value of the `publish_status` enum.
 *
 * All ten, not the six the first version listed. A post sitting in `queued` or
 * `uploading` was unfilterable and rendered with its raw enum value as its
 * label, which is the specific failure of maintaining a copy of an enum by hand.
 */
export const POST_STATUS_OPTIONS: readonly { id: PublishStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "awaiting_review", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "scheduled", label: "Scheduled" },
  { id: "queued", label: "Queued" },
  { id: "uploading", label: "Uploading" },
  { id: "publishing", label: "Publishing" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

export const POST_STATUS_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  POST_STATUS_OPTIONS.map((option) => [option.id, option.label]),
);

export const calendarCopy = {
  // A page title, not a statement — the same correction the campaigns page made.
  title: "Calendar",
  body: "Every scheduled and published post across connected accounts.",

  /**
   * Placement and display are both UTC, deliberately and visibly.
   *
   * A post carries its own account timezone (`scheduled_posts.timezone`), but a
   * grid needs one frame of reference to decide which cell a post belongs in:
   * 9am in Tokyo and 9am in New York are different days. Mixing per-post zones
   * would put a post in a cell whose date its own label contradicts. So the
   * whole surface reads in UTC, the header says so, and a post whose account
   * zone differs names that zone on the post itself.
   */
  timezoneNote: "Times in UTC",

  count: (value: number) => (value === 1 ? "1 scheduled post" : `${value} scheduled posts`),

  empty: {
    title: (range: string) => `Nothing is scheduled in ${range}`,
    body: "Approved content gets a publish time and a destination account at the schedule stage of a campaign. Until then it waits in Content.",
  },

  noMatches: {
    title: (range: string) => `No posts in ${range} match those filters`,
    body: "Nothing in this range matches the current combination.",
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

  monthLabel: (range: string) => `Scheduled posts for ${range}`,
  weekLabel: (range: string) => `Scheduled posts for the week of ${range}`,
  agendaLabel: "Scheduled posts, in time order",
  dayLabel: (range: string) => `Scheduled posts on ${range}`,

  viewSwitcherLabel: "Calendar view",
  previous: (unit: string) => `Previous ${unit}`,
  next: (unit: string) => `Next ${unit}`,
  today: "Today",

  moreCount: (count: number) => `+${count} more`,
  /** The link's accessible name, since "+2 more" alone says nothing about where. */
  moreLabel: (count: number, day: string) =>
    `Show all ${count} more scheduled ${count === 1 ? "post" : "posts"} on ${day}`,
  /** A date cell's accessible name — the number alone reads as "3" out of context. */
  openDay: (day: string) => `Open ${day}`,
} as const;
