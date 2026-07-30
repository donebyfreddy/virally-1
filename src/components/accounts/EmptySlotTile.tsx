import { ButtonLink } from "@/components/primitives/ButtonLink";
import { emptySlot, slotActions } from "@/content/accounts";
import { cn } from "@/lib/cn";

/**
 * EMPTY SLOT TILE.
 *
 * Structurally distinct from AccountSlotCard on purpose: no index rail, no platform
 * mark, no health row, no status badge. An empty slot has no state to report — it is
 * an offer, and it is drawn as an outline rather than a filled surface so a scan of
 * the grid separates capacity-in-use from capacity-available without reading a word.
 *
 * The dashed border is the one place a dashed edge is used in the product, and it
 * means "nothing here yet" rather than "placeholder pending real data" (which is the
 * amber dev treatment reserved for unfulfilled provenance).
 */
export function EmptySlotTile({
  previewNumber,
  canClaim,
  index,
}: {
  previewNumber: number;
  canClaim: boolean;
  index: number;
}) {
  return (
    <li
      className={cn(
        "flex flex-col justify-between gap-4 rounded-[var(--radius-sm)] p-4",
        // Outline, not a surface: an empty slot is absence, and filling it in makes
        // the grid read as uniformly occupied.
        "border border-dashed border-[var(--color-border-hairline)] bg-transparent",
        "motion-safe:animate-[virally-stage-in_var(--dur-panel)_var(--ease-settle)_backwards]",
      )}
      style={{ animationDelay: `${Math.min(index, 9) * 40}ms` }}
    >
      <div>
        <span className="font-utility text-[length:var(--text-utility)] tabular-nums text-[color:var(--color-text-muted)]">
          {String(previewNumber).padStart(2, "0")}
        </span>
        <h3 className="mt-2 text-[length:var(--text-body-s)] font-medium text-[color:var(--color-text-secondary)]">
          {emptySlot.label}
        </h3>
        <p className="mt-1 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          {emptySlot.body}
        </p>
      </div>

      {/* Offered only to a role that can actually claim. A button that exists to
          produce a permission error is worse than no button. */}
      {canClaim ? (
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/app/accounts/launch" variant="secondary">
            {slotActions.prepare}
          </ButtonLink>
        </div>
      ) : null}
    </li>
  );
}
