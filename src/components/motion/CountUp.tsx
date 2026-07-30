"use client";

import { animate, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ease } from "@/lib/motion/tokens";
import { useReducedMotionPreference } from "@/lib/motion/useReducedMotionPreference";
import { formatMetric, type MetricFormat } from "@/lib/format";
import { cn } from "@/lib/cn";

type CountUpProps = {
  value: number;
  format?: MetricFormat;
  className?: string;
  /**
   * Only verified data may animate. Illustrative or placeholder figures render
   * statically — animating an invented number dresses it up as evidence.
   */
  animated?: boolean;
  /** Screen-reader label prefix, e.g. "Campaigns generated". */
  label?: string;
};

/**
 * Single-shot count-up: ~1.3s, tabular numerals, announced once when settled.
 *
 * The animated branch writes DOM text imperatively so the count costs zero
 * React renders, and hides the ticking figure from assistive tech — a live
 * region reading every intermediate frame would be unusable. The static branch
 * is a plain span with no live region at all, since there is nothing to
 * announce beyond the text already in the accessibility tree.
 */
export function CountUp({
  value,
  format = "count",
  className,
  animated = true,
  label,
}: CountUpProps) {
  const prefersReduced = useReducedMotionPreference();
  const shouldAnimate = animated && !prefersReduced;
  const finalText = formatMetric(value, format);

  if (!shouldAnimate) {
    return (
      <span className={cn("font-utility tabular-nums", className)}>
        {finalText}
      </span>
    );
  }

  return (
    <AnimatedCount
      value={value}
      format={format}
      className={className}
      label={label}
      finalText={finalText}
    />
  );
}

function AnimatedCount({
  value,
  format,
  className,
  label,
  finalText,
}: {
  value: number;
  format: MetricFormat;
  className?: string;
  label?: string;
  finalText: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const node = ref.current;
    if (!node || !inView) return;

    const controls = animate(0, value, {
      duration: 1.3,
      ease: ease.cut,
      onUpdate: (latest) => {
        node.textContent = formatMetric(latest, format);
      },
      onComplete: () => {
        node.textContent = finalText;
        // Set from an animation callback, not synchronously in the effect body.
        setAnnouncement(`${label ? `${label}: ` : ""}${finalText}`);
      },
    });

    return () => controls.stop();
  }, [inView, value, format, label, finalText]);

  return (
    <>
      <span
        ref={ref}
        aria-hidden="true"
        className={cn("font-utility tabular-nums", className)}
      >
        {formatMetric(0, format)}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
