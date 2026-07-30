import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "action" | "signal" | "warning";

const toneClasses: Record<BadgeTone, string> = {
  neutral:
    "border-[var(--color-border-hairline)] text-[color:var(--color-text-muted)]",
  action:
    "border-[var(--color-action)] text-[color:var(--color-action)] bg-[var(--color-action-wash)]",
  signal:
    "border-[var(--color-signal)] text-[color:var(--color-signal)] bg-[var(--color-signal-wash)]",
  warning:
    "border-[var(--color-warning)] text-[color:var(--color-warning)]",
};

/**
 * Small non-interactive label: format ratios, platform names, provenance tags.
 * Square-ish by design — the site does not use pills as decoration.
 */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1",
        "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
