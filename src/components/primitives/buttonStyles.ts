import { cn } from "@/lib/cn";

/**
 * Button styling, shared by `Button` (client) and `ButtonLink` (server).
 *
 * This file deliberately carries NO `"use client"` directive, and the constants
 * must not move back into `Button.tsx`.
 *
 * `Button.tsx` is a client component. Next.js replaces a client module's exports
 * with client references when a server component imports them, so a plain string
 * exported from there arrives in a server render as something `cn()` silently
 * drops — which rendered every `ButtonLink` on a server page as unstyled text
 * with only its size classes attached. Keeping the style constants in a
 * directive-free module means both sides import real strings.
 */

export type ButtonVariant = "primary" | "secondary" | "text" | "destructive";
export type ButtonSize = "md" | "lg";

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

export const buttonSizeClasses: Record<ButtonSize, string> = {
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
