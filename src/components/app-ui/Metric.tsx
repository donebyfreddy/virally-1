import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type MetricSize = "s" | "md" | "l";

const sizeClasses: Record<MetricSize, string> = {
  s: "text-[length:var(--text-metric-s)]",
  md: "text-[length:var(--text-metric)]",
  l: "text-[length:var(--text-metric-l)]",
};

/**
 * A single figure with its label.
 *
 * Borderless by design — a KPI strip is a row of numbers, and boxing each one
 * turns six facts into six competing cards. Separation comes from the grid gap.
 *
 * `value` is a string, formatted by the caller. Formatting here would need a
 * locale and a unit convention this component has no way to know, and the
 * repo already has `lib/format` for it.
 */
export function Metric({
  label,
  value,
  /** One line saying what populates this figure. Answers "why is this zero?". */
  explains,
  size = "md",
  /** Rendered beside the value: a delta, a unit, a status dot. */
  adornment,
  className,
}: {
  label: string;
  value: string;
  explains?: string;
  size?: MetricSize;
  adornment?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <dt className="app-label truncate">{label}</dt>

      <dd className="mt-1 flex items-baseline gap-[var(--space-2)]">
        {/* Tabular figures so a column of numbers aligns and animated values do
            not jitter as digit widths change. */}
        <span
          className={cn(
            "app-figure font-[var(--weight-heading)] text-[color:var(--text-primary)]",
            sizeClasses[size],
          )}
        >
          {value}
        </span>
        {adornment}
      </dd>

      {explains && (
        <p className="mt-1 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {explains}
        </p>
      )}
    </div>
  );
}

/**
 * The KPI strip: a `<dl>` of Metrics.
 *
 * A definition list rather than divs, because that is what a label/value set
 * is — and it gives assistive technology the pairing for free.
 */
export function MetricRow({
  children,
  /** Columns at the widest breakpoint. Below that it steps down to 2, then 1. */
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-[var(--space-6)] gap-y-[var(--space-5)] sm:grid-cols-2",
        columns === 2 && "lg:grid-cols-2",
        columns === 3 && "lg:grid-cols-3",
        columns === 4 && "lg:grid-cols-4",
        columns === 5 && "lg:grid-cols-5",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/**
 * Change against a previous period.
 *
 * Direction is carried by an arrow glyph as well as colour, and "up" is not
 * assumed to be good: `polarity` says whether an increase is favourable, so a
 * rising cost renders as a regression rather than a win.
 */
export function Delta({
  /** Percentage points, already computed. Sign determines direction. */
  percent,
  polarity = "higher-is-better",
  className,
}: {
  percent: number;
  polarity?: "higher-is-better" | "lower-is-better";
  className?: string;
}) {
  if (percent === 0) {
    return (
      <span
        className={cn(
          "app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]",
          className,
        )}
      >
        <span aria-hidden="true">→</span> 0%
        <span className="sr-only"> — unchanged</span>
      </span>
    );
  }

  const rising = percent > 0;
  const favourable = polarity === "higher-is-better" ? rising : !rising;

  return (
    <span
      className={cn(
        "app-figure text-[length:var(--text-app-label)] font-[var(--weight-strong)]",
        // A regression is stated in muted text rather than in red. Red is reserved
        // for something that failed; a metric being down is information, not an
        // error, and a dashboard of red deltas trains the user to ignore red.
        favourable ? "text-[color:var(--success)]" : "text-[color:var(--text-secondary)]",
        className,
      )}
    >
      <span aria-hidden="true">{rising ? "↑" : "↓"}</span>{" "}
      {Math.abs(percent).toFixed(1)}%
      <span className="sr-only">
        {" "}
        — {rising ? "up" : "down"}, {favourable ? "an improvement" : "a regression"}
      </span>
    </span>
  );
}
