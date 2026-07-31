"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/app-ui/Panel";
import { productionModeCopy } from "@/content/create";
import type { ProductionModeDefinition } from "@/lib/creative/modes";
import type { ProductionMode } from "@/lib/creative/types";

/**
 * The production-mode selector.
 *
 * Structurally its own surface, not a row of `ChoiceChip`s and not a generic
 * card grid: each option carries a price, a rationale and a composition list,
 * which is more than a chip can hold and is the information the choice actually
 * turns on. Cost per reel is the point of the control, so it is the largest
 * element in each option rather than a footnote.
 *
 * A native radio group, not buttons with `aria-pressed`. These options are
 * mutually exclusive and a radio group gives arrow-key navigation and correct
 * announcement for free; a row of toggle buttons would announce three
 * independent controls and require rebuilding roving focus by hand.
 *
 * Selection is signalled by border weight AND a checkmark, never by fill alone —
 * the palette's amber means "a human committed to this", and colour is never the
 * only carrier of state.
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
    <Panel>
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
          {productionModeCopy.heading}
        </legend>

        <p className="mt-[var(--space-2)] max-w-[60ch] text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-secondary)]">
          {productionModeCopy.hint}
        </p>

        <div className="mt-[var(--space-4)] grid gap-[var(--space-3)] md:grid-cols-3">
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
    </Panel>
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
          "flex h-full min-h-11 cursor-pointer flex-col rounded-[var(--radius-sm)] p-[var(--space-4)]",
          "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-focus)]",
          selected
            ? // Compensates for the extra border pixel so selecting an option
              // does not shift its neighbours.
              "border-2 border-[var(--color-action)] bg-[var(--color-action-wash)] p-[calc(var(--space-4)-1px)]"
            : "border border-[var(--color-border-hairline)] hover:border-[var(--color-border)]",
        )}
      >
        <span className="flex items-baseline justify-between gap-[var(--space-2)]">
          <span className="text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
            {mode.label}
          </span>

          {/* Shape redundancy for the selected state. Width is reserved so the
              row does not reflow on toggle. */}
          <span aria-hidden="true" className="w-4 shrink-0">
            {selected && (
              <Check size={14} strokeWidth={2.5} className="text-[color:var(--color-action)]" />
            )}
          </span>
        </span>

        {/* The price is the largest element because it is what the choice turns
            on. Tabular figures so switching modes does not jitter the column. */}
        <span className="mt-[var(--space-3)] flex items-baseline gap-[var(--space-2)]">
          <span className="font-utility text-[length:var(--text-metric)] tabular-nums text-[color:var(--color-text-primary)]">
            {mode.productionCredits}
          </span>
          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            {productionModeCopy.creditsSuffix}
          </span>
        </span>

        <span className="mt-[var(--space-3)] block text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-secondary)]">
          {mode.description}
        </span>

        <span className="mt-[var(--space-4)] block">
          <span className="block font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            {productionModeCopy.compositionHeading}
          </span>
          <ul className="mt-[var(--space-2)] flex flex-col gap-[var(--space-1)]">
            {mode.composition.map((line) => (
              <li
                key={line}
                className="text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]"
              >
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
          <span className="mt-[var(--space-4)] flex items-baseline justify-between gap-[var(--space-2)] border-t border-[var(--color-border-hairline)] pt-[var(--space-3)]">
            <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {productionModeCopy.batchLabel}
            </span>
            <span className="font-utility text-[length:var(--text-app-meta)] tabular-nums text-[color:var(--color-text-primary)]">
              {batchCredits.toLocaleString("en-US")}
            </span>
          </span>
        )}
      </label>
    </div>
  );
}
