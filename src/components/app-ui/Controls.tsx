"use client";

import { useId, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The dense product controls: labelled select, choice chip, toolbar button.
 *
 * These exist separately from `components/primitives` because the product needs
 * a visibly different density from the marketing site — a label sitting inside
 * the control rather than above it, so a row of three fits on one line without
 * a stack of floating labels. The primitives keep their own, roomier treatment.
 */

/**
 * A labelled select.
 *
 * A real `<select>`, not a custom listbox. Options here are single-line strings
 * with no secondary content, which is exactly what the native element handles —
 * and it brings mobile's native picker, type-ahead and the full keyboard
 * contract for free. `Switcher` owns the custom-listbox case, where two lines
 * per option genuinely rule the native element out.
 *
 * The label is rendered inside the control's border, above the value, matching
 * the reference's compact parameter row. It is still a real `<label>`.
 */
export function LabelledSelect({
  label,
  value,
  onChange,
  options,
  /** Leading glyph. Decorative — the label carries the meaning. */
  icon,
  name,
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly { id: string; label: string }[];
  icon?: ReactNode;
  name?: string;
  className?: string;
}) {
  const id = useId();

  return (
    <div
      className={cn(
        "group relative flex min-h-[3.5rem] items-center gap-[var(--space-3)]",
        "rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)]",
        "bg-[var(--color-surface-1)] px-[var(--space-3)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "hover:border-[var(--color-border)]",
        // The ring is drawn on the wrapper because the native select's own
        // focus ring would be clipped by the border radius above it.
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-focus)]",
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="shrink-0 text-[color:var(--color-text-muted)]">
          {icon}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <label
          htmlFor={id}
          className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]"
        >
          {label}
        </label>

        <select
          id={id}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "w-full cursor-pointer appearance-none bg-transparent",
            "text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]",
            // Suppressed here only because the wrapper draws an equivalent
            // ring via focus-within — never removed outright.
            "focus:outline-none",
          )}
        >
          {options.map((option) => (
            // Explicit colours: on Windows and Linux the popup is painted by
            // the OS with its own default palette, and inheriting there gives
            // dark text on a dark list.
            <option
              key={option.id}
              value={option.id}
              className="bg-[var(--color-surface-2)] text-[color:var(--color-text-primary)]"
            >
              {option.label}
            </option>
          ))}
        </select>
      </span>

      <ChevronDown
        aria-hidden="true"
        size={16}
        strokeWidth={1.5}
        className="shrink-0 text-[color:var(--color-text-muted)]"
      />
    </div>
  );
}

/**
 * A selectable chip — formats, channels, filters.
 *
 * Selection carries a border-weight change AND a checkmark, never colour alone.
 * `aria-pressed` makes it a toggle button rather than a link that looks like
 * one, so assistive technology reports the state rather than just the name.
 */
export function ChoiceChip({
  label,
  detail,
  selected,
  onToggle,
  /** Platform or format glyph. */
  icon,
  /** Marks the recommended default, e.g. "Auto". */
  badge,
  disabled = false,
  className,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onToggle: () => void;
  icon?: ReactNode;
  badge?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "flex min-h-11 items-center gap-[var(--space-3)] rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] text-left",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-2 border-[var(--color-action)] bg-[var(--color-action-wash)]"
          : "border border-[var(--color-border-hairline)] hover:border-[var(--color-border)]",
        // Compensates for the 1px the border gains when selected, so the chip
        // does not shift its neighbours as it toggles.
        selected ? "px-[calc(var(--space-3)-1px)] py-[calc(var(--space-2)-1px)]" : "",
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0",
            selected
              ? "text-[color:var(--color-action)]"
              : "text-[color:var(--color-text-muted)]",
          )}
        >
          {icon}
        </span>
      )}

      <span className="min-w-0">
        <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]">
          {label}
          {badge && (
            <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-action)]">
              {badge}
            </span>
          )}
        </span>
        {detail && (
          <span className="block font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
            {detail}
          </span>
        )}
      </span>

      {/* Shape redundancy for the selected state. Reserved width so the chip
          does not resize on toggle. */}
      <span aria-hidden="true" className="ml-auto w-4 shrink-0">
        {selected && (
          <Check size={14} strokeWidth={2.5} className="text-[color:var(--color-action)]" />
        )}
      </span>
    </button>
  );
}

/**
 * A small secondary action in a panel's toolbar — "Add URL", "Upload file".
 *
 * Distinct from `Button`: these sit in a row of peers inside a panel, so they
 * are quieter than a page-level secondary button and never carry a fill.
 */
export function ToolbarButton({
  children,
  icon,
  onClick,
  type = "button",
  disabled = false,
  /** Renders as the emphasised action in the row, without becoming a primary. */
  emphasis = false,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-11 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-3)]",
        "text-[length:var(--text-app-cell)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        emphasis
          ? "border border-[var(--color-border)] text-[color:var(--color-text-primary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
          : "border border-[var(--color-border-hairline)] text-[color:var(--color-text-secondary)] hover:border-[var(--color-border)] hover:text-[color:var(--color-text-primary)]",
        className,
      )}
    >
      {icon && <span aria-hidden="true" className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
