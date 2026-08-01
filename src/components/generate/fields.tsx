import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Form furniture for the studios.
 *
 * One definition of a control's height, border and focus ring, because the
 * studios put a text field, three selects, a search box and a slider on the same
 * card and four slightly different 36px boxes read as an unfinished screen.
 *
 * `--border-control` rather than `--border-default`: an input's edge carries a
 * 3:1 contrast obligation (WCAG 1.4.11) that a card seam does not. Using the
 * decorative hairline here is the standard light-theme accessibility bug the
 * token split exists to prevent.
 */
export const controlClasses = cn(
  "w-full rounded-[var(--radius-control)] border border-[var(--border-control)]",
  "bg-[var(--surface-primary)] px-[var(--space-3)]",
  "text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]",
  "placeholder:text-[color:var(--text-muted)]",
  "transition-colors duration-[var(--dur-instant)]",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]",
  "disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[color:var(--text-muted)]",
);

/** 36px, the app's control height. Not applied to a textarea, which sizes by rows. */
export const controlHeight = "h-9";

/**
 * A labelled control.
 *
 * The label is always rendered and always associated by `htmlFor`. Instructions
 * live in `hint`, under the control's own label and above the control — never
 * only in a placeholder, which disappears the moment the user types and is not
 * announced by every screen reader.
 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--text-primary)]"
      >
        {label}
      </label>
      {hint && (
        <p
          id={`${htmlFor}-hint`}
          className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]"
        >
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}
