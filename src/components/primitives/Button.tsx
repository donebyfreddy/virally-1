"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "text" | "destructive";
export type ButtonSize = "md" | "lg";

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

/**
 * Base classes shared with `ButtonLink` so an anchor styled as a button is
 * pixel-identical. `min-h-11` is the 44px touch-target floor, asserted in
 * Playwright.
 */
export const buttonBase = cn(
  "relative inline-flex items-center justify-center gap-2",
  "min-h-11 rounded-[var(--radius-sm)]",
  "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
  "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
  "select-none",
  "disabled:cursor-not-allowed disabled:opacity-40",
  // Keep the designed focus ring even when a variant sets its own border.
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
);

const sizeClasses: Record<ButtonSize, string> = {
  md: "px-4 py-2.5",
  lg: "px-6 py-3.5 text-[length:var(--text-body-s)]",
};

/**
 * Amber is reserved for human commitment — primary actions only. It must never
 * appear as decoration elsewhere, or the taxonomy stops teaching anything.
 */
export const variantClasses: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-[var(--color-action)] text-[color:var(--color-text-oncolor)]",
    "hover:bg-[var(--color-action-hover)]",
    "active:bg-[var(--color-action-press)] active:translate-y-px",
    "disabled:hover:bg-[var(--color-action)]",
  ),
  secondary: cn(
    "border border-[var(--color-border)] bg-transparent text-[color:var(--color-text-primary)]",
    "hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]",
    "active:bg-[var(--color-surface-3)] active:translate-y-px",
  ),
  text: cn(
    "bg-transparent px-2 text-[color:var(--color-text-secondary)]",
    "hover:text-[color:var(--color-text-primary)]",
    "active:translate-y-px",
  ),
  destructive: cn(
    "border border-[var(--color-error)] bg-transparent text-[color:var(--color-error)]",
    "hover:bg-[var(--color-error-wash)]",
    "active:translate-y-px",
  ),
};

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
 * Teal, because a spinner means the machine is working — the signal colour's
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
