"use client";

import { useState } from "react";
import { m } from "framer-motion";
import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { SegmentedControl } from "@/components/primitives/SegmentedControl";
import { RATIOS } from "@/components/motion/AspectRatioMorph";
import { formatEngine, formats } from "@/content/formats";
import { duration, ease } from "@/lib/motion/tokens";
import type { FormatKey } from "@/lib/multiplier";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/cn";

const STAGE_HEIGHT = 400;

/**
 * S6 — the format engine.
 *
 * Answers the strongest objection in the category: "it will just crop my video
 * badly." The demo therefore has to show the subject and caption *moving*, not
 * a frame changing shape around static content — the latter is exactly the
 * blind crop we are arguing against.
 *
 * The frame is sized by width inside a fixed-height stage, so morphing never
 * reflows the surrounding layout.
 */
export function FormatEngine() {
  const [active, setActive] = useState<FormatKey>("9:16");
  const format = formats.find((f) => f.key === active) ?? formats[0];
  const width = STAGE_HEIGHT * RATIOS[active];

  return (
    <MotionSection id="formats" aria-labelledby="formats-heading">
      <SectionContainer>
        <div className="max-w-[46rem]">
          <Eyebrow>{formatEngine.eyebrow}</Eyebrow>
          <h2
            id="formats-heading"
            className="font-display mt-6 text-[length:var(--text-display-l)]"
          >
            {formatEngine.headline}
          </h2>
          <p className="prose-measure mt-6 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
            {formatEngine.body}
          </p>
        </div>

        <div className="mt-12">
          <SegmentedControl
            label={formatEngine.selectorLabel}
            value={active}
            onChange={(value) => {
              setActive(value);
              track("format_selected", "formats", { format: value });
            }}
            segments={formats.map((f) => ({
              value: f.key,
              label: f.label,
              detail: f.pixels,
            }))}
          />
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-12">
          {/* Stage */}
          <div className="lg:col-span-7">
            <div
              className="flex w-full items-center justify-center overflow-hidden"
              style={{ height: STAGE_HEIGHT }}
            >
              <m.div
                animate={{ width, height: STAGE_HEIGHT }}
                transition={{ duration: duration.panel, ease: ease.settle }}
                className={cn(
                  "relative max-w-full overflow-hidden rounded-[var(--radius-lg)]",
                  "border border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
                )}
              >
                {/* Safe area guide */}
                <div className="absolute inset-[6%] rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] opacity-40" />

                {/* Subject — genuinely repositioned per format. */}
                <m.div
                  animate={{
                    left: `${format.subject.x}%`,
                    top: `${format.subject.y}%`,
                    width: `${format.subject.size}%`,
                  }}
                  transition={{ duration: duration.panel, ease: ease.settle }}
                  className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-text-muted)] opacity-40"
                />

                {/* Caption band — width and position both change. */}
                <m.div
                  animate={{
                    top: `${format.caption.y}%`,
                    width: `${format.caption.width}%`,
                  }}
                  transition={{ duration: duration.panel, ease: ease.settle }}
                  className="absolute left-1/2 flex -translate-x-1/2 flex-col gap-1"
                >
                  <span className="h-2 w-full rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] opacity-70" />
                  <span className="h-2 w-2/3 rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] opacity-40" />
                </m.div>

                <span className="absolute left-3 top-3 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                  {format.label} · {format.pixels}
                </span>
              </m.div>
            </div>
          </div>

          {/* What actually changed */}
          <div className="lg:col-span-5">
            <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
              {format.usedFor}
            </p>

            <dl className="mt-6">
              {(
                [
                  ["Subject", format.recomposition.subject],
                  ["Caption", format.recomposition.caption],
                  ["Safe area", format.recomposition.safeArea],
                  ["Call to action", format.recomposition.cta],
                  ["Runtime", format.recomposition.runtime],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="border-t border-[var(--color-border-hairline)] py-3"
                >
                  <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                    {label}
                  </dt>
                  <dd className="mt-1 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <p className="prose-measure mt-12 text-[color:var(--color-text-secondary)]">
          {formatEngine.explanation}
        </p>
      </SectionContainer>
    </MotionSection>
  );
}
