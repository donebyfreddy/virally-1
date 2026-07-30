"use client";

import { useRef, useState } from "react";
import {
  m,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { pipeline, pipelineActs, type PipelineAct } from "@/content/pipeline";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { SectionContainer } from "@/components/motion/MotionSection";
import { useReducedMotionPreference } from "@/lib/motion/useReducedMotionPreference";
import { cn } from "@/lib/cn";

const ACTS = pipelineActs.length;

/**
 * S4 — the pipeline.
 *
 * Desktop pins a 100vh viewport and advances five acts across ~450vh of scroll.
 * One `useScroll` drives everything; the act index is committed via
 * `useMotionValueEvent` with an equality guard, so the section re-renders about
 * five times over its whole scroll range rather than once per frame.
 *
 * All five panels stay mounted and are driven by opacity/transform, which makes
 * scrolling backwards exact and free.
 *
 * Below `lg`, and under reduced motion at any width, the pin is removed
 * entirely and the acts render as a stacked list carrying identical copy.
 */
export function PipelineSection() {
  const prefersReduced = useReducedMotionPreference();

  return (
    <section
      id="workflow"
      aria-labelledby="pipeline-heading"
      className="border-t border-[var(--color-border-hairline)]"
    >
      <SectionContainer className="pt-20 md:pt-32">
        <div className="max-w-[46rem]">
          <Eyebrow>{pipeline.eyebrow}</Eyebrow>
          <h2
            id="pipeline-heading"
            className="font-display mt-6 text-[length:var(--text-display-l)]"
          >
            {pipeline.headline}
          </h2>
          <p className="prose-measure mt-6 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
            {pipeline.body}
          </p>
          {/* Escape hatch past the pinned region for keyboard users. */}
          <a
            href="#multiplier"
            className={cn(
              "sr-only mt-6 focus:not-sr-only focus:inline-flex focus:min-h-11 focus:items-center",
              "focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-action)] focus:px-4",
              "focus:font-utility focus:text-[length:var(--text-utility)] focus:uppercase",
              "focus:tracking-[var(--tracking-utility)] focus:text-[color:var(--color-text-oncolor)]",
            )}
          >
            {pipeline.skipLabel}
          </a>
        </div>
      </SectionContainer>

      {prefersReduced ? <StackedActs /> : <PinnedActs />}
    </section>
  );
}

/* ------------------------------------------------------------------ pinned */

function PinnedActs() {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    const next = Math.min(ACTS - 1, Math.max(0, Math.floor(value * ACTS)));
    // Equality guard: commits ~5 times across the section, not 5,000.
    setActiveIndex((prev) => (prev === next ? prev : next));
  });

  return (
    <>
      {/* Desktop: pinned sequence. */}
      <div
        ref={ref}
        className="relative hidden lg:block"
        style={{ height: `${ACTS * 90}vh` }}
      >
        <div className="sticky top-[var(--nav-height)] h-[calc(100vh-var(--nav-height))] overflow-hidden">
          <SectionContainer className="flex h-full items-center">
            <div className="grid w-full gap-16 lg:grid-cols-12">
              {/* Left: render-queue rail + copy. */}
              <div className="lg:col-span-4">
                <ActRail progress={scrollYProgress} activeIndex={activeIndex} />

                <div className="relative mt-12 min-h-[18rem]">
                  {pipelineActs.map((act, index) => (
                    <m.div
                      key={act.id}
                      aria-hidden={index !== activeIndex}
                      className="absolute inset-0"
                      initial={false}
                      animate={{
                        opacity: index === activeIndex ? 1 : 0,
                        y: index === activeIndex ? 0 : 12,
                      }}
                      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                      style={{
                        pointerEvents: index === activeIndex ? "auto" : "none",
                        visibility: index === activeIndex ? "visible" : "hidden",
                      }}
                    >
                      <ActCopy act={act} />
                    </m.div>
                  ))}
                </div>
              </div>

              {/* Right: the same campaign, at this stage. */}
              <div className="relative lg:col-span-7 lg:col-start-6">
                <div className="relative min-h-[26rem]">
                  {pipelineActs.map((act, index) => (
                    <m.div
                      key={act.id}
                      aria-hidden={index !== activeIndex}
                      className="absolute inset-0"
                      initial={false}
                      animate={{
                        opacity: index === activeIndex ? 1 : 0,
                        scale: index === activeIndex ? 1 : 0.98,
                      }}
                      transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                      style={{
                        visibility: index === activeIndex ? "visible" : "hidden",
                      }}
                    >
                      <ActVisual act={act} />
                    </m.div>
                  ))}
                </div>
              </div>
            </div>
          </SectionContainer>
        </div>
      </div>

      {/* Below lg: the same content, unpinned. */}
      <div className="lg:hidden">
        <StackedActs />
      </div>
    </>
  );
}

