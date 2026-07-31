import { AlertCircle, Archive, Check, CircleDashed, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReviewStatus } from "@/types/database";
import { cn } from "@/lib/cn";

/**
 * Review-status chip.
 *
 * Distinct from `StatusDot`, which reports what the MACHINE is doing
 * (generating, rendering, publishing). This reports where a human REVIEW stands.
 * Keeping them separate is what stops "the system is busy" and "you need to do
 * something" from blurring into one indistinct colour.
 *
 * Soft-filled rather than outlined. On a white card, five outlined chips in a
 * table column produce five competing rectangles; a tinted fill with no border
 * reads as a label, which is what a status is. Every status still carries an icon
 * as well as a colour, so the state survives being read without hue — and the
 * text colour is the 4.5:1 ink of each pair, not the 3:1 mark.
 */

const config: Record<ReviewStatus, { label: string; icon: LucideIcon; classes: string }> = {
  draft: {
    label: "Draft",
    icon: CircleDashed,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  awaiting_review: {
    // The one status that needs a person, so the one that gets warning amber.
    // Deliberately NOT the brand teal: teal is the interactive accent, and a
    // teal status would read as a button.
    label: "Needs review",
    icon: Clock,
    classes: "bg-[var(--warning-soft)] text-[color:var(--warning)]",
  },
  approved: {
    label: "Approved",
    icon: Check,
    classes: "bg-[var(--success-soft)] text-[color:var(--success)]",
  },
  rejected: {
    label: "Rejected",
    icon: AlertCircle,
    classes: "bg-[var(--error-soft)] text-[color:var(--error)]",
  },
  archived: {
    label: "Archived",
    icon: Archive,
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-muted)]",
  },
};

export function StatusChip({
  status,
  /** Hides the word, leaving icon plus accessible name. For dense table cells. */
  compact = false,
  className,
}: {
  status: ReviewStatus;
  compact?: boolean;
  className?: string;
}) {
  const { label, icon: Icon, classes } = config[status];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] px-2 py-1",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        "whitespace-nowrap",
        classes,
        className,
      )}
    >
      <Icon aria-hidden="true" size={12} strokeWidth={2.25} className="shrink-0" />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/** The label, for a table's accessible text or a sort control. */
export function reviewStatusLabel(status: ReviewStatus): string {
  return config[status].label;
}
