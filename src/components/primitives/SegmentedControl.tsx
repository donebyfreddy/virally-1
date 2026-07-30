"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export type Segment<T extends string> = {
  value: T;
  label: string;
  /** Optional utility-role sublabel, e.g. a pixel dimension. */
  detail?: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
  label: string;
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/**
 * Accessible segmented control implementing the ARIA radiogroup pattern:
 * one tab stop for the group, arrow keys move and select within it.
 *
 * Selection is signalled by border weight AND a checkmark AND colour, so it
 * survives greyscale and colour-vision differences.
 */
export function SegmentedControl<T extends string>({
  label,
  segments,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);

  const enabled = segments.filter((s) => !s.disabled);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const currentIndex = enabled.findIndex((s) => s.value === value);
    let nextIndex = currentIndex;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (currentIndex + 1) % enabled.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = enabled.length - 1;
        break;
    }

    const next = enabled[nextIndex];
    if (!next) return;
    onChange(next.value);
    // Move focus with selection, as the radiogroup pattern requires.
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-segment="${next.value}"]`)
      ?.focus();
  }

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn("flex flex-wrap gap-1", className)}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-segment={segment.value}
            disabled={segment.disabled}
            // Roving tabindex: the group is a single tab stop.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(segment.value)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-4",
              "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
              "border transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
              "disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "border-2 border-[var(--color-action)] bg-[var(--color-action-wash)] text-[color:var(--color-action)]"
                : "border-[var(--color-border-hairline)] text-[color:var(--color-text-secondary)] hover:border-[var(--color-border)] hover:text-[color:var(--color-text-primary)]",
            )}
          >
            {/* Shape redundancy for the selected state. */}
            <span aria-hidden="true" className={selected ? "opacity-100" : "opacity-0"}>
              ✓
            </span>
            <span>{segment.label}</span>
            {segment.detail && (
              <span className="text-[color:var(--color-text-muted)] normal-case">
                {segment.detail}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
