import { cn } from "@/lib/cn";

/**
 * A determinate progress bar.
 *
 * Linear transition only. An eased progress bar lies about the underlying
 * process — it implies the work accelerated or slowed when it did not — so the
 * easing token here is `--ease-linear` and must stay that way.
 *
 * Renders as a real `<progress>`-equivalent ARIA role with the value in the
 * accessible name, because a bar alone communicates nothing to a screen reader.
 * The numeric label is also rendered visibly: percentage-only progress on a
 * dense row is hard to read at a glance from bar length alone.
 */
export function Progress({
  /** 0–100. Clamped, so a miscomputed ratio cannot overflow the track. */
  percent,
  /** What is progressing. Used in the accessible name. */
  label,
  /** Show the numeric percentage beside the bar. */
  showValue = true,
  /** `signal` while the machine is actively working; `neutral` once settled. */
  tone = "neutral",
  className,
}: {
  percent: number;
  label: string;
  showValue?: boolean;
  tone?: "neutral" | "signal";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div className={cn("flex items-center gap-[var(--space-3)]", className)}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${clamped}% complete`}
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-full)] bg-[var(--chart-track)]"
      >
        <div
          className={cn(
            "h-full rounded-[var(--radius-full)]",
            "transition-[width] duration-[var(--dur-base)] ease-[var(--ease-linear)]",
            tone === "signal" ? "bg-[var(--color-signal)]" : "bg-[var(--color-action)]",
          )}
          // Width is the only honest channel for a progress value, so this is
          // the one place a non-transform property is animated on purpose.
          style={{ width: `${clamped}%` }}
        />
      </div>

      {showValue && (
        <span className="shrink-0 font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-secondary)]">
          {clamped}%
        </span>
      )}
    </div>
  );
}
