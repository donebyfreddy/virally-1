"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  areaPath,
  buildScale,
  linePath,
  nearestIndex,
  yTicks,
  type Series,
} from "./geometry";
import { ChartFrame, seriesColorVar, seriesDashVar } from "./ChartFrame";

/**
 * Multi-series time-series chart.
 *
 * SVG rendered by hand rather than through a charting library. Three reasons,
 * in order of weight: a library's default styling is exactly the "ugly default
 * chart" the brief rules out and fighting it costs more than drawing the marks;
 * the geometry needed here is a polyline and a crosshair, which is a hundred
 * lines; and the smallest credible library is larger than the whole page's JS
 * budget.
 *
 * Client component because the crosshair is a pointer interaction. The SVG is
 * viewBox-scaled so it is resolution-independent and needs no resize observer —
 * which keeps this off the "unnecessary animation observers" list.
 */

/** viewBox units. Not pixels — the SVG scales to its container. */
const VIEW = { width: 800, height: 260 };
const PADDING = { top: 16, right: 16, bottom: 28, left: 48 };

export function TimeSeriesChart({
  title,
  series,
  formatValue,
  formatX,
  /** Fills under the first series. For a single-measure trend. */
  area = false,
  aside,
  empty,
  className,
}: {
  title: string;
  series: readonly Series[];
  formatValue: (value: number) => string;
  formatX: (value: number) => string;
  area?: boolean;
  aside?: React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
}) {
  const reactId = useId();
  const id = `chart${reactId.replace(/[:]/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const scale = buildScale(series, { ...VIEW, padding: PADDING });
  const ticks = yTicks(scale);

  // The x positions come from the longest series, so the crosshair still has
  // columns to snap to when a shorter series ends early.
  const spine = series.reduce<Series | null>(
    (longest, item) => (!longest || item.points.length > longest.points.length ? item : longest),
    null,
  );

  function handlePointer(event: React.PointerEvent<SVGSVGElement>) {
    if (!spine || spine.points.length === 0) return;
    const svg = svgRef.current;
    if (!svg) return;

    // Converts client pixels to viewBox units. Reading getBoundingClientRect
    // here rather than caching it in state: it is one synchronous read per
    // pointer move and caching it would go stale on every resize and scroll.
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * VIEW.width;
    setActiveIndex(nearestIndex(spine.points, viewX, scale));
  }

  const activeX = spine && activeIndex !== null ? spine.points[activeIndex]?.x : undefined;

  return (
    <ChartFrame
      id={id}
      title={title}
      aside={aside}
      series={series}
      formatValue={formatValue}
      formatX={formatX}
      empty={empty}
      className={className}
    >
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          // The table in ChartFrame is the accessible equivalent, so the
          // drawing itself is hidden rather than given a redundant description.
          aria-hidden="true"
          role="presentation"
          preserveAspectRatio="none"
          className="h-[16rem] w-full touch-none"
          onPointerMove={handlePointer}
          onPointerLeave={() => setActiveIndex(null)}
        >
          {/* Grid. Recessive by design — a grid that competes with the data is
              a worse chart. Horizontal only; vertical rules add nothing when
              the x axis is already labelled. */}
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={PADDING.left}
              y1={scale.y(tick)}
              x2={VIEW.width - PADDING.right}
              y2={scale.y(tick)}
              stroke="var(--chart-grid)"
              strokeWidth="1"
            />
          ))}

          {/* Axis labels wear text ink, never a series colour. */}
          {ticks.map((tick) => (
            <text
              key={`label-${tick}`}
              x={PADDING.left - 8}
              y={scale.y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--chart-axis)"
              className="font-utility"
              fontSize="11"
            >
              {formatValue(tick)}
            </text>
          ))}

          {area && series[0] && (
            <path d={areaPath(series[0].points, scale)} fill="var(--chart-fill-1)" stroke="none" />
          )}

          {series.map((item, index) => (
            <path
              key={item.id}
              d={linePath(item.points, scale)}
              fill="none"
              stroke={seriesColorVar(index)}
              strokeWidth="2"
              strokeDasharray={seriesDashVar(index)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Crosshair. Drawn before the markers so the markers sit on top. */}
          {activeX !== undefined && (
            <line
              x1={scale.x(activeX)}
              y1={PADDING.top}
              x2={scale.x(activeX)}
              y2={VIEW.height - PADDING.bottom}
              stroke="var(--color-border)"
              strokeWidth="1"
            />
          )}

          {activeX !== undefined &&
            series.map((item, index) => {
              const point = item.points.find((p) => p.x === activeX);
              if (!point) return null;
              return (
                <circle
                  key={`marker-${item.id}`}
                  cx={scale.x(point.x)}
                  cy={scale.y(point.y)}
                  r="4"
                  fill={seriesColorVar(index)}
                  // A surface-coloured ring separates overlapping markers.
                  stroke="var(--color-surface-1)"
                  strokeWidth="2"
                />
              );
            })}
        </svg>

        {/* Tooltip. Positioned in percentage of the container so it tracks the
            scaled viewBox without a second coordinate conversion. */}
        {activeX !== undefined && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-0 z-[var(--z-raised)] min-w-[10rem] -translate-x-1/2",
              "rounded-[var(--radius-sm)] border border-[var(--color-border)]",
              "bg-[var(--color-surface-2)] p-[var(--space-3)] shadow-[var(--shadow-raised)]",
            )}
            style={{
              left: `${(scale.x(activeX) / VIEW.width) * 100}%`,
            }}
          >
            <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {formatX(activeX)}
            </p>
            <dl className="mt-[var(--space-2)] flex flex-col gap-[var(--space-1)]">
              {series.map((item, index) => {
                const point = item.points.find((p) => p.x === activeX);
                if (!point) return null;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-[var(--space-3)]">
                    <dt className="flex items-center gap-[var(--space-2)] text-[length:var(--text-utility-xs)] text-[color:var(--color-text-secondary)]">
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: seriesColorVar(index) }}
                      />
                      {item.label}
                    </dt>
                    <dd className="font-utility text-[length:var(--text-app-meta)] tabular-nums text-[color:var(--color-text-primary)]">
                      {formatValue(point.y)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
