import { cn } from "@/lib/cn";

/**
 * Horizontal category bars — platform comparison, format matrix, cost by
 * campaign.
 *
 * Horizontal rather than vertical because the categories are words ("Instagram",
 * "YouTube"), and vertical bars force those labels to rotate or truncate.
 *
 * A server component: there is nothing to hover that the row does not already
 * show. The value is printed at the end of every bar, so the tooltip a vertical
 * bar chart would need is redundant here.
 *
 * Rendered as a real `<dl>` with the bar as decoration, not as an SVG with a
 * table beside it. At this complexity the markup IS the accessible version,
 * which is strictly better than a drawing plus a duplicate.
 */

export type CategoryDatum = {
  id: string;
  label: string;
  value: number;
  /** Optional second line — a share, a delta, a count. */
  detail?: string;
};

export function CategoryBars({
  data,
  formatValue,
  /**
   * Bars are drawn as a share of this. Defaults to the largest value, which
   * makes the biggest bar full-width; pass a total to show absolute share
   * instead.
   */
  max,
  /** Signal teal when the measure is machine activity rather than performance. */
  tone = "neutral",
  className,
}: {
  data: readonly CategoryDatum[];
  formatValue: (value: number) => string;
  max?: number;
  tone?: "neutral" | "signal";
  className?: string;
}) {
  const ceiling = max ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <dl className={cn("flex flex-col gap-[var(--space-3)]", className)}>
      {data.map((datum) => {
        const share = ceiling > 0 ? Math.max(0, Math.min(1, datum.value / ceiling)) : 0;
        return (
          <div key={datum.id} className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-[var(--space-3)]">
            <dt className="min-w-0 truncate text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
              {datum.label}
            </dt>

            {/* The track gives the bar a context of "out of what". Without it a
                short bar is ambiguous between a small value and a narrow chart. */}
            <div
              aria-hidden="true"
              className="h-2 min-w-0 overflow-hidden rounded-[var(--radius-full)] bg-[var(--chart-track)]"
            >
              <div
                className={cn(
                  "h-full rounded-[var(--radius-sm)]",
                  tone === "signal" ? "bg-[var(--color-signal)]" : "bg-[var(--color-chart-1)]",
                )}
                style={{ width: `${(share * 100).toFixed(2)}%` }}
              />
            </div>

            <dd className="shrink-0 text-right">
              <span className="app-figure block text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                {formatValue(datum.value)}
              </span>
              {datum.detail && (
                <span className="app-figure block text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                  {datum.detail}
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * A bare trend line for a KPI tile.
 *
 * The one chart form that legitimately skips a hover layer and a table: it
 * carries no axis, no labels and no readable values — it is a shape indicating
 * direction beside a number that is already stated exactly. Adding a tooltip to
 * a 48px sparkline would be a hit target smaller than the pointer.
 *
 * `aria-hidden` for that reason. The KPI's value and its delta are the
 * accessible content.
 */
export function Sparkline({
  values,
  /** Renders in success green when the trend is favourable. */
  favourable,
  className,
}: {
  values: readonly number[];
  favourable?: boolean;
  className?: string;
}) {
  if (values.length < 2) return null;

  const width = 96;
  const height = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      role="presentation"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-6 w-24 overflow-visible", className)}
    >
      <path
        d={path}
        fill="none"
        stroke={
          favourable === undefined
            ? "var(--text-muted)"
            : favourable
              ? "var(--color-success)"
              : "var(--text-secondary)"
        }
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
