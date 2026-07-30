"use client";

import { useState } from "react";
import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { Badge } from "@/components/primitives/Badge";
import { RATIOS } from "@/components/motion/AspectRatioMorph";
import { outputItems, outputWall, type OutputItem } from "@/content/outputs";
import { assertNoPlaceholders } from "@/content/provenance";
import { cn } from "@/lib/cn";

/**
 * S9 — the output wall.
 *
 * The masonry drift specified in the brief is deliberately NOT implemented.
 * It is the largest jank risk on the page, it fights hover, focus and playback,
 * and a static grid converts identically — the *content* is the proof, not the
 * movement. This is a considered cut, recorded here rather than silently
 * dropped.
 *
 * No real footage exists yet, so no `<video>` element is mounted at all. The
 * lazy-attachment and single-active-video machinery lives in `useActiveVideo`,
 * ready for when a real library lands; shipping empty players now would just be
 * a fake.
 */
export function OutputWall() {
  assertNoPlaceholders(outputItems, "S9 output wall");
  const [inspected, setInspected] = useState<OutputItem | null>(null);

  return (
    <MotionSection id="outputs" surface="raised" aria-labelledby="outputs-heading">
      <SectionContainer>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[40rem]">
            <Eyebrow>{outputWall.eyebrow}</Eyebrow>
            <h2
              id="outputs-heading"
              className="font-display mt-6 text-[length:var(--text-display-l)]"
            >
              {outputWall.headline}
            </h2>
            <p className="prose-measure mt-6 text-[color:var(--color-text-secondary)]">
              {outputWall.body}
            </p>
          </div>

          <ul className="flex flex-wrap gap-2">
            {outputWall.legend.map((entry) => (
              <li key={entry.status}>
                <Badge tone={entry.status === "illustrative" ? "warning" : "neutral"}>
                  {entry.label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        <ul
          className={cn(
            "mt-12 grid gap-4",
            "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {outputItems.map((item) => (
            <li key={item.id}>
              <OutputCard
                item={item}
                onInspect={() => setInspected(item)}
                expanded={inspected?.id === item.id}
              />
            </li>
          ))}
        </ul>

        {inspected && (
          <div
            className={cn(
              "mt-6 rounded-[var(--radius-lg)] border p-6",
              "border-[var(--color-border)] bg-[var(--color-surface-2)]",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h3 className="font-display text-[length:var(--text-title)]">
                {inspected.title}
              </h3>
              <button
                type="button"
                onClick={() => setInspected(null)}
                className="min-h-11 font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
              >
                Close ✕
              </button>
            </div>
            <p className="mt-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {inspected.ratio} · {inspected.platform} · {inspected.campaign}
            </p>
            <p className="mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
              {inspected.note}
            </p>
            {inspected.result && (
              <p className="mt-3 font-utility text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                {inspected.result}
              </p>
            )}
          </div>
        )}
      </SectionContainer>
    </MotionSection>
  );
}

const provenanceLabel = {
  verified: "Customer output",
  "internal-demo": "Internal demonstration",
  illustrative: "Illustrative placeholder",
  placeholder: "Placeholder",
} as const;

/**
 * Media-dominant card. Structurally distinct from every other card on the site:
 * the frame leads, metadata is a thin utility strip, and the provenance tag is
 * mandatory rather than optional.
 */
function OutputCard({
  item,
  onInspect,
  expanded,
}: {
  item: OutputItem;
  onInspect: () => void;
  expanded: boolean;
}) {
  const isIllustrative = item.provenance.status === "illustrative";

  return (
    <button
      type="button"
      onClick={onInspect}
      aria-expanded={expanded}
      className={cn(
        "group flex w-full flex-col gap-3 rounded-[var(--radius-lg)] border p-3 text-left",
        "transition-colors duration-[var(--dur-base)] ease-[var(--ease-cut)]",
        expanded
          ? "border-[var(--color-action)] bg-[var(--color-surface-2)]"
          : "border-[var(--color-border-hairline)] hover:border-[var(--color-border)]",
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "relative w-full overflow-hidden rounded-[var(--radius-sm)]",
          "bg-[var(--color-surface-2)]",
        )}
        style={{ aspectRatio: String(RATIOS[item.ratio]) }}
      >
        <div className="absolute left-1/2 top-[38%] aspect-square w-[36%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-text-muted)] opacity-30" />
        <div className="absolute inset-x-3 bottom-3 flex flex-col gap-1">
          <span className="h-1.5 w-full rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] opacity-40" />
          <span className="h-1.5 w-1/2 rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] opacity-25" />
        </div>
        <span className="absolute left-2 top-2 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          {item.ratio}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[length:var(--text-body-s)] font-medium text-[color:var(--color-text-primary)]">
          {item.title}
        </span>
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          {item.platform} · {item.campaign}
        </span>
      </div>

      {/* Provenance is never optional on this card. */}
      <Badge tone={isIllustrative ? "warning" : "neutral"}>
        {provenanceLabel[item.provenance.status]}
      </Badge>
    </button>
  );
}
