"use client";

import { m, useScroll, useSpring } from "framer-motion";
import { useReducedMotionPreference } from "@/lib/motion/useReducedMotionPreference";

/**
 * Thin page-progress indicator. On mobile this is what the campaign status
 * rail collapses into.
 *
 * Driven purely by a motion value — no state, no re-render per scroll frame.
 * Under reduced motion the bar still tracks position (that is information, not
 * decoration) but loses the spring smoothing.
 */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const prefersReduced = useReducedMotionPreference();
  const smoothed = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <m.div
      aria-hidden="true"
      className={className}
      style={{
        scaleX: prefersReduced ? scrollYProgress : smoothed,
        transformOrigin: "0% 50%",
      }}
    />
  );
}
