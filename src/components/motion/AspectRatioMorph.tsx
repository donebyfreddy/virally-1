"use client";

import { m } from "framer-motion";
import type { ReactNode } from "react";
import { duration, ease } from "@/lib/motion/tokens";
import { cn } from "@/lib/cn";

export const RATIOS = {
  "9:16": 9 / 16,
  "4:5": 4 / 5,
  "1:1": 1,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
} as const;

export type RatioKey = keyof typeof RATIOS;

/**
 * Morphs a frame between aspect ratios using a layout animation.
 *
 * The frame is sized by *width* within a fixed-height stage, so the surrounding
 * layout never reflows as the ratio changes — a morph that pushed sibling
 * content around would register as CLS on every interaction.
 *
 * Media inside must use `object-fit: cover` on its own element rather than
 * being stretched: the format engine's whole argument is that Virally
 * recomposes rather than distorts.
 */
export function AspectRatioMorph({
  ratio,
  children,
  className,
  /** Stage height in px; the frame's width is derived from the ratio. */
  stageHeight = 420,
}: {
  ratio: RatioKey;
  children: ReactNode;
  className?: string;
  stageHeight?: number;
}) {
  const width = stageHeight * RATIOS[ratio];

  return (
    <div
      className="flex w-full items-center justify-center"
      style={{ height: stageHeight }}
    >
      <m.div
        layout
        animate={{ width, height: stageHeight }}
        transition={{ duration: duration.panel, ease: ease.settle }}
        className={cn(
          "relative max-w-full overflow-hidden rounded-[var(--radius-lg)]",
          "border border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
          className,
        )}
      >
        {children}
      </m.div>
    </div>
  );
}
