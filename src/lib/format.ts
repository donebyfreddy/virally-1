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
