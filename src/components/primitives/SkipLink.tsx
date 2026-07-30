import { cn } from "@/lib/cn";

/**
 * Visible only on keyboard focus. Positioned above everything so it cannot be
 * covered by the sticky nav.
 */
export function SkipLink({
  href = "#main",
  children = "Skip to main content",
  className,
}: {
  href?: string;
  children?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={cn(
        "sr-only focus:not-sr-only",
        "focus:fixed focus:left-4 focus:top-4 focus:z-[var(--z-skiplink)]",
        "focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-[var(--radius-sm)]",
        "focus:bg-[var(--color-action)] focus:px-4 focus:text-[color:var(--color-text-oncolor)]",
        "focus:font-utility focus:text-[length:var(--text-utility)] focus:uppercase focus:tracking-[var(--tracking-utility)]",
        className,
      )}
    >
      {children}
    </a>
  );
}
