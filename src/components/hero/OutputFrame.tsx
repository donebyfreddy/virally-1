import { RATIOS, type RatioKey } from "@/components/motion/AspectRatioMorph";
import { cn } from "@/lib/cn";

/**
 * Abstract stand-in for a generated frame. [REAL HERO OUTPUTS REQUIRED]
 *
 * Drawn in CSS from neutral surface tokens rather than shipping a stock image
 * or a fabricated screenshot: it reads as a composition without pretending to
 * be customer work. The accent colours are deliberately absent — amber and
 * teal mean "decide" and "working", and a poster is neither.
 */
export function OutputFrame({
  ratio,
  seed,
  rendered,
  className,
}: {
  ratio: RatioKey;
  /** Varies the composition so the six frames are not identical. */
  seed: number;
  rendered: boolean;
  className?: string;
}) {
  const offsetX = 18 + ((seed * 23) % 40);
  const offsetY = 22 + ((seed * 37) % 36);
  const scale = 26 + ((seed * 13) % 22);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-[var(--radius-sm)]",
        "bg-[var(--color-surface-2)]",
        className,
      )}
      style={{ aspectRatio: String(RATIOS[ratio]) }}
    >
      {rendered ? (
        <div className="absolute inset-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[var(--color-surface-3)]" />
          <div
            className="absolute rounded-full bg-[var(--color-text-muted)] opacity-30"
            style={{
              left: `${offsetX}%`,
              top: `${offsetY}%`,
              width: `${scale}%`,
              aspectRatio: "1",
            }}
          />
          <div
            className="absolute rounded-full bg-[var(--color-text-secondary)] opacity-20"
            style={{
              left: `${offsetX + 14}%`,
              top: `${offsetY + 18}%`,
              width: `${scale * 0.55}%`,
              aspectRatio: "1",
            }}
          />
          {/* Subject-safe area marker — the format engine's argument in miniature. */}
          <div className="absolute inset-x-2 bottom-2 h-1.5 rounded-[var(--radius-sm)] bg-[var(--color-text-primary)] opacity-25" />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 bg-[var(--color-surface-2)]",
            "motion-safe:animate-pulse",
          )}
        />
      )}
    </div>
  );
}
