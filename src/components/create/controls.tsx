"use client";

import { useId, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Shared form primitives for the create-page composers.
 *
 * Extracted once a second composer (Quick Content) needed the exact same
 * label, select, number and chip treatment as the campaign composer — before
 * that there was one caller and no shared module to keep in sync, which is
 * why these lived inline in Composer.tsx. They still carry its original
 * caveat: this density and type treatment belongs to the marketing-adjacent
 * create surface, not the light product system's shared controls.
 */

export const labelClasses =
  "text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]";
export const hintClasses = "text-[length:var(--text-app-label)] text-[color:var(--text-muted)]";

/**
 * The shared control shell: 36px, one radius, one border, one focus ring.
 *
 * `font-family: inherit` is explicit because form controls do not inherit the
 * page font by default — without it a `<select>` renders in the platform UI
 * font beside inputs that render in Geist.
 */
export const controlClasses = cn(
  "h-9 w-full rounded-[var(--radius-control)] border border-[var(--border-default)]",
  "bg-[var(--surface-primary)] px-[var(--space-3)]",
  "[font-family:inherit] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]",
  "transition-colors duration-[var(--dur-instant)]",
  "hover:border-[var(--border-strong)]",
  "focus:border-[var(--brand-primary)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--focus-ring)]",
);

/**
 * A labelled select.
 *
 * A real `<select>`, not a custom listbox. Options are single-line strings
 * with no secondary content, which is exactly what the native element handles
 * — and it brings the mobile picker, type-ahead and the whole keyboard
 * contract for free.
 */
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: readonly { id: T; label: string }[];
  hint?: string;
}) {
  const id = useId();

  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
      <label htmlFor={id} className={labelClasses}>
        {label}
      </label>

      <div className="relative flex items-center">
        <select
          id={id}
          value={value}
          aria-describedby={hint ? `${id}-hint` : undefined}
          // A select's value is always one of the options it was given, which is
          // what the generic parameter states; the DOM only knows `string`.
          onChange={(event) => onChange(event.target.value as T)}
          className={cn(controlClasses, "cursor-pointer appearance-none pr-[var(--space-8)]")}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <ChevronDown
          aria-hidden="true"
          size={14}
          strokeWidth={1.75}
          className="pointer-events-none absolute right-[var(--space-3)] text-[color:var(--text-muted)]"
        />
      </div>

      {hint && (
        <p id={`${id}-hint`} className={hintClasses}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint: string;
  onChange: (next: number) => void;
}) {
  const id = useId();

  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
      <label htmlFor={id} className={labelClasses}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          const next = Number(event.target.value);
          // Clamped on input rather than on submit: an out-of-range value would
          // otherwise silently change the estimate the user is reading.
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.trunc(next))));
        }}
        className={cn(controlClasses, "app-figure")}
      />
      <p id={`${id}-hint`} className={hintClasses}>
        {hint}
      </p>
    </div>
  );
}

/**
 * A selectable chip — formats, channels, optional outputs.
 *
 * `aria-pressed` makes it a toggle button rather than a link that looks like
 * one, so assistive technology reports the state and not just the name.
 * Selection carries a border colour AND a wash AND a checkmark, never colour
 * alone.
 *
 * 32px tall and text-labelled, so its target clears SC 2.5.8 on width; the
 * 44px inset is reserved for the icon-only controls that genuinely need it.
 */
export function ToggleChip({
  label,
  detail,
  icon,
  selected,
  onToggle,
}: {
  label: string;
  detail?: string;
  icon?: ReactNode;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-8 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] border",
        "px-[var(--space-3)] text-[length:var(--text-app-cell)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        selected
          ? "border-[var(--brand-primary)] bg-[var(--brand-soft)] text-[color:var(--brand-ink)]"
          : cn(
              "border-[var(--border-default)] bg-[var(--surface-primary)]",
              "text-[color:var(--text-secondary)]",
              "hover:border-[var(--border-strong)] hover:text-[color:var(--text-primary)]",
            ),
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0",
            selected ? "text-[color:var(--brand-mark)]" : "text-[color:var(--text-muted)]",
          )}
        >
          {icon}
        </span>
      )}

      <span className="whitespace-nowrap">
        {label}
        {detail && (
          <span
            className={cn(
              "ml-[var(--space-2)] text-[length:var(--text-app-label)]",
              selected ? "text-[color:var(--brand-ink)]" : "text-[color:var(--text-muted)]",
            )}
          >
            {detail}
          </span>
        )}
      </span>

      {/* Shape redundancy for the selected state, with the width reserved so the
          chip does not resize on toggle. */}
      <span aria-hidden="true" className="w-3.5 shrink-0">
        {selected && (
          <Check size={13} strokeWidth={2.5} className="text-[color:var(--brand-mark)]" />
        )}
      </span>
    </button>
  );
}
