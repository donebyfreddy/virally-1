import { Eyebrow } from "@/components/primitives/Eyebrow";
import { cn } from "@/lib/cn";
import { pipelinePreview } from "@/content/auth";

/**
 * The right-hand panel: the supply chain, drawn as structure.
 *
 * Three deliberate constraints:
 *
 * - It is a server component with no JavaScript. The entry stagger is pure CSS
 *   behind `motion-safe:`, so reduced motion gets the final state for free and
 *   the auth route ships no motion library.
 * - It carries no numbers that could be mistaken for performance data. A
 *   visitor with no account has no metrics, and inventing some would be the
 *   first false thing the product said.
 * - The multiplication is rendered as real DOM nodes, not a picture of nodes,
 *   so the count is readable by a screen reader as text.
 */
export function PipelinePreview() {
  return (
    <div className="flex h-full flex-col justify-center px-[var(--space-16)] py-16">
      <Eyebrow>{pipelinePreview.eyebrow}</Eyebrow>

      <ol className="mt-8 flex flex-col">
        {pipelinePreview.stages.map((stage, index) => (
          <li
            key={stage.id}
            className={cn(
              "relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 pb-8",
              // The connector rail. Zero radius, hairline — rails are never
              // rounded and never carry contrast duty.
              index < pipelinePreview.stages.length - 1 &&
                "before:absolute before:left-[0.4375rem] before:top-6 before:h-full before:w-px before:bg-[var(--color-border-hairline)]",
              "motion-safe:animate-[virally-stage-in_var(--dur-panel)_var(--ease-settle)_backwards]",
            )}
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <span
              aria-hidden="true"
              className="relative z-[var(--z-raised)] mt-1.5 size-3.5 shrink-0 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-canvas)]"
            />

            <div>
              <div className="flex items-baseline gap-3">
                <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                  {stage.index}
                </span>
                <h2 className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-primary)]">
                  {stage.label}
                </h2>
              </div>

              <p className="mt-2 max-w-[var(--measure-narrow)] text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                {stage.detail}
              </p>

              <FanOut count={stage.fanOut} label={stage.label} />
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
        {pipelinePreview.caption}
      </p>
    </div>
  );
}

/**
 * The multiplication made visible: one tile per artefact this stage produces.
 *
 * Single-output stages render nothing — a lone tile would read as a bullet and
 * say nothing about fan-out.
 */
function FanOut({ count, label }: { count: number; label: string }) {
  if (count <= 1) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="sr-only">{`${count} ${label.toLowerCase()} produced at this stage`}</span>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            "h-4 w-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)]",
            "motion-safe:animate-[virally-stage-in_var(--dur-base)_var(--ease-settle)_backwards]",
          )}
          style={{ animationDelay: `${300 + i * 40}ms` }}
        />
      ))}
      <span className="ml-2 font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
        ×{count}
      </span>
    </div>
  );
}
