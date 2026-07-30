/**
 * Motion tokens mirrored from `styles/tokens.css` for use in Framer Motion
 * transition objects, which cannot read CSS custom properties.
 *
 * These two definitions must stay in sync. `tokens.test.ts` asserts it by
 * parsing the CSS file, so drift fails the test run rather than shipping.
 */

export const duration = {
  instant: 0.12,
  base: 0.24,
  panel: 0.42,
  orch: 1.4,
} as const;

export const ease = {
  /** Decisive "edit cut" — state commits. */
  cut: [0.2, 0, 0, 1],
  /** Arrival: nodes landing, panels resting. */
  settle: [0.16, 1, 0.3, 1],
  /** Appearing. */
  enter: [0, 0, 0.2, 1],
  /** Leaving — faster than entering. */
  exit: [0.4, 0, 1, 1],
  /** Playheads and progress only. An eased progress bar lies. */
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, [number, number, number, number]>;

export type EaseName = keyof typeof ease;
export type DurationName = keyof typeof duration;

/** Standard component state change. */
export const transitionBase = {
  duration: duration.base,
  ease: ease.cut,
} as const;

/** Panel entrance, branch draw, format morph. */
export const transitionPanel = {
  duration: duration.panel,
  ease: ease.settle,
} as const;

/** Press, hover, focus response. */
export const transitionInstant = {
  duration: duration.instant,
  ease: ease.cut,
} as const;
