"use client";

import { useEffect, useState } from "react";
import { pipelineActs } from "@/content/pipeline";
import { ctas } from "@/content/navigation";
import { cn } from "@/lib/cn";

/**
 * The persistent conversion element, shaped like a render queue.
 *
 * Appears after the hero, disappears before the footer, and never overlaps
 * essential content — it sits in the left gutter at ≥1280px only, where there
 * is genuinely spare width. Below that the navbar's thin progress bar is the
 * collapsed form.
 *
 * `position: fixed` keeps it outside layout flow, so it contributes no CLS.
 * It is not a chat widget and must never acquire a bubble, an avatar or a
 * notification dot.
 */

const STAGE_SECTIONS = [
  { id: "workflow", act: pipelineActs[0] },
  { id: "multiplier", act: pipelineActs[1] },
  { id: "formats", act: pipelineActs[2] },
  { id: "channels", act: pipelineActs[3] },
  { id: "results", act: pipelineActs[4] },
] as const;

export function CampaignStatusRail() {
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const heroBottom = document.getElementById("hero")?.getBoundingClientRect().bottom ?? 0;
      const footerTop =
        document.querySelector("footer")?.getBoundingClientRect().top ?? Infinity;

      setVisible(heroBottom < 0 && footerTop > window.innerHeight);

      // The stage whose section currently occupies the upper viewport.
      let next = -1;
      STAGE_SECTIONS.forEach((stage, index) => {
        const el = document.getElementById(stage.id);
        if (!el) return;
        const { top } = el.getBoundingClientRect();
        if (top <= window.innerHeight * 0.4) next = index;
      });
      setActiveIndex((prev) => (prev === next ? prev : next));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <aside
      aria-label="Campaign stages"
      className={cn(
        "fixed left-6 top-1/2 z-[var(--z-rail)] hidden -translate-y-1/2 xl:block",
        "transition-opacity duration-[var(--dur-base)] ease-[var(--ease-cut)]",
        visible ? "opacity-100" : "pointer-events-none invisible opacity-0",
      )}
      // Hidden from AT when invisible, so it never appears as a stray landmark.
      aria-hidden={!visible}
    >
      <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
        Campaign status
      </p>

      <ol className="mt-4 flex flex-col gap-1.5">
        {STAGE_SECTIONS.map((stage, index) => {
          const active = index === activeIndex;
          const complete = index < activeIndex;
          return (
            <li key={stage.id}>
              <a
                href={`#${stage.id}`}
                tabIndex={visible ? 0 : -1}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] pr-2",
                  "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
                  "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                  active
                    ? "text-[color:var(--color-text-primary)]"
                    : "text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-secondary)]",
                )}
              >
                <span className="tabular-nums">{stage.act.number}</span>
                <span className="w-20 truncate">{stage.act.title}</span>
                {/* Signal colour marks the stage currently being read. */}
                <span aria-hidden="true" className={active ? "text-[color:var(--color-signal)]" : ""}>
                  {active ? "▸" : complete ? "✓" : "·"}
                </span>
              </a>
            </li>
          );
        })}
      </ol>

      <a
        href={ctas.primary.href}
        tabIndex={visible ? 0 : -1}
        className={cn(
          "mt-4 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3",
          "bg-[var(--color-action)] text-[color:var(--color-text-oncolor)]",
          "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
        )}
      >
        {ctas.primary.label} →
      </a>
    </aside>
  );
}
