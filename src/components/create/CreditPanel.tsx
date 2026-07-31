"use client";

import { RailList, RailNote, RailPanel, RailRow } from "@/components/app-ui/SummaryRail";
import { ErrorState } from "@/components/app-ui/States";
import { creditCopy } from "@/content/create";
import type { BalanceComparison } from "@/lib/creative/estimator";

/**
 * Credit balance and the effect of the current batch, in the plan rail.
 *
 * Shown before anything is generated, next to the counts that produce it, so a
 * user learns the cost while they are still changing the thing that causes it —
 * not in a confirmation dialog after they have decided.
 *
 * The rail states three numbers and their relationship: what is available, what
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
    <RailPanel title={creditCopy.heading} id="credit-summary">
      {unmetered && (
        <RailNote title={creditCopy.unmeteredNoteTitle} body={creditCopy.unmeteredNote} />
      )}

      <div className="mt-[var(--space-4)]">
        <RailList>
          <RailRow
            label={creditCopy.availableLabel}
            value={available.toLocaleString("en-US")}
          />
          <RailRow
            label={creditCopy.estimateLabel}
            value={`−${estimate.credits.toLocaleString("en-US")}`}
          />
          <RailRow
            label={creditCopy.afterLabel}
            // Clamped at zero for display: a negative balance is not a state the
            // ledger can reach, so rendering one would describe something
            // impossible. The shortfall is stated explicitly below instead.
            value={Math.max(0, balanceAfter).toLocaleString("en-US")}
            divided
          />

          {/* Only rendered when something is actually held. A permanent
              "Reserved 0" row is a dead region that makes the panel look
              broken rather than idle. */}
          {reserved > 0 && (
            <RailRow label={creditCopy.reservedLabel} value={reserved.toLocaleString("en-US")} />
          )}
        </RailList>
      </div>

      {reserved > 0 && (
        <RailNote title={creditCopy.reservedNoteTitle} body={creditCopy.reservedNote} />
      )}

      {!affordable && !unmetered && (
        <div className="mt-[var(--space-4)]">
          <ErrorState
            title={creditCopy.shortfallHeading}
            body={`This batch needs ${shortfall.toLocaleString("en-US")} more Production Credits. ${creditCopy.shortfallBody}`}
            reassurance="Nothing has been generated and no credits have been used."
          />
        </div>
      )}

      {affordable && !unmetered && (
        <RailNote title={creditCopy.reservationNoteTitle} body={creditCopy.reservationNote} />
      )}
    </RailPanel>
  );
}
