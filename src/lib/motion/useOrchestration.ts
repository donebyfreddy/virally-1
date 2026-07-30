"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One timeline, one rAF loop.
 *
 * The hero has ten beats over fifteen seconds. Driving each with its own timer
 * or scroll observer would mean ten schedulers drifting apart; this keeps a
 * single elapsed clock and derives everything from it.
 *
 * `elapsedRef` is exposed so children that need sub-beat resolution (the
 * typewriter) can read the clock every frame and write to the DOM directly,
 * without forcing a React render per character.
 */

export type Beat<T extends string> = {
  id: T;
  /** Seconds from timeline start. */
  at: number;
};

type OrchestrationOptions<T extends string> = {
  beats: readonly Beat<T>[];
  /** Total loop length in seconds, including the hold before restart. */
  loopDuration: number;
  /**
   * When true the timeline never runs: it reports the final beat immediately.
   * Used for reduced motion and for the SSR/pre-hydration render.
   */
  staticFinalState: boolean;
  /** Pauses when the element leaves the viewport or the tab is hidden. */
  active: boolean;
};

export type OrchestrationState<T extends string> = {
  beat: T;
  beatIndex: number;
  /** True only while the frame loop is actually running. */
  isPlaying: boolean;
  /**
   * Whether the visitor has paused it. Distinct from `isPlaying`, which is
   * also false when the panel is off-screen or the tab is hidden — control
   * labels must reflect intent, not viewport state, or a control below the
   * fold reads "Play" when nothing was ever paused.
   */
  userPaused: boolean;
  /** Live clock in seconds. Read in a rAF loop; never triggers a render. */
  elapsedRef: React.RefObject<number>;
  toggle: () => void;
  restart: () => void;
};

export function useOrchestration<T extends string>({
  beats,
  loopDuration,
  staticFinalState,
  active,
}: OrchestrationOptions<T>): OrchestrationState<T> {
  const finalIndex = beats.length - 1;
  const [runningIndex, setRunningIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);

  const elapsedRef = useRef(0);
  const frameRef = useRef(0);
  const lastTickRef = useRef(0);

  const isPlaying = !staticFinalState && active && !userPaused;

  // Derived rather than stored: when the timeline is disabled the hook reports
  // the settled state directly, so the panel is never frozen mid-generation
  // with half its content missing — and no effect has to correct state after
  // the fact.
  const beatIndex = staticFinalState ? finalIndex : runningIndex;

  // Keep the shared clock consistent with the reported beat for children that
  // read it directly. A ref write is not a render, so this stays effect-safe.
  useEffect(() => {
    if (staticFinalState) elapsedRef.current = loopDuration;
  }, [staticFinalState, loopDuration]);

  useEffect(() => {
    if (!isPlaying) return;

    lastTickRef.current = performance.now();

    const tick = (now: number) => {
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Clamp the delta so a backgrounded tab resuming does not fast-forward
      // through the whole timeline in a single frame.
      elapsedRef.current = (elapsedRef.current + Math.min(delta, 0.1)) % loopDuration;

      let next = 0;
      for (let i = 0; i < beats.length; i += 1) {
        if (elapsedRef.current >= beats[i].at) next = i;
        else break;
      }

      // Commit only on a threshold crossing: ~10 renders per loop, not 900.
      setRunningIndex((prev) => (prev === next ? prev : next));

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [isPlaying, beats, loopDuration]);

  const toggle = useCallback(() => setUserPaused((v) => !v), []);

  const restart = useCallback(() => {
    elapsedRef.current = 0;
    lastTickRef.current = performance.now();
    setRunningIndex(0);
    setUserPaused(false);
  }, []);

  return {
    beat: beats[beatIndex].id,
    beatIndex,
    isPlaying,
    userPaused,
    elapsedRef,
    toggle,
    restart,
  };
}

/**
 * Pauses work when the element is off-screen or the tab is hidden. An
 * animation nobody can see is pure battery cost.
 */
export function useActiveWhenVisible(
  ref: React.RefObject<Element | null>,
): boolean {
  const [inViewport, setInViewport] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  useEffect(() => {
    const onChange = () => setTabVisible(!document.hidden);
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return inViewport && tabVisible;
}
