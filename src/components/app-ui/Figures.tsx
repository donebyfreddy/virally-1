import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Label/value figure rows, and the quiet note that explains them.
 *
 * The third figure shape in the app, and the three are not interchangeable:
 *
 *   `KpiCard`  a boxed tile at the top of a page — the page's primary content.
 *   `Metric`   a borderless figure in a `<dl>` grid — supporting detail.
 *   `FigureRow` a label on the left, a value on the right, stacked into a
 *              column — a breakdown that has to be read line by line, where the
 *              relationship between the rows (components, then a total) is the
 *              point.
 *
 * These lived in `components/create/CreditPanel` while `app-ui` was closed to
 * new files. They belong here: the credit card, the plan summary and a campaign's
 * cost rail are all the same shape, and a figure row that differs between them by
 * a hair is exactly what makes a column of numbers look assembled rather than
 * designed.
 *
 * They replaced the retired `SummaryRail` (`RailList` / `RailRow` / `RailNote`),
 * which read the legacy `--color-*` aliases and set its titles in wide-tracked
 * uppercase — an eyebrow, which the app does not have.
 */

/** Wraps `FigureRow`s so the label/value pairing is real markup. */
export function FigureList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>;
}

/**
 * One label/value line. Values are right-aligned and tabular so a stack of them
 * scans as a column of figures rather than as ragged text.
 */
export function FigureRow({
  label,
  value,
  /** Leading glyph. Optional; the label carries the meaning. */
  icon,
  /** Draws a hairline above — used to separate a total from its components. */
  divided = false,
  /** Emphasises the value. For the one figure that matters most. */
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  divided?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-[var(--space-4)] py-[var(--space-1)]",
        divided &&
          "mt-[var(--space-2)] border-t border-[var(--border-subtle)] pt-[var(--space-3)]",
      )}
    >
      <dt className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
        {icon && (
          <span aria-hidden="true" className="shrink-0 text-[color:var(--text-muted)]">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </dt>

      <dd
        className={cn(
          "app-figure shrink-0 text-[color:var(--text-primary)]",
          emphasis
            ? "text-[length:var(--text-metric-s)] font-[var(--weight-heading)]"
            : "text-[length:var(--text-app-cell)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A quiet explanatory block.
 *
 * Deliberately low-contrast: it is durable copy the user reads once, so it must
 * not compete with the live figures beside it.
 */
export function PanelNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-[var(--surface-secondary)] p-[var(--space-3)]">
      <p className="text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]">
        {title}
      </p>
      <p className="mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
        {body}
      </p>
    </div>
  );
}
