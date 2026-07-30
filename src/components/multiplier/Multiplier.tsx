"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { Button } from "@/components/primitives/Button";
import { Slider } from "@/components/primitives/Slider";
import { Disclosure } from "@/components/primitives/Disclosure";
import {
  DEFAULT_MULTIPLIER_STATE,
  FORMAT_KEYS,
  LIMITS,
  POSTS_PER_ACCOUNT_PER_DAY,
  buildGraph,
  computeCampaign,
  type FormatKey,
  type MultiplierState,
} from "@/lib/multiplier";
import { multiplier } from "@/content/multiplier";
import { FanOutGraph } from "./FanOutGraph";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/cn";

/**
 * S5 — The Multiplier. The section a visitor should remember.
 *
 * Its value is the *controls*, not the drawing: the moment someone raises
 * concepts from 3 to 6 and watches the totals move, they stop evaluating a
 * product and start planning their own use of it. Everything on screen is
 * computed by `computeCampaign` from the visitor's own settings — no server,
 * no fixtures, no invented figures.
 *
 * The drawing is `aria-hidden` and paired with a real structured list, which is
 * expanded by default on small screens.
 */
export function Multiplier() {
  const [state, setState] = useState<MultiplierState>(DEFAULT_MULTIPLIER_STATE);
  const [highlight, setHighlight] = useState<string | null>(null);

  // Slider thumbs stay responsive while a large graph rebuilds behind them.
  const deferred = useDeferredValue(state);

  const result = useMemo(() => computeCampaign(deferred), [deferred]);
  const graph = useMemo(() => buildGraph(deferred), [deferred]);

  const set = <K extends keyof MultiplierState>(
    key: K,
    value: MultiplierState[K],
  ) => {
    const next = { ...state, [key]: value };
    setState(next);
    // Emitted outside the updater: React may invoke an updater twice in
    // StrictMode, which would double-count every interaction.
    // Terminal fan-out size is the most valuable signal this page produces.
    const computed = computeCampaign(next);
    track("multiplier_interacted", "multiplier", {
      control:
        key === "hooksPerConcept"
          ? "hooks"
          : (key as "concepts" | "formats" | "languages" | "accounts"),
      assets: computed.assets,
      posts: computed.posts,
    });
  };

  const toggleFormat = (format: FormatKey) =>
    setState((prev) => {
      const has = prev.formats.includes(format);
      // Never allow zero formats — the campaign would produce nothing.
      if (has && prev.formats.length === 1) return prev;
      return {
        ...prev,
        formats: has
          ? prev.formats.filter((f) => f !== format)
          : [...prev.formats, format],
      };
    });

  const summary = [
    { label: "Brief", value: result.briefs },
    { label: "Concepts", value: result.concepts },
    { label: "Scripts", value: result.scripts },
    { label: "Assets", value: result.assets },
    { label: "Formats", value: result.formats },
    { label: "Accounts", value: result.accounts },
    { label: "Scheduled posts", value: result.posts },
  ];

  return (
    <MotionSection id="multiplier" surface="raised" aria-labelledby="multiplier-heading">
      <SectionContainer>
        <div className="max-w-[46rem]">
          <Eyebrow>{multiplier.eyebrow}</Eyebrow>
          <h2
            id="multiplier-heading"
            className="font-display mt-6 text-[length:var(--text-display-l)]"
          >
            {multiplier.headline}
          </h2>
          <p className="prose-measure mt-6 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
            {multiplier.body}
          </p>
        </div>

        <div className="mt-16 grid gap-8 lg:grid-cols-12">
          {/* Controls */}
          <div className="flex flex-col gap-8 lg:col-span-4">
            <Slider
              label="Concepts"
              value={state.concepts}
              min={LIMITS.concepts.min}
              max={LIMITS.concepts.max}
              unit="concepts"
              onChange={(v) => set("concepts", v)}
            />
            <Slider
              label="Hooks per concept"
              value={state.hooksPerConcept}
              min={LIMITS.hooksPerConcept.min}
              max={LIMITS.hooksPerConcept.max}
              unit="hooks per concept"
              onChange={(v) => set("hooksPerConcept", v)}
            />

            <fieldset>
              <legend
                className={cn(
                  "mb-3 font-utility uppercase",
                  "text-[length:var(--text-utility-xs)] tracking-[var(--tracking-eyebrow)]",
                  "text-[color:var(--color-text-secondary)]",
                )}
              >
                Formats
              </legend>
              <div className="flex flex-wrap gap-1">
                {FORMAT_KEYS.map((format) => {
                  const selected = state.formats.includes(format);
                  const isLast = selected && state.formats.length === 1;
                  return (
                    <button
                      key={format}
                      type="button"
                      aria-pressed={selected}
                      disabled={isLast}
                      title={isLast ? "At least one format is required" : undefined}
                      onClick={() => toggleFormat(format)}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] border px-3",
                        "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
                        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                        "disabled:cursor-not-allowed",
                        selected
                          ? "border-2 border-[var(--color-action)] bg-[var(--color-action-wash)] text-[color:var(--color-action)]"
                          : "border-[var(--color-border-hairline)] text-[color:var(--color-text-secondary)] hover:border-[var(--color-border)]",
                      )}
                    >
                      <span aria-hidden="true" className={selected ? "" : "opacity-0"}>
                        ✓
                      </span>
                      {format}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <Slider
              label="Languages"
              value={state.languages}
              min={LIMITS.languages.min}
              max={LIMITS.languages.max}
              unit="languages"
              onChange={(v) => set("languages", v)}
            />
            <Slider
              label="Connected accounts"
              value={state.accounts}
              min={LIMITS.accounts.min}
              max={LIMITS.accounts.max}
              unit="accounts"
              onChange={(v) => set("accounts", v)}
            />

            <div>
              <Button
                variant="secondary"
                onClick={() => setState(DEFAULT_MULTIPLIER_STATE)}
              >
                Reset
              </Button>
            </div>
          </div>

          {/* Graph + summary */}
          <div className="flex flex-col gap-6 lg:col-span-8">
            <FanOutGraph
              graph={graph}
              highlightColumn={highlight}
              onHighlight={setHighlight}
            />

            {graph.aggregated && (
              <p className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                {multiplier.aggregationNote}
              </p>
            )}

            <div
              className={cn(
                "rounded-[var(--radius-lg)] border border-[var(--color-border-hairline)]",
                "bg-[var(--color-surface-2)] p-6",
              )}
            >
              <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                {summary.map((item) => (
                  <div key={item.label}>
                    <dd className="font-display text-[length:var(--text-display-m)] tabular-nums text-[color:var(--color-text-primary)]">
                      {item.value}
                    </dd>
                    <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                      {item.label}
                    </dt>
                  </div>
                ))}
              </dl>

              <p className="mt-6 border-t border-[var(--color-border-hairline)] pt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                That is {result.postsPerAccount} posts per account, or{" "}
                {result.daysToPublish}{" "}
                {result.daysToPublish === 1 ? "day" : "days"} of publishing at{" "}
                {POSTS_PER_ACCOUNT_PER_DAY} posts per account per day.
              </p>

              {/* Announced once the value settles, not on every drag frame. */}
              <p className="sr-only" aria-live="polite">
                {result.assets} assets across {result.formats} formats for{" "}
                {result.accounts} accounts, {result.posts} scheduled posts.
              </p>
            </div>

            <p className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
              {multiplier.calculationNote}
            </p>
          </div>
        </div>

        {/* The accessible equivalent. Not a fallback — a second real view. */}
        <div className="mt-12">
          <Disclosure summary="View as a structured list">
            <StructuredTree state={deferred} />
          </Disclosure>
        </div>
      </SectionContainer>
    </MotionSection>
  );
}

/**
 * DOM equivalent of the graph. Capped at a readable depth: beyond that the
 * per-concept totals are stated numerically rather than enumerated, which is
 * how a person would read it aloud anyway.
 */
function StructuredTree({ state }: { state: MultiplierState }) {
  const result = computeCampaign(state);
  const assetsPerConcept = result.assets / result.concepts;

  return (
    <div className="text-[length:var(--text-body-s)]">
      <p className="mb-4 text-[color:var(--color-text-secondary)]">
        One brief produces {result.concepts} concepts and {result.assets} assets,
        scheduled as {result.posts} posts across {result.accounts} accounts.
      </p>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: result.concepts }, (_, i) => (
          <li key={i}>
            <span className="font-utility text-[color:var(--color-text-primary)]">
              Concept {i + 1}
            </span>
            <ul className="mt-1 pl-6">
              <li className="text-[color:var(--color-text-muted)]">
                {state.hooksPerConcept} hook
                {state.hooksPerConcept === 1 ? "" : "s"} ·{" "}
                {state.languages} language{state.languages === 1 ? "" : "s"} ·{" "}
                {state.formats.join(", ")}
              </li>
              <li className="text-[color:var(--color-text-muted)]">
                {assetsPerConcept} assets produced
              </li>
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
