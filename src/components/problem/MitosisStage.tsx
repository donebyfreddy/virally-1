"use client";

import { useRef } from "react";
import { m, useScroll, useTransform, type MotionValue } from "framer-motion";
import { bottleneck } from "@/content/evidence";
import { RATIOS, type RatioKey } from "@/components/motion/AspectRatioMorph";
import { useReducedMotionPreference } from "@/lib/motion/useReducedMotionPreference";
import { cn } from "@/lib/cn";

const COUNT = bottleneck.splits.length;

/**
 * S3's mechanic: one tile undergoes mitosis into five format-specific versions
 * as you scroll, then the manual cost of each is revealed.
 *
 * Fully reversible — every value is a `useTransform` off a single scroll
 * progress, so scrolling back rewinds exactly. Only `transform` and `opacity`
 * animate; nothing here touches layout.
 *
 * Under reduced motion the split is rendered in its final state as a static
 * row, which carries the same argument without any movement.
 */
export function MitosisStage() {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotionPreference();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.35"],
  });

  if (prefersReduced) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {bottleneck.splits.map((split) => (
          <SplitTile key={split.id} ratio={split.ratio as RatioKey} label={split.label} />
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {bottleneck.splits.map((split, index) => (
          <MitosisTile
            key={split.id}
            index={index}
            progress={scrollYProgress}
            ratio={split.ratio as RatioKey}
            label={split.label}
          />
        ))}
      </div>
    </div>
  );
}

function MitosisTile({
  index,
  progress,
  ratio,
  label,
}: {
  index: number;
  progress: MotionValue<number>;
  ratio: RatioKey;
  label: string;
}) {
  const centre = (COUNT - 1) / 2;
  // Every tile starts stacked at the centre — one object — and separates out.
  const offset = (index - centre) * 110;

  const x = useTransform(progress, [0, 0.55], [`${offset}%`, "0%"]);
  const scale = useTransform(progress, [0, 0.55], [0.82, 1]);
  const opacity = useTransform(
    progress,
    [0, 0.12, 0.55],
    [index === Math.round(centre) ? 1 : 0, 0.35, 1],
  );
  const labelOpacity = useTransform(progress, [0.55, 0.8], [0, 1]);

  return (
    <m.div style={{ x, scale, opacity }} className="flex flex-col gap-2">
      <TileFrame ratio={ratio} />
      <m.span
        style={{ opacity: labelOpacity }}
        className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]"
      >
        {ratio} · {label}
      </m.span>
    </m.div>
  );
}

function SplitTile({ ratio, label }: { ratio: RatioKey; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <TileFrame ratio={ratio} />
      <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
        {ratio} · {label}
      </span>
    </div>
  );
}

/** Abstract format frame. Neutral tokens only — a frame is not a decision. */
function TileFrame({ ratio }: { ratio: RatioKey }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative w-full overflow-hidden rounded-[var(--radius-sm)]",
        "border border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
      )}
      style={{ aspectRatio: String(RATIOS[ratio]) }}
    >
      <div className="absolute left-1/2 top-[38%] aspect-square w-[34%] -translate-x-1/2 rounded-full bg-[var(--color-text-muted)] opacity-25" />
      <div className="absolute inset-x-2 bottom-2 h-1 rounded-[var(--radius-sm)] bg-[var(--color-text-secondary)] opacity-25" />
    </div>
  );
}
