import type { Beat } from "@/lib/motion/useOrchestration";

/**
 * The hero's ten beats. Fifteen seconds including the hold before restart,
 * inside the 12–16s target.
 *
 * Pauses fall after meaningful phrases rather than at fixed intervals — the
 * typing should read like someone thinking, not like a terminal effect.
 */
export type HeroBeat =
  | "idle"
  | "typing"
  | "parsed"
  | "concepts"
  | "outputs"
  | "platforms"
  | "generating"
  | "rendered"
  | "scheduled"
  | "hold";

export const HERO_BEATS: readonly Beat<HeroBeat>[] = [
  { id: "idle", at: 0 },
  { id: "typing", at: 0.4 },
  { id: "parsed", at: 5.2 },
  { id: "concepts", at: 6.2 },
  { id: "outputs", at: 7.4 },
  { id: "platforms", at: 8.8 },
  { id: "generating", at: 9.6 },
  { id: "rendered", at: 10.4 },
  { id: "scheduled", at: 12.2 },
  { id: "hold", at: 13.2 },
] as const;

export const HERO_LOOP_DURATION = 15;

/** Typing window, used by the typewriter to derive characters from the clock. */
export const TYPING_START = 0.4;
export const TYPING_END = 5.0;

const order: readonly HeroBeat[] = HERO_BEATS.map((b) => b.id);

/** True once the timeline has reached `target`. Beats are cumulative. */
export function hasReached(current: HeroBeat, target: HeroBeat): boolean {
  return order.indexOf(current) >= order.indexOf(target);
}
