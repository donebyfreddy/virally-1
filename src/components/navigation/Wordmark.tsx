import { cn } from "@/lib/cn";

/**
 * Placeholder wordmark. [BRAND LOGO REQUIRED]
 *
 * Built from type and a CSS glyph rather than imported artwork so it carries
 * no false authority and costs no request. The chevron reads as a play head —
 * the one visual pun the design allows itself.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-0",
          "border-y-[7px] border-l-[11px] border-r-0",
          "border-y-transparent border-l-[var(--color-action)]",
        )}
      />
      <span
        className={cn(
          "font-display text-[1.0625rem] uppercase",
          "tracking-[0.06em] text-[color:var(--color-text-primary)]",
        )}
      >
        Virally
      </span>
    </span>
  );
}
