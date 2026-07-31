"use client";

import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { FigureList, FigureRow, PanelNote } from "@/components/app-ui/Figures";
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

   `FigureList` / `FigureRow` / `PanelNote` now live in
   `components/app-ui/Figures`, which is where they always belonged — the credit
   card, the plan summary and a campaign's cost rail are the same shape, and a
   figure row that differs between them by a hair is what makes a column of
   numbers look assembled. They were defined here only because `app-ui` was
   closed to new files at the time.

   Re-exported so `Composer`, which imports them from this module, keeps
   resolving. That re-export is the last thing to remove: a one-line change to
   `Composer`'s import retires it.
   ======================================================================== */

