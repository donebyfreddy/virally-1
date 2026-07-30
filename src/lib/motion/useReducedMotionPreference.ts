"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Server snapshot is `false` so the animated markup is what gets hydrated.
 * Components that branch on this must render a layout whose *content* is
 * identical in both modes — only the mechanic may differ — otherwise the
 * first client paint shifts.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Use this only where reduced motion changes **structure** (the pipeline
 * unpinning, the hero starting at its final frame, the output wall halting).
 * For merely disabling transitions, rely on the global
 * `MotionConfig reducedMotion="user"` instead.
 */
export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
