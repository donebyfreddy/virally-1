"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { Button } from "@/components/primitives/Button";
import { Disclosure } from "@/components/primitives/Disclosure";
import { SegmentedControl } from "@/components/primitives/SegmentedControl";
import { RUNTIME_SECONDS, laboratory, variants } from "@/content/laboratory";
import { useReducedMotionPreference } from "@/lib/motion/useReducedMotionPreference";
import { formatDuration } from "@/lib/format";
import { RetentionChart } from "./RetentionChart";
import { cn } from "@/lib/cn";

type VariantId = (typeof variants)[number]["id"];

/**
 * S8 — the virality laboratory.
 *
 * `currentTime` has exactly one owner: this component. The scrubber writes to
 * it, the chart writes to it, and both read from it. Giving each surface its
 * own copy is how bidirectional bindings end up in a feedback loop.
 *
 * No real footage exists yet, so the "player" is a synthetic frame preview
 * driven by the same clock. It is labelled as a model rather than dressed up
 * as a recording. [REAL PERFORMANCE DATA REQUIRED]
 */
export function Laboratory() {
  const [variantId, setVariantId] = useState<VariantId>("hook-b");
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const prefersReduced = useReducedMotionPreference();

  const variant = useMemo(
    () => variants.find((v) => v.id === variantId) ?? variants[0],
    [variantId],
  );

  const frameRef = useRef(0);
  const lastRef = useRef(0);

  useEffect(() => {
    if (!playing) return;
    lastRef.current = performance.now();

    const tick = (now: number) => {
      const delta = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setCurrentTime((prev) => {
        const next = prev + delta;
        if (next >= RUNTIME_SECONDS) {
          setPlaying(false);
          return RUNTIME_SECONDS;
        }
        return next;
      });
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing]);

  /** Pause when the tab is hidden — playback nobody can see is wasted work. */
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const seek = useCallback((t: number) => {
    setCurrentTime(Math.min(RUNTIME_SECONDS, Math.max(0, t)));
  }, []);

  /** Arrow keys step between annotated events, the meaningful unit. */
  const stepEvent = useCallback(
    (direction: 1 | -1) => {
      const times = variant.events.map((e) => e.t);
      const next =
        direction === 1
          ? times.find((t) => t > currentTime + 0.01)
          : [...times].reverse().find((t) => t < currentTime - 0.01);
      if (next !== undefined) {
        seek(next);
        setActiveEventId(variant.events.find((e) => e.t === next)?.id ?? null);
      }
    },
    [variant.events, currentTime, seek],
  );

  const currentEvent =
    variant.events.find((e) => e.id === activeEventId) ??
    [...variant.events].reverse().find((e) => e.t <= currentTime) ??
    variant.events[0];

  const retentionNow = interpolate(variant.curve, currentTime);

  return (
    <MotionSection id="results" aria-labelledby="lab-heading">
      <SectionContainer>
        <div className="max-w-[46rem]">
          <Eyebrow>{laboratory.eyebrow}</Eyebrow>
          <h2 id="lab-heading" className="font-display mt-6 text-[length:var(--text-display-l)]">
            {laboratory.headline}
          </h2>
          <p className="prose-measure mt-6 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
            {laboratory.body}
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-12">
          {/* Frame preview + transport */}
          <div className="lg:col-span-3">
            <div
              className={cn(
                "relative overflow-hidden rounded-[var(--radius-lg)]",
                "border border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
              )}
              style={{ aspectRatio: "9 / 16" }}
            >
              <div
                aria-hidden="true"
                className="absolute aspect-square rounded-full bg-[var(--color-text-muted)] opacity-30 transition-none"
                style={{
                  width: `${34 + (currentTime / RUNTIME_SECONDS) * 18}%`,
                  left: "50%",
                  top: `${32 + Math.sin(currentTime / 2) * 6}%`,
                  transform: "translate(-50%, -50%)",
                }}
              />
              <div
                aria-hidden="true"
                className="absolute inset-x-3 bottom-16 flex flex-col gap-1"
              >
                <span className="h-2 w-full rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] opacity-70" />
                <span className="h-2 w-2/3 rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] opacity-40" />
              </div>
              <span className="absolute left-3 top-3 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                9:16 · MODEL
              </span>
              {/* Mute state is always visible, even with no audio track. */}
              <span className="absolute right-3 top-3 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                MUTED
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setPlaying((p) => !p)}
                aria-pressed={playing}
                iconLeading={
                  playing ? (
                    <Pause aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Play aria-hidden="true" className="size-3.5" />
                  )
                }
              >
                {playing ? "Pause" : "Play"}
              </Button>
              <span className="font-utility tabular-nums text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                {formatDuration(currentTime)} / {formatDuration(RUNTIME_SECONDS)}
              </span>
            </div>

            <label className="mt-3 block">
              <span className="sr-only">Scrub playback position</span>
              <input
                type="range"
                min={0}
                max={RUNTIME_SECONDS}
                step={0.1}
                value={currentTime}
                aria-valuetext={`${formatDuration(currentTime)}, retention ${Math.round(retentionNow)} percent`}
                onChange={(e) => seek(Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    stepEvent(e.key === "ArrowRight" ? 1 : -1);
                  }
                }}
                className={cn(
                  "h-11 w-full cursor-pointer appearance-none bg-transparent",
                  "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-[var(--radius-sm)]",
                  "[&::-webkit-slider-runnable-track]:bg-[var(--color-surface-3)]",
                  "[&::-webkit-slider-thumb]:-mt-2.5 [&::-webkit-slider-thumb]:size-6",
                  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
                  "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--color-canvas)]",
                  "[&::-webkit-slider-thumb]:bg-[var(--color-signal)]",
                  "[&::-moz-range-track]:h-1 [&::-moz-range-track]:bg-[var(--color-surface-3)]",
                  "[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full",
                  "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-canvas)]",
                  "[&::-moz-range-thumb]:bg-[var(--color-signal)]",
                )}
              />
            </label>
            <p className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
              Arrow keys step between marked events.
            </p>
          </div>

          {/* Chart */}
          <div className="lg:col-span-6">
            <RetentionChart
              variant={variant}
              currentTime={currentTime}
              onSeek={seek}
              activeEventId={activeEventId ?? currentEvent?.id ?? null}
              onEventFocus={setActiveEventId}
            />

            <div className="mt-6">
              <SegmentedControl
                label="Hook variant"
                value={variantId}
                onChange={(v) => {
                  setVariantId(v);
                  setActiveEventId(null);
                }}
                segments={variants.map((v) => ({
                  value: v.id,
                  label: v.label,
                  detail: `${v.completion}%`,
                }))}
              />
            </div>
          </div>

          {/* Event readout + meta */}
          <div className="lg:col-span-3">
            {currentEvent && (
              <div
                className={cn(
                  "rounded-[var(--radius-lg)] border p-4",
                  "border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
                )}
              >
                <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-action)]">
                  {formatDuration(currentEvent.t)} · {currentEvent.label}
                </p>
                <p className="mt-2 font-utility tabular-nums text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                  {currentEvent.retentionBefore}% → {currentEvent.retentionAfter}%
                </p>
                <p className="mt-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                  {currentEvent.explanation}
                </p>
              </div>
            )}

            <dl className="mt-6">
              {(
                [
                  ["Platform", laboratory.meta.platform],
                  ["Format", laboratory.meta.format],
                  ["Account", laboratory.meta.account],
                  ["Variant", variant.label],
                  ["Completion", `${variant.completion}%`],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-4 border-t border-[var(--color-border-hairline)] py-2"
                >
                  <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                    {label}
                  </dt>
                  <dd className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-secondary)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <p className="mt-8 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          ⓘ {laboratory.disclosure}
          {prefersReduced && " Playback is paused by default in reduced-motion mode."}
        </p>

        {/* Text equivalent for the chart. */}
        <div className="mt-6">
          <Disclosure summary="Retention data as a table">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-left">
                <caption className="sr-only">
                  Retention percentage over time for {variant.label}
                </caption>
                <thead>
                  <tr className="border-b border-[var(--color-border-hairline)]">
                    <th scope="col" className="py-2 font-utility text-[length:var(--text-utility-xs)] uppercase text-[color:var(--color-text-muted)]">Time</th>
                    <th scope="col" className="py-2 font-utility text-[length:var(--text-utility-xs)] uppercase text-[color:var(--color-text-muted)]">Retention</th>
                    <th scope="col" className="py-2 font-utility text-[length:var(--text-utility-xs)] uppercase text-[color:var(--color-text-muted)]">Event</th>
                  </tr>
                </thead>
                <tbody>
                  {variant.curve.map((point) => {
                    const event = variant.events.find((e) => e.t === point.t);
                    return (
                      <tr key={point.t} className="border-b border-[var(--color-border-hairline)]">
                        <td className="py-1.5 font-utility tabular-nums text-[length:var(--text-utility-xs)]">
                          {formatDuration(point.t)}
                        </td>
                        <td className="py-1.5 font-utility tabular-nums text-[length:var(--text-utility-xs)]">
                          {point.retention}%
                        </td>
                        <td className="py-1.5 text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                          {event?.label ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </div>

        {/* The argument, in prose. */}
        <div className="mt-16 max-w-[46rem]">
          <h3 className="font-display text-[length:var(--text-display-m)]">
            {laboratory.explanation.heading}
          </h3>
          {laboratory.explanation.paragraphs.map((paragraph) => (
            <p
              key={paragraph.slice(0, 32)}
              className="prose-measure mt-4 text-[color:var(--color-text-secondary)]"
            >
              {paragraph}
            </p>
          ))}
        </div>
      </SectionContainer>
    </MotionSection>
  );
}

/** Linear interpolation between sampled curve points. */
function interpolate(
  curve: readonly { t: number; retention: number }[],
  t: number,
): number {
  if (t <= curve[0].t) return curve[0].retention;
  const last = curve[curve.length - 1];
  if (t >= last.t) return last.retention;

  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1];
    const b = curve[i];
    if (t <= b.t) {
      const ratio = (t - a.t) / (b.t - a.t);
      return a.retention + (b.retention - a.retention) * ratio;
    }
  }
  return last.retention;
}
