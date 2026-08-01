"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  buttonBase,
  buttonSizeClasses,
  variantClasses,
  type ButtonSize,
  type ButtonVariant,
} from "./buttonStyles";

// Re-exported so existing imports from "./Button" keep working. The values
// themselves live in the directive-free `buttonStyles` module — see the note
// there for why they must not move back into this file.
export {
  buttonBase,
  variantClasses,
  type ButtonSize,
  type ButtonVariant,
} from "./buttonStyles";

type ButtonOwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Accessible label announced while `loading` is true. */
  loadingLabel?: string;
  iconLeading?: ReactNode;
  iconTrailing?: ReactNode;
};

export type ButtonProps = ButtonOwnProps &
  ButtonHTMLAttributes<HTMLButtonElement>;

const sizeClasses = buttonSizeClasses;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      loadingLabel = "Working",
      iconLeading,
      iconTrailing,
      className,
      children,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        // Kept focusable while loading so focus is not lost mid-interaction;
        // `aria-disabled` + the click guard prevent double submission.
        disabled={disabled}
        aria-disabled={loading || undefined}
        aria-busy={loading || undefined}
        onClick={loading ? (e) => e.preventDefault() : rest.onClick}
        className={cn(
          buttonBase,
          sizeClasses[size],
          variantClasses[variant],
          loading && "cursor-progress",
          className,
        )}
        {...rest}
      >
        {loading ? (
          <>
            <Spinner />
            <span>{loadingLabel}</span>
            <span className="sr-only" role="status">
              {loadingLabel}
            </span>
          </>
        ) : (
          <>
            {iconLeading}
            {children}
            {iconTrailing}
          </>
        )}
      </button>
    );
  },
);

/**
 * Violet, because a spinner means the machine is working — the signal colour's
 * one job. CSS-driven so it costs nothing and stops under reduced motion via
 * the global floor rule.
 */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0 rounded-full",
        "border-2 border-current border-t-[var(--color-signal)]",
        "motion-safe:animate-spin",
      )}
    />
  );
}
