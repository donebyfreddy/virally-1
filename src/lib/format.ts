export type MetricFormat = "count" | "compact" | "percent" | "duration";

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const countFormatter = new Intl.NumberFormat("en-US");

/**
 * Formats a metric for display. Used by both the static and animated paths of
 * `CountUp`, so an in-flight frame and the settled value can never disagree
 * about separators or rounding.
 */
export function formatMetric(value: number, format: MetricFormat): string {
  switch (format) {
    case "compact":
      return compactFormatter.format(Math.round(value));
    case "percent":
      return `${Math.round(value)}%`;
    case "duration":
      return formatDuration(value);
    case "count":
    default:
      return countFormatter.format(Math.round(value));
  }
}

/** Seconds → `M:SS`. Used for timecodes in the laboratory and output wall. */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

/** Seconds → `HH:MM:SS`, for the hero's elapsed-render readout. */
export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

/** `12` → `"12"`, `3` → `"03"`. Act numbers, variant indices. */
export function padIndex(value: number): string {
  return value.toString().padStart(2, "0");
}

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * A timestamp as human-relative text: "2 hours ago", "yesterday", "3 days ago".
 *
 * Beyond a week it falls back to an absolute date. "37 days ago" is arithmetic
 * the reader has to perform to know when something happened, whereas a date is
 * immediately useful — relative time is only an improvement while the interval
 * is small enough to hold in your head.
 *
 * Computed from the caller's clock, so on the server this is the server's zone.
 * Rendered in a server component it can therefore be off by a few hours for a
 * distant user; that is acceptable for "updated 2 hours ago" and is why
 * anything past a week becomes a plain date.
 */
export function relativeDay(value: Date, now: Date = new Date()): string {
  const diffMs = value.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (Math.abs(diffMinutes) < 1) return "just now";
  if (Math.abs(diffMinutes) < 60) return relativeFormatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMs / 3_600_000);
  if (Math.abs(diffHours) < 24) return relativeFormatter.format(diffHours, "hour");

  const diffDays = Math.round(diffMs / 86_400_000);
  if (Math.abs(diffDays) <= 7) return relativeFormatter.format(diffDays, "day");

  return dayFormatter.format(value);
}
