import { cn } from "@/lib/cn";

export type MachineStatus =
  | "planning"
  | "queued"
  | "generating"
  | "rendering"
  | "publishing"
  | "scheduled"
  | "live"
  | "idle"
  | "ready"
  | "cancelled"
  | "error";

/**
 * Machine state indicator.
 *
 * State is never carried by colour alone: every status renders a dot, a word,
 * and — for active states — an animated ellipsis. Teal appears only while the
 * machine is genuinely working; settled states use neutral or semantic colour.
 */
const statusConfig: Record<
  MachineStatus,
  { label: string; dot: string; text: string; active: boolean }
> = {
  planning: {
    label: "PLANNING",
    dot: "bg-[var(--color-text-muted)]",
    text: "text-[color:var(--color-text-muted)]",
    active: false,
  },
  queued: {
    label: "QUEUED",
    dot: "bg-[var(--color-text-secondary)]",
    text: "text-[color:var(--color-text-secondary)]",
    active: false,
  },
  generating: {
    label: "GENERATING",
    dot: "bg-[var(--color-signal)]",
    text: "text-[color:var(--color-signal)]",
    active: true,
  },
  rendering: {
    label: "RENDERING",
    dot: "bg-[var(--color-signal)]",
    text: "text-[color:var(--color-signal)]",
    active: true,
  },
  publishing: {
    label: "PUBLISHING",
    dot: "bg-[var(--color-signal)]",
    text: "text-[color:var(--color-signal)]",
    active: true,
  },
  scheduled: {
    label: "SCHEDULED",
    dot: "bg-[var(--color-text-secondary)]",
    text: "text-[color:var(--color-text-secondary)]",
    active: false,
  },
  live: {
    label: "LIVE",
    dot: "bg-[var(--color-success)]",
    text: "text-[color:var(--color-success)]",
    active: false,
  },
  idle: {
    label: "IDLE",
    dot: "bg-[var(--color-text-muted)]",
    text: "text-[color:var(--color-text-muted)]",
    active: false,
  },
  ready: {
    label: "READY",
    dot: "bg-[var(--color-success)]",
    text: "text-[color:var(--color-success)]",
    active: false,
  },
  cancelled: {
    label: "CANCELLED",
    dot: "bg-[var(--color-text-muted)]",
    text: "text-[color:var(--color-text-muted)]",
    active: false,
  },
  error: {
    label: "FAILED",
    dot: "bg-[var(--color-error)]",
    text: "text-[color:var(--color-error)]",
    active: false,
  },
};

export function StatusDot({
  status,
  className,
  showLabel = true,
}: {
  status: MachineStatus;
  className?: string;
  showLabel?: boolean;
}) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-utility",
        "text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)]",
        config.text,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          config.dot,
          config.active && "motion-safe:animate-pulse",
        )}
      />
      {showLabel && (
        <span>
          {config.label}
          {/* Shape redundancy: active states are distinguishable without colour. */}
          {config.active && (
            <span aria-hidden="true" className="motion-safe:animate-pulse">
              …
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export function statusLabel(status: MachineStatus): string {
  return statusConfig[status].label;
}
