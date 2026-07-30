"use client";

import { useEffect, useRef } from "react";
import { heroDemo } from "@/content/marketing";
import { StatusDot } from "@/components/primitives/StatusDot";
import { OutputFrame } from "./OutputFrame";
import { hasReached, type HeroBeat } from "./heroTimeline";
import type { RatioKey } from "@/components/motion/AspectRatioMorph";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The live campaign panel.
 *
 * Everything visible is real DOM driven by the shared timeline — there is no
 * screenshot and no video. The panel reserves its full height at SSR and
 * renders its settled state, so the layout never shifts and a visitor without
 * JavaScript still sees a complete, sensible campaign.
 */
export function CampaignCanvas({
  beat,
  elapsedRef,
  isPlaying,
}: {
  beat: HeroBeat;
  elapsedRef: React.RefObject<number>;
  isPlaying: boolean;
}) {
  const showConcepts = hasReached(beat, "concepts");
  const showOutputs = hasReached(beat, "outputs");
  const showPlatforms = hasReached(beat, "platforms");
  const rendered = hasReached(beat, "rendered");
  const scheduled = hasReached(beat, "scheduled");

  const status = !hasReached(beat, "generating")
    ? "planning"
    : rendered
      ? scheduled
        ? "scheduled"
        : "rendering"
      : "generating";

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-[var(--radius-lg)]",
        "border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)]",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
          "border-b border-[var(--color-border-hairline)] px-4 py-3",
        )}
      >
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
          Campaign · {heroDemo.campaignLabel}
        </span>
        <div className="flex items-center gap-4">
          <StatusDot status={status} />
          <ElapsedReadout elapsedRef={elapsedRef} isPlaying={isPlaying} />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-6 p-4">
        {/* Brief → concepts */}
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "shrink-0 rounded-[var(--radius-sm)] border px-2 py-1",
              "border-[var(--color-action)] bg-[var(--color-action-wash)]",
              "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
              "text-[color:var(--color-action)]",
            )}
          >
            Brief
          </span>

          <ul className="flex flex-1 flex-col gap-1.5">
            {heroDemo.concepts.map((concept, index) => (
              <li
                key={concept.id}
                className={cn(
                  "flex items-center gap-2",
                  "transition-opacity duration-[var(--dur-panel)] ease-[var(--ease-settle)]",
                  showConcepts ? "opacity-100" : "opacity-0",
                )}
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                {/* Connector: scaled, not width-animated. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-6 origin-left bg-[var(--color-border)]",
                    "transition-transform duration-[var(--dur-panel)] ease-[var(--ease-settle)]",
                    showConcepts ? "scale-x-100" : "scale-x-0",
                  )}
                  style={{ transitionDelay: `${index * 90}ms` }}
                />
                <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                  {concept.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Outputs */}
        <ul className="grid flex-1 grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-3">
          {heroDemo.outputs.map((output, index) => (
            <li
              key={output.id}
              className={cn(
                "flex flex-col gap-1.5",
                "transition-opacity duration-[var(--dur-panel)] ease-[var(--ease-settle)]",
                showOutputs ? "opacity-100" : "opacity-0",
              )}
              style={{ transitionDelay: `${index * 70}ms` }}
            >
              <OutputFrame
                ratio={output.format as RatioKey}
                seed={index + 1}
                rendered={rendered}
              />
              <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                {output.format} · {output.kind}
              </span>
              <span
                className={cn(
                  "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
                  "transition-opacity duration-[var(--dur-base)] ease-[var(--ease-cut)]",
                  showPlatforms
                    ? "text-[color:var(--color-text-secondary)] opacity-100"
                    : "opacity-0",
                )}
              >
                <span aria-hidden="true">◉</span> {output.platform}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
          "border-t border-[var(--color-border-hairline)] px-4 py-3",
        )}
      >
        <span
          className={cn(
            "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
            "transition-opacity duration-[var(--dur-base)] ease-[var(--ease-cut)]",
            scheduled
              ? "text-[color:var(--color-text-secondary)] opacity-100"
              : "opacity-0",
          )}
        >
          ▸ {heroDemo.scheduledCount} posts scheduled · {heroDemo.channelCount}{" "}
          channels
        </span>
        <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          {heroDemo.disclosure}
        </span>
      </div>

      {/* Text equivalent — the panel's information never lives only in layout. */}
      <div className="sr-only">
        <h2>Campaign demonstration: {heroDemo.campaignLabel}</h2>
        <p>
          One brief produces {heroDemo.concepts.length} concepts and{" "}
          {heroDemo.outputs.length} platform-ready outputs across{" "}
          {heroDemo.channelCount} channels, totalling{" "}
          {heroDemo.scheduledCount} scheduled posts.
        </p>
        <ul>
          {heroDemo.concepts.map((concept) => (
            <li key={concept.id}>
              {concept.label}
              <ul>
                {heroDemo.outputs
                  .filter((o) => o.concept === concept.id)
                  .map((o) => (
                    <li key={o.id}>
                      {o.kind}, {o.format}, {o.platform}, {o.hook}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Elapsed-render readout. Reads the shared clock in its own frame loop and
 * writes text directly, so a ticking timecode never re-renders the panel.
 */
function ElapsedReadout({
  elapsedRef,
  isPlaying,
}: {
  elapsedRef: React.RefObject<number>;
  isPlaying: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const write = () => {
      // Scaled so the 15s loop reads as a plausible multi-minute render.
      node.textContent = formatTimecode(elapsedRef.current * 17);
    };

    write();
    if (!isPlaying) return;

    let frame = 0;
    const tick = () => {
      write();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [elapsedRef, isPlaying]);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="font-utility tabular-nums text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]"
    >
      00:00:00
    </span>
  );
}
