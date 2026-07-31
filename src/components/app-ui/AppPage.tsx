import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The page container every product route opens with.
 *
 * Exists to make the gutter and max-width one decision rather than thirteen.
 * Before this, each page repeated its own `mx-auto max-w-… px-… py-…` string,
 * and they had already drifted apart by a step of the spacing scale — which is
 * exactly the "inconsistent spacing" the brief calls out.
 *
 * `width="full"` is for surfaces that genuinely need the viewport — the calendar
 * grid and the content editor — where centring inside a 1248px column wastes the
 * horizontal space the layout depends on.
 */
export function AppPage({
  children,
  width = "wide",
  className,
}: {
  children: ReactNode;
  width?: "wide" | "full" | "text";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full px-[var(--app-gutter)] py-[var(--space-8)]",
        width === "wide" && "mx-auto max-w-[var(--container-wide)]",
        width === "text" && "mx-auto max-w-[var(--container-text)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Vertical rhythm between a page's major blocks.
 *
 * One gap value, applied by the parent, rather than a margin on each child:
 * sibling margins collapse differently depending on what is rendered, so a
 * conditional block would silently change the spacing above the block after it.
 */
export function PageStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-[var(--space-8)]", className)}>{children}</div>
  );
}
