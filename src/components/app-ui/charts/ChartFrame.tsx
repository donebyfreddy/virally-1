import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { chartSeries } from "@/lib/accessibility/palette";
import type { Series } from "./geometry";

/**
 * Shared chart chrome: title, legend, the data table, and the empty state.
 *
 * Every chart in the product wears this, which is what makes them read as one
 * system rather than four separately-styled graphics. It also enforces the two
 * accessibility rules that are easy to skip per-chart: a legend whenever there
 * is more than one series, and a real `<table>` carrying the same numbers.
 */

/** Series colour by INDEX in a fixed order — never cycled, never by rank. */
export function seriesColorVar(index: number): string {
  // Beyond the ramp we do not invent a hue. The caller is expected to fold
  // extra series into "Other" or use small multiples; if one slips through it
  // renders in the muted text colour, which is visibly wrong rather than
  // plausibly wrong.
  const token = chartSeries[index];
  return token ? `var(--color-${token})` : "var(--color-text-muted)";
}

export function seriesDashVar(index: number): string {
  return index < chartSeries.length ? `var(--chart-dash-${index + 1})` : "none";
}

export function ChartFrame({
  title,
  /** Rendered at the end of the title row — a range control, a total. */
  aside,
  series,
  children,
  /** Formats a y value for the legend, table and tooltip. */
  formatValue,
  /** Formats an x value for the table's row header. */
  formatX,
  /** Shown instead of the plot when there is nothing to draw. */
  empty,
  className,
  id,
}: {
  title: string;
  aside?: ReactNode;
  series: readonly Series[];
  children: ReactNode;
  formatValue: (value: number) => string;
  formatX: (value: number) => string;
  empty?: ReactNode;
  className?: string;
  id: string;
}) {
  const hasData = series.some((s) => s.points.length > 0);

  if (!hasData) {
    return (
      <section aria-labelledby={`${id}-title`} className={className}>
        <ChartHeading id={id} title={title} aside={aside} />
        <div className="mt-[var(--space-4)]">{empty}</div>
      </section>
    );
  }

  // Every x value across all series, so a table row exists even where one
  // series has a gap.
  const xValues = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort(
    (a, b) => a - b,
  );

  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <ChartHeading id={id} title={title} aside={aside} />

      {/* Legend is mandatory for two or more series — identity is never
          carried by colour position alone. A single series needs none: the
          title already names it. */}
      {series.length > 1 && (
        <ul className="mt-[var(--space-3)] flex flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-2)]">
          {series.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]"
            >
              {/* The swatch carries identity; the label stays in text ink.
                  Series colour never renders text. */}
              <svg
                aria-hidden="true"
                width="16"
                height="8"
                viewBox="0 0 16 8"
                className="shrink-0 overflow-visible"
              >
                <line
                  x1="0"
                  y1="4"
                  x2="16"
                  y2="4"
                  stroke={seriesColorVar(index)}
                  strokeWidth="2"
                  strokeDasharray={seriesDashVar(index)}
                  strokeLinecap="round"
                />
              </svg>
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-[var(--space-4)]">{children}</div>

      {/* The DOM equivalent. Information never exists only in a drawing, so the
          SVG above is aria-hidden and this table is the accessible source. It is
          collapsed by default because it duplicates the plot for sighted users,
          but it is real markup, reachable by keyboard and always in the a11y
          tree. */}
      <details className="mt-[var(--space-4)] group">
        <summary
          className={cn(
            "inline-flex min-h-9 cursor-pointer list-none items-center gap-[var(--space-2)]",
            "text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]",
            "transition-colors duration-[var(--dur-instant)]",
            "hover:text-[color:var(--text-primary)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
            "[&::-webkit-details-marker]:hidden",
          )}
        >
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ▸
          </span>
          View as table
        </summary>

        <div className="mt-[var(--space-3)] max-h-[20rem] overflow-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{title}, as a data table</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky top-0 bg-[var(--surface-primary)] px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]"
                >
                  Period
                </th>
                {series.map((item) => (
                  <th
                    key={item.id}
                    scope="col"
                    className="sticky top-0 bg-[var(--surface-primary)] px-[var(--space-2)] py-[var(--space-2)] text-right text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]"
                  >
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {xValues.map((x) => (
                <tr key={x} className="border-t border-[var(--border-subtle)]">
                  <th
                    scope="row"
                    className="px-[var(--space-2)] py-[var(--space-2)] text-[length:var(--text-app-meta)] font-normal text-[color:var(--text-secondary)]"
                  >
                    {formatX(x)}
                  </th>
                  {series.map((item) => {
                    const point = item.points.find((p) => p.x === x);
                    return (
                      <td
                        key={item.id}
                        className="app-figure px-[var(--space-2)] py-[var(--space-2)] text-right text-[length:var(--text-app-meta)] text-[color:var(--text-primary)]"
                      >
                        {point ? formatValue(point.y) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function ChartHeading({
  id,
  title,
  aside,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-4)]">
      <h3 id={`${id}-title`} className="app-card-title text-[color:var(--text-primary)]">
        {title}
      </h3>
      {aside}
    </div>
  );
}
