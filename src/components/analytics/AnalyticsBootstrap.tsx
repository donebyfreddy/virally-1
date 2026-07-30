"use client";

import { useEffect, useRef } from "react";
import { consoleSink, registerSink, setConsent, track } from "@/lib/analytics/track";

/**
 * Registers sinks and emits the page-level events that no single component
 * owns: page view, scroll depth and time-to-first-CTA.
 *
 * Consent is granted here only because no real vendor is attached and the
 * console sink never leaves the browser. Wire this to the real consent banner
 * before adding a network sink — the façade already buffers correctly.
 */
export function AnalyticsBootstrap() {
  const firstCtaRef = useRef(false);

  useEffect(() => {
    const off = registerSink(consoleSink);
    setConsent("granted");
    track("page_viewed", "document", { path: window.location.pathname });
    return off;
  }, []);

  /** Scroll-depth milestones, each fired once. */
  useEffect(() => {
    const milestones: Array<25 | 50 | 75 | 100> = [25, 50, 75, 100];
    const fired = new Set<number>();
    let frame = 0;

    const check = () => {
      frame = 0;
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const percent = (window.scrollY / scrollable) * 100;
      for (const milestone of milestones) {
        if (percent >= milestone && !fired.has(milestone)) {
          fired.add(milestone);
          track("scroll_depth", "document", { percent: milestone });
        }
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(check);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /** Time from load to the first CTA click, anywhere on the page. */
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (firstCtaRef.current) return;
      const target = (event.target as HTMLElement | null)?.closest("a, button");
      if (!target) return;
      const label = target.textContent?.trim() ?? "";
      if (!/start creating|talk to sales/i.test(label)) return;
      firstCtaRef.current = true;
      track("time_to_first_cta", "document", {
        ms: Math.round(performance.now()),
      });
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
