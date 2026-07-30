"use client";

import { useCallback, useRef } from "react";
import { RUNTIME_SECONDS, type Variant } from "@/content/laboratory";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

const W = 600;
const H = 240;
const PAD = { top: 16, right: 12, bottom: 28, left: 34 };

const xOf = (t: number) =>
  PAD.left + (t / RUNTIME_SECONDS) * (W - PAD.left - PAD.right);
const yOf = (r: number) => PAD.top + (1 - r / 100) * (H - PAD.top - PAD.bottom);

/**
 * Retention curve with an interactive playhead.
 *
 * The chart writes to the same `currentTime` owner the video uses, rather than
 * holding its own copy — one source of truth, so the two can never drift apart
 * or feed back into each other.
 *
 * `role="img"` with a label here; the full data table lives next to it in the
 * parent, so nothing in this drawing is the only route to the information.
 */
export function RetentionChart({
  variant,
  currentTime,
  onSeek,
  activeEventId,
  onEventFocus,
}: {
  variant: Variant;
  currentTime: number;
  onSeek: (t: number) => void;
  activeEventId: string | null;
  onEventFocus: (id: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  const line = variant.curve
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t)},${yOf(p.retention)}`)
    .join(" ");

  const area = `${line} L${xOf(RUNTIME_SECONDS)},${yOf(0)} L${xOf(0)},${yOf(0)} Z`;

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const svgX = ratio * W;
      const t =
        ((svgX - PAD.left) / (W - PAD.left - PAD.right)) * RUNTIME_SECONDS;
      onSeek(Math.min(RUNTIME_SECONDS, Math.max(0, t)));
    },
    [onSeek],
  );

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Retention curve for ${variant.label}. Starts at 100% and ends at ${variant.completion}% completion. A data table follows.`}
        className="w-full cursor-crosshair touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromPointer(e.clientX);
        }}
      >
        {/* Gridlines */}
        {[0, 25, 50, 75, 100].map((r) => (
          <g key={r}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yOf(r)}
              y2={yOf(r)}
              stroke="var(--color-border-hairline)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yOf(r) + 4}
              textAnchor="end"
              className="font-utility"
              fill="var(--color-text-muted)"
              fontSize={9}
            >
              {r}
            </text>
          </g>
        ))}

        <path d={area} fill="var(--color-surface-3)" opacity={0.55} />
        <path
          d={line}
          fill="none"
          stroke="var(--color-text-secondary)"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Event markers */}
        {variant.events.map((event) => {
          const active = event.id === activeEventId;
          return (
            <g key={event.id}>
              <line
                x1={xOf(event.t)}
                x2={xOf(event.t)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke={active ? "var(--color-action)" : "var(--color-border)"}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={xOf(event.t)}
                cy={yOf(event.retentionAfter)}
                r={active ? 6 : 4}
                fill={active ? "var(--color-action)" : "var(--color-text-secondary)"}
              />
              <text
                x={xOf(event.t)}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                className="font-utility"
                fill={active ? "var(--color-action)" : "var(--color-text-muted)"}
                fontSize={9}
              >
                {event.label}
              </text>
              {/* Generous invisible hit area for pointer users. */}
              <rect
                x={xOf(event.t) - 14}
                y={PAD.top}
                width={28}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
                onMouseEnter={() => onEventFocus(event.id)}
                onMouseLeave={() => onEventFocus(null)}
                onClick={() => onSeek(event.t)}
              />
            </g>
          );
        })}

        {/* Playhead — linear, because it reports a real position. */}
        <line
          x1={xOf(currentTime)}
          x2={xOf(currentTime)}
          y1={PAD.top}
          y2={H - PAD.bottom}
          stroke="var(--color-signal)"
          strokeWidth={2}
        />
        <circle
          cx={xOf(currentTime)}
          cy={PAD.top}
          r={4}
          fill="var(--color-signal)"
        />
      </svg>

      <p className="mt-2 flex justify-between font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
        <span>{formatDuration(0)}</span>
        <span className={cn("tabular-nums text-[color:var(--color-signal)]")}>
          {formatDuration(currentTime)}
        </span>
        <span>{formatDuration(RUNTIME_SECONDS)}</span>
      </p>
    </div>
  );
}
