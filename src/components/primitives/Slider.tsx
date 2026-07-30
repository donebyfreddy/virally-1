"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Unit suffix announced to assistive tech, e.g. "concepts". */
  unit?: string;
  className?: string;
};

/**
 * Native `<input type="range">` with a token-styled track and a 44px thumb.
 *
 * Native is deliberate: it gives keyboard support, touch handling, screen
 * reader semantics and OS-level accessibility settings for free. A div-based
 * slider would need all four rebuilt and would get at least one wrong.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit,
  className,
}: SliderProps) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label
          htmlFor={id}
          className={cn(
            "font-utility uppercase",
            "text-[length:var(--text-utility-xs)] tracking-[var(--tracking-eyebrow)]",
            "text-[color:var(--color-text-secondary)]",
          )}
        >
          {label}
        </label>
        <output
          htmlFor={id}
          className="font-utility text-[length:var(--text-body-s)] tabular-nums text-[color:var(--color-text-primary)]"
        >
          {value}
        </output>
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={unit ? `${value} ${unit}` : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--slider-percent": `${percent}%` } as React.CSSProperties}
        className={cn(
          "h-11 w-full cursor-pointer appearance-none bg-transparent",
          // Track — filled portion in amber because the value is a user commitment.
          "[&::-webkit-slider-runnable-track]:h-1",
          "[&::-webkit-slider-runnable-track]:rounded-[var(--radius-sm)]",
          "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-action)_var(--slider-percent),var(--color-surface-3)_var(--slider-percent))]",
          "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-[var(--radius-sm)] [&::-moz-range-track]:bg-[var(--color-surface-3)]",
          "[&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-[var(--radius-sm)] [&::-moz-range-progress]:bg-[var(--color-action)]",
          // Thumb
          "[&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:-mt-2.5",
          "[&::-webkit-slider-thumb]:size-6",
          "[&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:border-2",
          "[&::-webkit-slider-thumb]:border-[var(--color-canvas)]",
          "[&::-webkit-slider-thumb]:bg-[var(--color-action)]",
          "[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--color-canvas)]",
          "[&::-moz-range-thumb]:bg-[var(--color-action)]",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      />
    </div>
  );
}
