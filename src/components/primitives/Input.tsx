import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Text input matching `Textarea` in `Field.tsx`.
 *
 * `min-h-11` is the 44px touch-target floor. The invalid state changes the
 * border *and* is paired with an icon-plus-text message by `Field`, so validity
 * is never communicated by colour alone.
 */
export function Input({
  className,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-11 w-full rounded-[var(--radius-sm)] border",
        "bg-[var(--color-surface-1)] px-4 py-3",
        "text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]",
        "placeholder:text-[color:var(--color-text-muted)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        invalid
          ? "border-[var(--color-error)]"
          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...rest}
    />
  );
}
