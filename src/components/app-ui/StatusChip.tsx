import { AlertCircle, Archive, Check, CircleDashed, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReviewStatus } from "@/types/database";
import { cn } from "@/lib/cn";

/**
 * Review-status chip.
 *
 * Distinct from `StatusDot`, which reports what the MACHINE is doing
 * (generating, rendering, publishing). This reports where a human REVIEW stands.
 * Keeping them separate is what preserves the two-accent taxonomy: teal means
 * the machine is working, amber means a person must act, and collapsing both
 * into one component is how those meanings blur.
 *
 * Every status carries an icon as well as a colour, so the state survives being
 * read without hue.
 */

const config: Record<
  ReviewStatus,
  { label: string; icon: LucideIcon; classes: string }
> = {
  draft: {
    label: "Draft",
    icon: CircleDashed,
    classes:
      "border-[var(--color-border-hairline)] text-[color:var(--color-text-muted)]",
  },
  awaiting_review: {
    // The one status that needs a person, so the one that gets the accent.
    label: "Needs review",
    icon: Clock,
    classes:
      "border-[var(--color-action)] bg-[var(--color-action-wash)] text-[color:var(--color-action)]",
  },
  approved: {
    label: "Approved",
    icon: Check,
    classes: "border-[var(--color-success)] text-[color:var(--color-success)]",
  },
  rejected: {
    label: "Rejected",
    icon: AlertCircle,
    classes:
      "border-[var(--color-error)] bg-[var(--color-error-wash)] text-[color:var(--color-error)]",
  },
  archived: {
    label: "Archived",
    icon: Archive,
    classes:
      "border-[var(--color-border-hairline)] text-[color:var(--color-text-muted)]",
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1",
        "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
        classes,
        className,
      )}
    >
      <Icon aria-hidden="true" size={12} strokeWidth={2} />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/** The label, for a table's accessible text or a sort control. */
export function reviewStatusLabel(status: ReviewStatus): string {
  return config[status].label;
}
