import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "./Card";

/**
 * Empty, loading and error states.
 *
 * These are load-bearing, not filler. Because the product never fabricates
 * metrics, a new workspace sees an empty state on nearly every page — so the
 * empty state IS the first-run experience.
 *
 * What changed in this rewrite is the SIZE. The previous version was a
 * `pad="loose"` panel with a `--text-title` heading and a `prose-measure`
 * paragraph, left-aligned, which on an otherwise blank page became the largest
 * object on screen and read as an error. An empty state should explain the
 * surface in one sentence, offer two ways forward, and then get out of the way so
 * onboarding content — templates, worked examples, quick starts — can sit
 * underneath it.
 *
 * The shape it follows: what is missing → what will fill it → the action that
 * does. A bare "No data" tells a user nothing about whether the product is
 * broken.
 */
export function EmptyState({
  /** What is missing, as a statement: "No campaigns yet." */
  title,
  /** Why it is empty and what will fill it. ONE sentence. */
  body,
  /** Primary and secondary actions. Omit when the user genuinely cannot act. */
  actions,
  /**
   * A quiet glyph in a soft tile. Sized here, so pass the bare icon. An
   * illustration standing in for an explanation is decoration; a 20px glyph is
   * punctuation.
   */
  icon,
  /**
   * `bare` drops the card frame, for an empty state already inside a Card —
   * a second border there reads as a seam.
   */
  bare = false,
  className,
}: {
  title: string;
  body: string;
  actions?: ReactNode;
  icon?: ReactNode;
  bare?: boolean;
  className?: string;
}) {
  const content = (
    <div className="mx-auto flex max-w-[34rem] flex-col items-center px-[var(--space-4)] py-[var(--space-8)] text-center">
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            "mb-[var(--space-4)] flex size-10 items-center justify-center",
            "rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[color:var(--brand-ink)]",
          )}
        >
          {icon}
        </span>
      )}

      <h3 className="app-section-title text-[color:var(--text-primary)]">{title}</h3>

      <p className="mt-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
        {body}
      </p>

      {actions && (
        <div className="mt-[var(--space-5)] flex flex-wrap items-center justify-center gap-[var(--space-2)]">
          {actions}
        </div>
      )}
    </div>
  );

  if (bare) return <div className={className}>{content}</div>;

  return (
    <Card tone="inset" className={className}>
      {content}
    </Card>
  );
}

/**
 * Loading placeholder.
 *
 * `aria-busy` with a live region rather than a silent shimmer: a screen reader
 * user needs to know something is coming. The bars animate only under
 * `motion-safe`, so with reduced motion this is a static skeleton — which is the
 * correct reduced-motion design, not a degraded one.
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
      className={cn("flex flex-col gap-[var(--space-2)]", className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            "h-10 rounded-[var(--radius-control)]",
            "bg-[var(--surface-muted)]",
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
 * write, and it is why this takes a `reassurance` prop rather than leaving each
 * caller to remember it.
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
    <div
      // `role="alert"` would interrupt; this renders on navigation, not mid-task,
      // so a passive region is correct.
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--error-mark)] bg-[var(--error-soft)]",
        "p-[var(--app-panel-pad)]",
        className,
      )}
    >
      <p className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-cell)] font-[var(--weight-heading)] text-[color:var(--error)]">
        {/* Icon plus text: errors are never colour-only. */}
        <span aria-hidden="true">✕</span>
        {title}
      </p>

      <p className="mt-[var(--space-2)] max-w-[60ch] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
        {body}
      </p>

      {reassurance && (
        <p className="mt-1 max-w-[60ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
          {reassurance}
        </p>
      )}

      {actions && (
        <div className="mt-[var(--space-4)] flex flex-wrap gap-[var(--space-2)]">{actions}</div>
      )}
    </div>
  );
}
