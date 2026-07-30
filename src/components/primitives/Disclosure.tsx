"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Native `<details>`-equivalent built on a button + region so the open state
 * can be animated and observed. Used for chart text equivalents and the
 * Multiplier's structured tree.
 *
 * The content is unmounted when closed rather than visually hidden, keeping it
 * out of the tab order without needing `inert`.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("w-full", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex min-h-11 w-full items-center gap-3 py-2 text-left",
          "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
          "text-[color:var(--color-text-secondary)]",
          "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
          "hover:text-[color:var(--color-text-primary)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block transition-transform duration-[var(--dur-base)] ease-[var(--ease-cut)]",
            open && "rotate-90",
          )}
        >
          ▸
        </span>
        {summary}
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}
