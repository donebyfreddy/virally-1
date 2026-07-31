import { cn } from "@/lib/cn";

/**
 * A determinate progress bar.
 *
 * Linear transition only. An eased progress bar lies about the underlying
 * process — it implies the work accelerated or slowed when it did not — so the
 * easing token here is `--ease-linear` and must stay that way.
 *
 * Renders a real `progressbar` role with the value in the accessible name,
 * because a bar alone communicates nothing to a screen reader. The numeric label
 * is also rendered visibly: percentage read from bar length alone is guesswork on
 * a dense row.
 *
 * The track is 6px rather than the previous 1px hairline. A 1px bar on a white
 * surface is a scratch, not a gauge — at that weight the fill was invisible below
 * about 15%, which is exactly the range where a user most needs to see that
 * something has started.
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
    <div className={cn("flex items-center gap-[var(--space-2)]", className)}>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${clamped}% complete`}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-full)] bg-[var(--chart-track)]"
      >
        <div
          className={cn(
            "h-full rounded-[var(--radius-full)]",
            "transition-[width] duration-[var(--dur-base)] ease-[var(--ease-linear)]",
            // Both tones are teal, because both mean the same thing here: work is
            // proceeding. `signal` is the brighter mark, used while a stage is
            // genuinely active, so an in-flight row reads hotter than a settled
            // one without introducing a second hue.
            tone === "signal" ? "bg-[var(--brand-mark)]" : "bg-[var(--brand-primary)]",
          )}
          // Width is the only honest channel for a progress value, so this is the
          // one place a non-transform property is animated on purpose.
          style={{ width: `${clamped}%` }}
        />
      </div>

      {showValue && (
        <span className="app-figure shrink-0 text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]">
          {clamped}%
        </span>
      )}
    </div>
  );
}
