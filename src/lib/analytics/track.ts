"use client";

import {
  deviceCategory,
  isSafePayload,
  viewportBucket,
  type AnalyticsEvent,
  type BaseContext,
  type EventMap,
  type EventName,
} from "./events";

/**
 * Vendor-neutral analytics façade.
 *
 * No component imports an SDK. Sinks are registered at runtime, so swapping
 * provider is a one-file change and none of the 18 call sites move.
 *
 * Consent-gated by default: events buffer until consent is granted and are
 * discarded if it is denied. Nothing leaves the page before then.
 */

type Sink = (event: AnalyticsEvent) => void;

const sinks = new Set<Sink>();
let queue: AnalyticsEvent[] = [];
let consent: "pending" | "granted" | "denied" = "pending";

const MAX_QUEUE = 100;

export function registerSink(sink: Sink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function setConsent(next: "granted" | "denied"): void {
  consent = next;
  if (next === "granted") {
    queue.forEach(emit);
  }
  queue = [];
}

export function getConsent(): typeof consent {
  return consent;
}

function emit(event: AnalyticsEvent): void {
  sinks.forEach((sink) => {
    try {
      sink(event);
    } catch {
      // A failing sink must never break the page it is measuring.
    }
  });
}

function buildContext(section: string): BaseContext {
  const width = typeof window === "undefined" ? 1440 : window.innerWidth;
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    section,
    deviceCategory: deviceCategory(width),
    reducedMotion: reduced,
    viewportBucket: viewportBucket(width),
  };
}

export function track<K extends EventName>(
  name: K,
  section: string,
  props: EventMap[K],
): void {
  if (consent === "denied") return;

  const record = props as Record<string, unknown>;
  if (!isSafePayload(record)) {
    if (process.env.NODE_ENV !== "production") {
      // Loud in development, silent in production — a rejected payload is a
      // bug in the call site, not something to surface to a visitor.
      console.warn(`[analytics] rejected unsafe payload for "${name}"`);
    }
    return;
  }

  const event: AnalyticsEvent<K> = {
    name,
    props,
    context: buildContext(section),
    at: typeof performance === "undefined" ? 0 : Math.round(performance.now()),
  };

  if (consent === "pending") {
    // Bounded so a visitor who never answers cannot grow the buffer forever.
    if (queue.length < MAX_QUEUE) queue.push(event as AnalyticsEvent);
    return;
  }

  emit(event as AnalyticsEvent);
}

/** Development sink. Replace with a real adapter at the app boundary. */
export function consoleSink(event: AnalyticsEvent): void {
  if (process.env.NODE_ENV === "production") return;
  console.debug(`[analytics] ${event.name}`, event.props, event.context);
}

/** Test helper: returns the buffered events without flushing them. */
export function __peekQueue(): readonly AnalyticsEvent[] {
  return queue;
}

/** Test helper: restores module state between cases. */
export function __reset(): void {
  sinks.clear();
  queue = [];
  consent = "pending";
}
