import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/primitives/Eyebrow";

/**
 * The hero band every product page opens with.
 *
 * One component rather than a per-page header, because the pages must read as
 * one product: same eyebrow → title → copy order, same measure, same optional
 * metadata strip. What varies per page is the `actions` slot and the copy.
 *
 * `title` is a string, not a node: it renders the page's single `<h1>`, and
 * accepting arbitrary children there is how pages end up with two h1s or a
 * heading containing a button.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  /** Primary/secondary controls for the page, right-aligned on wide viewports. */
  actions,
  /**
   * Small uppercase facts under the copy — workspace, brand, counts, last sync.
   * Separated with interpuncts, wrapping safely at 390px.
   */
  meta,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: readonly string[];
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-[var(--space-6)]", className)}>
      <div className="min-w-0 max-w-[46rem]">
        <Eyebrow>{eyebrow}</Eyebrow>

        <h1
          className={cn(
            "font-display mt-[var(--space-3)]",
            "text-[length:var(--text-display-m)]",
            "leading-[var(--leading-display)] tracking-[var(--tracking-display)]",
          )}
        >
          {title}
        </h1>

        {description && (
          <p className="prose-measure mt-[var(--space-4)] text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
            {description}
          </p>
        )}

        {meta && meta.length > 0 && (
          <p className="mt-[var(--space-4)] flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            {meta.map((item, index) => (
              <Fragment key={item}>
                {index > 0 && <span aria-hidden="true">·</span>}
                <span>{item}</span>
              </Fragment>
            ))}
          </p>
        )}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-[var(--space-3)]">{actions}</div>}
    </header>
  );
}
