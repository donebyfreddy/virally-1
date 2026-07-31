"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { productionModeCopy } from "@/content/create";
import type { ProductionModeDefinition } from "@/lib/creative/modes";
import type { ProductionMode } from "@/lib/creative/types";

/**
 * The production-mode selector.
 *
 * Structurally its own surface, not a row of chips and not a generic card grid:
 * each option carries a price, a rationale and a composition list, which is more
 * than a chip can hold and is the information the choice actually turns on. Cost
 * per reel is the point of the control, so it is the largest element in each
 * option rather than a footnote.
 *
 * A native radio group, not buttons with `aria-pressed`. These options are
 * mutually exclusive and a radio group gives arrow-key navigation and correct
 * announcement for free; a row of toggle buttons would announce three
 * independent controls and require rebuilding roving focus by hand.
 *
 * Selection is signalled by border weight AND background AND a checkmark, never
 * by fill alone — colour is never the only carrier of state.
 */
export function ProductionModePanel({
  modes,
  selected,
  onSelect,
  /**
   * Credits this batch costs in each mode, keyed by mode id.
   *
   * Passed in rather than computed here so the figure comes from the same
   * estimator the server reserves against. A second calculation in the UI would
   * eventually disagree with the one that charges.
   */
  batchCredits,
  /** True when no provider is configured and nothing will actually be billed. */
  unmetered,
}: {
  modes: readonly ProductionModeDefinition[];
  selected: ProductionMode;
  onSelect: (mode: ProductionMode) => void;
  batchCredits: Readonly<Record<ProductionMode, number>>;
  unmetered: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={productionModeCopy.heading}
        description={productionModeCopy.hint}
        as="h2"
      />

      <CardBody className="pt-[var(--space-4)]">
        <fieldset className="min-w-0 border-0 p-0">
          {/* The legend repeats the card title for assistive technology, which
              reads a fieldset by its legend and would otherwise announce three
              unlabelled radios. Hidden visually because the title is already
              on screen directly above. */}
          <legend className="sr-only">{productionModeCopy.heading}</legend>

          <div className="grid gap-[var(--space-3)] lg:grid-cols-3">
            {modes.map((mode) => (
              <ModeOption
                key={mode.id}
                mode={mode}
                selected={selected === mode.id}
                onSelect={() => onSelect(mode.id)}
                batchCredits={batchCredits[mode.id] ?? 0}
                unmetered={unmetered}
              />
            ))}
          </div>
        </fieldset>
      </CardBody>
    </Card>
  );
}

function ModeOption({
  mode,
  selected,
  onSelect,
  batchCredits,
  unmetered,
}: {
  mode: ProductionModeDefinition;
  selected: boolean;
  onSelect: () => void;
  batchCredits: number;
  unmetered: boolean;
}) {
  const inputId = `production-mode-${mode.id}`;

  return (
    <div className="min-w-0">
      {/* The input is visually hidden rather than removed: it stays in the
          accessibility tree and the tab order, and the label below is its
          clickable surface. `sr-only` keeps the focus ring reachable, which is
          drawn on the label via peer-focus-visible. */}
      <input
        type="radio"
        id={inputId}
        name="productionMode"
        value={mode.id}
        checked={selected}
        onChange={onSelect}
        className="peer sr-only"
      />

      <label
        htmlFor={inputId}
        className={cn(
          "flex h-full cursor-pointer flex-col rounded-[var(--radius-control)] p-[var(--space-4)]",
          "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring)]",
          selected
            ? // Compensates for the extra border pixel so selecting an option
              // does not shift its neighbours.
              "border-2 border-[var(--brand-primary)] bg-[var(--brand-soft)] p-[calc(var(--space-4)-1px)]"
            : "border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-secondary)]",
        )}
      >
        <span className="flex items-baseline justify-between gap-[var(--space-2)]">
          <span
            className={cn(
              "app-card-title",
              selected ? "text-[color:var(--brand-ink)]" : "text-[color:var(--text-primary)]",
            )}
          >
            {mode.label}
          </span>

          {/* Shape redundancy for the selected state. Width is reserved so the
              row does not reflow on toggle. */}
          <span aria-hidden="true" className="w-4 shrink-0">
            {selected && (
              <Check size={14} strokeWidth={2.5} className="text-[color:var(--brand-mark)]" />
            )}
          </span>
        </span>

        {/* The price is the largest element because it is what the choice turns
            on. Tabular figures so switching modes does not jitter the column. */}
        <span className="mt-[var(--space-3)] flex items-baseline gap-[var(--space-2)]">
          <span className="app-figure text-[length:var(--text-metric)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
            {mode.productionCredits}
          </span>
          <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {productionModeCopy.creditsSuffix}
          </span>
        </span>

        <span className="mt-[var(--space-2)] block text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
          {mode.description}
        </span>

        <span className="mt-[var(--space-4)] mb-[var(--space-4)] block">
          <span className="block text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]">
            {productionModeCopy.compositionHeading}
          </span>
          <ul className="mt-[var(--space-2)] flex flex-col gap-1">
            {mode.composition.map((line) => (
              <li
                key={line}
                className="flex gap-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]"
              >
                <span aria-hidden="true">·</span>
                {line}
              </li>
            ))}
          </ul>
        </span>

        {/* The batch total sits last: the per-reel price is how the modes are
            compared, the batch total is the consequence of the current shape.
            Suppressed entirely when nothing will be billed, rather than shown
            as a cost the user will not incur. */}
        {!unmetered && (
          <span className="mt-auto flex items-baseline justify-between gap-[var(--space-2)] border-t border-[var(--border-subtle)] pt-[var(--space-3)]">
            <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              {productionModeCopy.batchLabel}
            </span>
            <span className="app-figure text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
              {batchCredits.toLocaleString("en-US")}
            </span>
          </span>
        )}
      </label>
    </div>
  );
}