/** Five-track render-queue meter. Each track fills as its act is traversed. */
function ActRail({
  progress,
  activeIndex,
}: {
  progress: MotionValue<number>;
  activeIndex: number;
}) {
  return (
    <ul className="flex flex-col gap-2" aria-hidden="true">
      {pipelineActs.map((act, index) => (
        <RailTrack
          key={act.id}
          index={index}
          progress={progress}
          number={act.number}
          title={act.title}
          active={index === activeIndex}
          complete={index < activeIndex}
        />
      ))}
    </ul>
  );
}

function RailTrack({
  index,
  progress,
  number,
  title,
  active,
  complete,
}: {
  index: number;
  progress: MotionValue<number>;
  number: string;
  title: string;
  active: boolean;
  complete: boolean;
}) {
  const start = index / ACTS;
  const end = (index + 1) / ACTS;
  const scaleX = useTransform(progress, [start, end], [0, 1], { clamp: true });

  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "font-utility text-[length:var(--text-utility-xs)] tabular-nums",
          active
            ? "text-[color:var(--color-action)]"
            : complete
              ? "text-[color:var(--color-text-secondary)]"
              : "text-[color:var(--color-text-muted)]",
        )}
      >
        {number}
      </span>
      <span className="relative h-1 flex-1 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-surface-3)]">
        <m.span
          style={{ scaleX, transformOrigin: "0% 50%" }}
          className={cn(
            "absolute inset-0 rounded-[var(--radius-sm)]",
            // Teal only while this stage is the one processing.
            active ? "bg-[var(--color-signal)]" : "bg-[var(--color-border)]",
          )}
        />
      </span>
      <span
        className={cn(
          "w-24 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
          active ? "text-[color:var(--color-text-primary)]" : "text-[color:var(--color-text-muted)]",
        )}
      >
        {title}
      </span>
    </li>
  );
}

/* ----------------------------------------------------------------- shared */

function ActCopy({ act }: { act: PipelineAct }) {
  return (
    <div>
      <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-action)]">
        {act.number} / {act.title}
      </p>
      <h3 className="font-display mt-4 text-[length:var(--text-display-m)]">
        {act.summary}
      </h3>
      <p className="prose-measure mt-4 text-[color:var(--color-text-secondary)]">
        {act.body}
      </p>
    </div>
  );
}

/** The campaign object as it looks at this stage. */
function ActVisual({ act }: { act: PipelineAct }) {
  return (
    <div
      className={cn(
        "h-full rounded-[var(--radius-lg)] border border-[var(--color-border-hairline)]",
        "bg-[var(--color-surface-1)]",
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border-hairline)] px-4 py-3">
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
          Campaign · Deep sea / 7 days
        </span>
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          Stage {act.number}
        </span>
      </div>

      <dl className="p-4">
        {act.rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border-hairline)] py-3 last:border-b-0"
          >
            <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {row.label}
            </dt>
            <dd className="font-utility text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Mobile and reduced-motion layout. Identical content, zero scroll binding. */
function StackedActs() {
  return (
    <SectionContainer className="py-20">
      <ol className="flex flex-col gap-16">
        {pipelineActs.map((act) => (
          <li key={act.id} className="grid gap-6 md:grid-cols-2 md:gap-12">
            <ActCopy act={act} />
            <ActVisual act={act} />
          </li>
        ))}
      </ol>
    </SectionContainer>
  );
}
