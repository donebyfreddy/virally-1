"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { ErrorState } from "@/components/app-ui/States";
import { creditCopy } from "@/content/create";
import type { BalanceComparison } from "@/lib/creative/estimator";

/**
 * Credit balance and the effect of the current batch, in the plan column.
 *
 * Shown before anything is generated, next to the counts that produce it, so a
 * user learns the cost while they are still changing the thing that causes it —
 * not in a confirmation dialog after they have decided.
 *
 * The card states three numbers and their relationship: what is available, what
 * this batch reserves, what remains. Nothing here is a projection or a
 * recommendation.
 */
export function CreditPanel({
  comparison,
  reserved,
  /**
   * True when no provider is configured.
   *
   * The batch will run on the mock and cost nothing, so the figures are shown as
   * what it *would* cost rather than what it will — presenting a real deduction
   * for a free run would be a false statement about the user's balance.
   */
  unmetered,
}: {
  comparison: BalanceComparison;
  reserved: number;
  unmetered: boolean;
}) {
  const { estimate, available, balanceAfter, affordable, shortfall } = comparison;

  return (
    <Card as="section" aria-labelledby="credit-summary">
      <CardHeader id="credit-summary" as="h2" title={creditCopy.heading} />

      <CardBody className="flex flex-col gap-[var(--space-4)] pt-[var(--space-3)]">
        {unmetered && (
          <PanelNote title={creditCopy.unmeteredNoteTitle} body={creditCopy.unmeteredNote} />
        )}

        <FigureList>
          <FigureRow label={creditCopy.availableLabel} value={available.toLocaleString("en-US")} />
          <FigureRow
            label={creditCopy.estimateLabel}
            value={`−${estimate.credits.toLocaleString("en-US")}`}
          />
          <FigureRow
            label={creditCopy.afterLabel}
            // Clamped at zero for display: a negative balance is not a state the
            // ledger can reach, so rendering one would describe something
            // impossible. The shortfall is stated explicitly below instead.
            value={Math.max(0, balanceAfter).toLocaleString("en-US")}
            emphasis
            divided
          />

          {/* Only rendered when something is actually held. A permanent
              "Reserved 0" row is a dead region that makes the panel look
              broken rather than idle. */}
          {reserved > 0 && (
            <FigureRow label={creditCopy.reservedLabel} value={reserved.toLocaleString("en-US")} />
          )}
        </FigureList>

        {reserved > 0 && (
          <PanelNote title={creditCopy.reservedNoteTitle} body={creditCopy.reservedNote} />
        )}

        {!affordable && !unmetered && (
          <ErrorState
            title={creditCopy.shortfallHeading}
            body={`This batch needs ${shortfall.toLocaleString("en-US")} more Production Credits. ${creditCopy.shortfallBody}`}
            reassurance="Nothing has been generated and no credits have been used."
          />
        )}

        {affordable && !unmetered && (
          <PanelNote title={creditCopy.reservationNoteTitle} body={creditCopy.reservationNote} />
        )}
      </CardBody>
    </Card>
  );
}

/* ==========================================================================
   SHARED PLAN-COLUMN PIECES

   Exported from here rather than duplicated in Composer: the plan summary and
   this card are two surfaces in the same column, and a figure row that differs
   between them by a hair is exactly what makes a column of numbers look
   assembled. Their eventual home is `components/app-ui` — `SummaryRail` there
   is the same shape, but it still reads the legacy `--color-*` aliases and
   wide-tracked uppercase titles, so this page no longer uses it.
   ======================================================================== */

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
