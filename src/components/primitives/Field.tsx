"use client";

import { useId, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type FieldProps = {
  label: string;
  /** Persistent helper text. Essential instructions never live in a placeholder. */
  hint?: ReactNode;
  error?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
  /** Visible trailing hint such as a keyboard shortcut. */
  adornment?: ReactNode;
  className?: string;
};

/**
 * Label + hint + error wrapper. Wiring `aria-describedby` here rather than in
 * each field means an error message can never be added without also being
 * announced.
 */
export function Field({
  label,
  hint,
  error,
  children,
  adornment,
  className,
}: FieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label
          htmlFor={inputId}
          className={cn(
            "font-utility uppercase",
            "text-[length:var(--text-utility-xs)] tracking-[var(--tracking-eyebrow)]",
            "text-[color:var(--color-text-secondary)]",
          )}
        >
          {label}
        </label>
        {adornment && (
          <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
            {adornment}
          </span>
        )}
      </div>

      {children({ inputId, describedBy })}

      {hint && (
        <p
          id={hintId}
          className="text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]"
        >
          {hint}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-2 text-[length:var(--text-body-s)] text-[color:var(--color-error)]"
        >
          {/* Icon + text: never colour alone. */}
          <span aria-hidden="true">▲</span>
          {error}
        </p>
      )}
    </div>
  );
}

export function Textarea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full resize-none rounded-[var(--radius-sm)]",
        "border bg-[var(--color-surface-1)] p-4",
        "text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]",
        "placeholder:text-[color:var(--color-text-muted)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        invalid
          ? "border-[var(--color-error)]"
          : "border-[var(--color-border-hairline)] hover:border-[var(--color-border)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...rest}
    />
  );
}
