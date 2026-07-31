import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Panel } from "./Panel";

/**
 * The right-hand summary rail.
 *
 * The rail answers "what is about to happen, and what will it cost" while the
 * user is still editing the thing on the left. That is why it is a sibling
 * column rather than a section below: pushed below the fold it stops being a
 * decision aid and becomes a receipt.
 *
 * Ordered AFTER the main column in the DOM so keyboard and screen-reader users
 * reach the thing they came to operate first. On narrow viewports it stacks
 * below for the same reason.
 */
export function RailLayout({
  children,
  rail,
  className,
}: {
  children: ReactNode;
  rail: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-[var(--space-6)]",
        "xl:grid-cols-[minmax(0,1fr)_var(--app-summary-rail)]",
        className,
      )}
    >
      <div className="min-w-0">{children}</div>

      {/* `sticky` only where there is room for it to be useful. Below xl the
          rail is stacked content and pinning it would cover the page. */}
      <aside className="min-w-0 xl:sticky xl:top-[var(--space-6)]">{rail}</aside>
    </div>
  );
}

/**
 * A titled block within the rail.
 *
 * `accent` marks the block the user should read first — used at most once per
 * rail. Amber, because it means "a human must decide", which is exactly what a
 * pre-commit summary is for.
 */
export function RailPanel({
  title,
  children,
  accent = false,
  /** Small right-aligned note in the title row: a status, a count. */
  aside,
  className,
  id,
}: {
  title: string;
  children: ReactNode;
  accent?: boolean;
  aside?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Panel
      as="section"
      tone={accent ? "wash" : "default"}
      pad="default"
      aria-labelledby={id}
      className={cn(accent && "border-[var(--color-border)]", className)}
    >
      <div className="flex min-h-6 items-center justify-between gap-[var(--space-4)]">
        <h2
          id={id}
          className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]"
        >
          {title}
        </h2>
        {aside}
      </div>

      <div className="mt-[var(--space-4)]">{children}</div>
    </Panel>
  );
}

/**
 * One label/value line in a rail panel.
 *
 * A `<dl>` row — see `RailList`. Values are right-aligned and tabular so a
 * stack of them scans as a column of figures rather than ragged text.
 */
export function RailRow({
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
        "flex items-center justify-between gap-[var(--space-4)] py-[var(--space-2)]",
        divided && "mt-[var(--space-2)] border-t border-[var(--color-border-hairline)] pt-[var(--space-4)]",
      )}
    >
      <dt className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
        {icon && (
          <span aria-hidden="true" className="shrink-0 text-[color:var(--color-text-muted)]">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </dt>

      <dd
        className={cn(
          "shrink-0 font-utility tabular-nums",
          emphasis
            ? "text-[length:var(--text-metric-s)] text-[color:var(--color-action)]"
            : "text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Wraps `RailRow`s so the label/value pairing is real markup. */
export function RailList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col">{children}</dl>;
}

/**
 * An explanatory block — the reference's "why plan first" card.
 *
 * Deliberately low-contrast chrome: it is durable copy the user reads once, so
 * it must not compete with the live figures above it.
 */
export function RailNote({
  title,
  body,
  /** Optional link out. Rendered by the caller so routing stays its concern. */
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Panel tone="raised" pad="default" border={false}>
      <p className="flex items-center gap-[var(--space-2)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
        {icon && (
          <span aria-hidden="true" className="text-[color:var(--color-text-muted)]">
            {icon}
          </span>
        )}
        {title}
      </p>

      <p className="mt-[var(--space-3)] text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
        {body}
      </p>

      {action && <div className="mt-[var(--space-4)]">{action}</div>}
    </Panel>
  );
}
