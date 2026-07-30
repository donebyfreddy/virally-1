"use client";

import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Single motion root for the whole site.
 *
 * - `LazyMotion` + `domAnimation` loads only the DOM animation feature set.
 *   Components must use `m.*` rather than `motion.*` for this to pay off.
 * - `reducedMotion="user"` is the global switch. Components must not scatter
 *   their own `prefers-reduced-motion` conditionals for transition disabling;
 *   they only branch when reduced motion changes *structure* (e.g. the pipeline
 *   unpinning), which is what `useReducedMotionPreference` is for.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
