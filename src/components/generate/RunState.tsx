import { AlertCircle, Check, CircleDashed, CircleSlash, Loader } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { isTerminalRunState } from "@/lib/creative/types";
import type { ProviderRunState } from "@/lib/creative/types";
import { cn } from "@/lib/cn";
import { RUN_STATE_LABELS, generateCopy } from "@/content/generate";

/**
 * Machine state for one generation run.
 *
 * Deliberately separate from `StatusChip`, which reports where a human review
 * stands. This reports what the provider is doing, and the two must not share a
 * vocabulary: "Needs review" and "Generating" are answers to different
 * questions and a single chip that mixes them teaches nothing.
 *
 * No directive, so both the server-rendered history grid and the client queue
 * render the same chip. A second implementation on the client side would drift
 * within a week.
 */

const STATE_STYLE: Readonly<Record<ProviderRunState, { icon: LucideIcon; classes: string }>> = {
  planned: { icon: CircleDashed, classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]" },
  queued: { icon: CircleDashed, classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]" },
  submitted: { icon: Loader, classes: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]" },
  waiting_external: { icon: Loader, classes: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]" },
  generating: { icon: Loader, classes: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]" },
  downloading: { icon: Loader, classes: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]" },
  validating: { icon: Loader, classes: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]" },
  completed: { icon: Check, classes: "bg-[var(--success-soft)] text-[color:var(--success)]" },
  failed: { icon: AlertCircle, classes: "bg-[var(--error-soft)] text-[color:var(--error)]" },
  cancelled: { icon: CircleSlash, classes: "bg-[var(--surface-muted)] text-[color:var(--text-muted)]" },
  dead_letter: { icon: AlertCircle, classes: "bg-[var(--error-soft)] text-[color:var(--error)]" },
};

export function runStateLabel(state: ProviderRunState): string {
  return RUN_STATE_LABELS[state];
}

export function isInFlight(state: ProviderRunState): boolean {
  return !isTerminalRunState(state);
}

/**
 * The state chip.
 *
 * Icon plus word, never colour alone. The glyph spins only while the machine is
 * actually working and only under `motion-safe`, so a reduced-motion reader
 * still gets a static icon and the word beside it.
 */
export function RunStateChip({
  state,
  className,
}: {
  state: ProviderRunState;
  className?: string;
}) {
  const { icon: Icon, classes } = STATE_STYLE[state];
  const spinning = isInFlight(state) && state !== "planned" && state !== "queued";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-chip)] px-2 py-1",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        classes,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        size={12}
        strokeWidth={2.25}
        className={cn("shrink-0", spinning && "motion-safe:animate-spin")}
      />
      {RUN_STATE_LABELS[state]}
    </span>
  );
}

/**
 * Progress for one run.
 *
 * `progress` is `number | null` and null is the COMMON case — fal reports a
 * queue position, never a percentage — so the indeterminate branch is the one
 * that had to be designed properly rather than treated as a fallback. It
 * states that progress is unknown in words as well as in the animation,
 * because an animation carries no information under `prefers-reduced-motion`
 * and must never be the only channel.
 */
export function RunProgress({
  progress,
  label,
  className,
}: {
  progress: number | null;
  /** What is progressing. Used in the accessible name. */
  label: string;
  className?: string;
}) {
  if (progress === null) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div
          role="progressbar"
          aria-label={label}
          // No `aria-valuenow`: an indeterminate progressbar omits it, which is
          // exactly what tells a screen reader the value is unknown. Supplying a
          // zero here would announce "0%", which is a claim we cannot make.
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded-[var(--radius-full)] bg-[var(--chart-track)]"
        >
          <div
            aria-hidden="true"
            className={cn(
              "h-full w-1/4 rounded-[var(--radius-full)] bg-[var(--brand-mark)]",
              "motion-safe:animate-[virally-app-indeterminate_1.6s_var(--ease-linear)_infinite]",
            )}
          />
        </div>
        <p className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {generateCopy.queueIndeterminate}
        </p>
      </div>
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(progress)));

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
            "h-full rounded-[var(--radius-full)] bg-[var(--brand-mark)]",
            "transition-[width] duration-[var(--dur-base)] ease-[var(--ease-linear)]",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="app-figure shrink-0 text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]">
        {clamped}%
      </span>
    </div>
  );
}

/**
 * Provenance marker for stand-in bytes.
 *
 * The label is imported rather than written, so the string on an asset row is
 * the same string the mock provider stamped on the asset itself.
 */
export function DemoChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-chip)]",
        "bg-[var(--warning-soft)] px-1.5 py-0.5",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        "text-[color:var(--warning)]",
        className,
      )}
    >
      {label}
    </span>
  );
}
