import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type MotionSectionProps = {
  id: string;
  children: ReactNode;
  className?: string;
  /** Sets the section band. `canvas` is the default; `raised` uses surface-1. */
  surface?: "canvas" | "raised";
  /** Renders a top hairline rule. Sections are separated by rules, not cards. */
  ruled?: boolean;
  "aria-labelledby"?: string;
};

/**
 * Standard section wrapper: landmark semantics, vertical rhythm, band surface,
 * and below-the-fold render containment.
 *
 * This is a Server Component — it carries no motion itself despite the name
 * (kept for the primitive naming contract). Sections opt into their own
 * mechanic via client children, so a static section ships zero JS.
 */
export function MotionSection({
  id,
  children,
  className,
  surface = "canvas",
  ruled = true,
  ...rest
}: MotionSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={rest["aria-labelledby"]}
      className={cn(
        "relative w-full",
        "py-20 md:py-32",
        surface === "raised" && "bg-[var(--color-surface-1)]",
        ruled && "border-t border-[var(--color-border-hairline)]",
        // Skips layout/paint for off-screen sections. The intrinsic size keeps
        // the scrollbar honest so CLS stays flat.
        "[content-visibility:auto] [contain-intrinsic-size:auto_800px]",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Constrained content column. Widths come from tokens, never ad hoc. */
export function SectionContainer({
  children,
  className,
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: "wide" | "max" | "text";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-[var(--gutter)]",
        width === "wide" && "max-w-[var(--container-wide)]",
        width === "max" && "max-w-[var(--container-max)]",
        width === "text" && "max-w-[var(--container-text)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
