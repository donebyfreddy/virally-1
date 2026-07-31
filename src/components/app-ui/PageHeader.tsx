import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The band every product page opens with.
 *
 * Compact by design, and that is the whole point of this rewrite. The previous
 * version led with an uppercase eyebrow above a `--text-display-m` headline
 * (clamped up to 44px) at -0.03em tracking and a 0.95 line-height — marketing
 * typography, on an operations screen, consuming the top third of the viewport
 * before a single row of data. Now:
 *
 *   - No eyebrow. "CAMPAIGNS" above "Campaigns" said the same word twice, and
 *     the top bar's breadcrumb already states where the user is.
 *   - `app-title` (28–32px, Geist 600) instead of the display face.
 *   - Description on the line below, at reading size, capped at 60ch.
 *   - Actions align to the title's baseline row rather than the block's bottom,
 *     so a two-line description does not drag the primary button down with it.
 *
 * `title` is a string, not a node: it renders the page's single `<h1>`, and
 * accepting arbitrary children there is how pages end up with two h1s or a
 * heading containing a button.
 */
export function PageHeader({
  title,
  description,
  /** Primary/secondary controls for the page, right-aligned on wide viewports. */
  actions,
  /**
   * Small facts under the copy — workspace, brand, counts, last sync. Separated
   * with interpuncts, wrapping safely at 390px. Sentence case, not uppercase:
   * these are values, and a wide-tracked uppercase value is harder to read than
   * the thing it describes.
   */
  meta,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: readonly string[];
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-[var(--space-4)]", className)}>
      <div className="min-w-0">
        <h1 className="app-title text-[color:var(--text-primary)]">{title}</h1>

        {description && (
          <p className="mt-[var(--space-2)] max-w-[60ch] text-[length:var(--text-app-body)] text-[color:var(--text-secondary)]">
            {description}
          </p>
        )}

        {meta && meta.length > 0 && (
          <p className="mt-[var(--space-3)] flex flex-wrap items-center gap-x-[var(--space-2)] gap-y-1 text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
            {meta.map((item, index) => (
              <Fragment key={item}>
                {index > 0 && <span aria-hidden="true">·</span>}
                <span>{item}</span>
              </Fragment>
            ))}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">{actions}</div>
      )}
    </header>
  );
}

/**
 * A titled section heading between page-level blocks.
 *
 * Sits above a grid of cards, where a `CardHeader` would be wrong because the
 * heading describes the whole group rather than one surface.
 */
export function SectionHeader({
  title,
  description,
  action,
  id,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-[var(--space-3)]", className)}>
      <div className="min-w-0">
        <h2 id={id} className="app-section-title text-[color:var(--text-primary)]">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-[var(--space-2)]">{action}</div>}
    </div>
  );
}
