"use client";

import { AnimatePresence, m } from "framer-motion";
import type { CampaignGraph } from "@/lib/multiplier";
import { duration, ease } from "@/lib/motion/tokens";
import { cn } from "@/lib/cn";

/**
 * The fan-out drawing.
 *
 * `aria-hidden` throughout: this is a picture of data that is also present as
 * a real structured list beneath it. Nothing here is the only route to any
 * information, so the section works fully without it.
 *
 * Nodes animate opacity and transform only; removals collapse rather than pop.
 */
export function FanOutGraph({
  graph,
  highlightColumn,
  onHighlight,
}: {
  graph: CampaignGraph;
  highlightColumn: string | null;
  onHighlight: (columnId: string | null) => void;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "grid grid-cols-4 gap-3 rounded-[var(--radius-lg)] p-4",
        "border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)]",
      )}
    >
      {graph.columns.map((column) => {
        const dimmed = highlightColumn !== null && highlightColumn !== column.id;
        return (
          <div
            key={column.id}
            onMouseEnter={() => onHighlight(column.id)}
            onMouseLeave={() => onHighlight(null)}
            className={cn(
              "flex min-w-0 flex-col gap-2",
              "transition-opacity duration-[var(--dur-base)] ease-[var(--ease-cut)]",
              dimmed ? "opacity-35" : "opacity-100",
            )}
          >
            <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
              {column.label}
            </p>

            <ul className="flex flex-col gap-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {column.nodes.map((node) => (
                  <m.li
                    key={node.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: duration.base, ease: ease.settle }}
                    className={cn(
                      "min-w-0 rounded-[var(--radius-sm)] border px-2 py-1.5",
                      node.aggregatedCount
                        ? "border-[var(--color-border)] bg-[var(--color-surface-3)]"
                        : "border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
                    )}
                  >
                    <span className="block truncate font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-primary)]">
                      {node.label}
                    </span>
                    {node.detail && (
                      <span className="block truncate font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                        {node.detail}
                      </span>
                    )}
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        );
      })}
    </div>
  );
}
