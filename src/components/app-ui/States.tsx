import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Panel } from "./Panel";

/**
 * Empty, loading and error states.
 *
 * These are load-bearing, not filler. Because the product never fabricates
 * metrics, a new workspace sees an empty state on nearly every page — so the
 * empty state IS the first-run experience, and it has to explain the surface
 * rather than apologise for itself.
 *
 * The shape each one follows: what this surface holds → why it is empty → the
 * action that would populate it. A bare "No data" tells a user nothing about
 * whether the product is broken.
 */

export function EmptyState({
  /** What is missing, as a statement: "No campaigns yet." */
  title,
  /** Why it is empty and what will fill it. Two sentences at most. */
  body,
  /** Primary and secondary actions. Omit when the user genuinely cannot act. */
  actions,
  /**
   * A quiet glyph. Kept optional and small: an oversized illustration in an
   * empty state is decoration standing in for an explanation.
   */
  icon,
  className,
}: {
  title: string;
  body: string;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Panel
      tone="inset"
      pad="loose"
      className={cn("flex flex-col items-start", className)}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="mb-[var(--space-4)] text-[color:var(--color-text-muted)]"
        >
          {icon}
        </span>
      )}

      <h3 className="font-display text-[length:var(--text-title)]">{title}</h3>

      <p className="prose-measure mt-[var(--space-3)] text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
        {body}
      </p>

      {actions && (
        <div className="mt-[var(--space-6)] flex flex-wrap gap-[var(--space-3)]">{actions}</div>
      )}
    </Panel>
  );
}

/**
 * Loading placeholder.
 *
 * `aria-busy` with a live region rather than a silent shimmer: a screen reader
 * user needs to know something is coming. The bars animate only under
 * `motion-safe`, so with reduced motion this is a static skeleton — which is
 * the correct reduced-motion design, not a degraded one.
 */
export function LoadingState({
  /** Announced to assistive technology. Say what is loading. */
  label,
  /** Number of skeleton rows. Match the real content's shape. */
  rows = 3,
  className,
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn("flex flex-col gap-[var(--space-3)]", className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            "h-[var(--space-12)] rounded-[var(--radius-sm)]",
            "bg-[var(--color-surface-2)]",
            "motion-safe:animate-pulse",
          )}
          // Staggered so the skeleton reads as a list loading rather than one
          // block flashing. Inline because the delay is per-index.
          style={{ animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * Error state.
 *
 * Says what failed, what was NOT changed, and what to do — in that order.
 * "Nothing was changed" is the sentence a user actually needs after a failed
 * write, and it is why this takes a `reassurance` prop rather than leaving it
 * to each caller to remember.
 */
export function ErrorState({
  title,
  body,
  /** e.g. "No credits were used and nothing was generated." */
  reassurance,
  actions,
  className,
}: {
  title: string;
  body: string;
  reassurance?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Panel
      // role="alert" would interrupt; this is rendered on navigation, not
      // announced mid-task, so a passive region is correct.
      tone="default"
      pad="loose"
      className={cn("border-[var(--color-error)] bg-[var(--color-error-wash)]", className)}
    >
      <p className="flex items-center gap-[var(--space-2)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-error)]">
        {/* Icon plus text: errors are never colour-only. */}
        <span aria-hidden="true">✕</span>
        {title}
      </p>

      <p className="prose-measure mt-[var(--space-3)] text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
        {body}
      </p>

      {reassurance && (
        <p className="prose-measure mt-[var(--space-2)] text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
          {reassurance}
        </p>
      )}

      {actions && (
        <div className="mt-[var(--space-6)] flex flex-wrap gap-[var(--space-3)]">{actions}</div>
      )}
    </Panel>
  );
}
