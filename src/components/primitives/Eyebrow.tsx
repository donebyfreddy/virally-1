import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Section eyebrow. Utility role, uppercase, wide tracking — the small
 * technical label that anchors each display headline.
 */
export function Eyebrow({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <p
      id={id}
      className={cn(
        "font-utility uppercase",
        "text-[length:var(--text-utility-xs)] tracking-[var(--tracking-eyebrow)]",
        "text-[color:var(--color-text-muted)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Zero-radius hairline divider. Sections separate with rules, not cards. */
export function Rule({ className }: { className?: string }) {
  return (
    <hr
      className={cn("h-px w-full border-0 bg-[var(--color-border-hairline)]", className)}
    />
  );
}
