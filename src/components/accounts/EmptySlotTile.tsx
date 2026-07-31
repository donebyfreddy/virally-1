import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { emptySlot, slotActions } from "@/content/accounts";
import { cn } from "@/lib/cn";

/**
 * EMPTY SLOT TILE.
 *
 * Structurally distinct from AccountSlotCard on purpose: no avatar, no health
 * chip, no facts row, no operations. An empty slot has no state to report — it is
 * an offer — and it is drawn as a dashed outline on the canvas rather than as a
 * white card, so a scan of the grid separates capacity-in-use from
 * capacity-available without reading a word.
 *
 * The dashed border is the one place a dashed edge is used in the product, and it
 * means "nothing here yet" rather than "placeholder pending real data" (which is
 * the amber dev treatment reserved for unfulfilled provenance).
 */
export function EmptySlotTile({
  previewNumber,
  canClaim,
}: {
  previewNumber: number;
  canClaim: boolean;
}) {
  return (
    <li
      className={cn(
        "flex h-full flex-col items-start gap-[var(--space-2)]",
        "rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)]",
        "bg-transparent p-[var(--app-panel-pad)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-7 items-center justify-center rounded-[var(--radius-chip)]",
          "bg-[var(--surface-muted)] text-[color:var(--text-muted)]",
        )}
      >
        <Plus size={14} strokeWidth={2} />
      </span>

      <h3 className="app-card-title text-[color:var(--text-secondary)]">{emptySlot.label}</h3>
      <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
        {emptySlot.body}
      </p>

      <div className="mt-auto flex w-full flex-wrap items-center gap-[var(--space-2)] pt-[var(--space-3)]">
        <span className="app-figure mr-auto text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {`Slot ${String(previewNumber).padStart(2, "0")}`}
        </span>
        {/* Offered only to a role that can actually claim. A button that exists to
            produce a permission error is worse than no button. */}
        {canClaim && (
          <ButtonLink href="/app/accounts/launch" variant="secondary">
            {slotActions.prepare}
          </ButtonLink>
        )}
      </div>
    </li>
  );
}
