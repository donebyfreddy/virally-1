import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The page container every product route opens with.
 *
 * Exists to make the gutter and max-width one decision rather than thirteen.
 * Before this, each page repeated its own `mx-auto max-w-… px-… py-…` string, and
 * they had already drifted apart by a step of the spacing scale.
 *
 * `width="wide"` caps at `--app-content-max` (1536px) rather than the marketing
 * site's 1248px container. A dashboard is not a reading column: at 1248px a
 * ten-column operational table on a 1920px display wastes 400px of the space the
 * table needs, and a performance chart squeezed into a narrower box loses
 * resolution on exactly the axis it is measuring.
 *
 * `width="full"` is for surfaces that genuinely need the whole viewport — the
 * calendar grid and the content editor — where centring inside any column wastes
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
        "w-full px-[var(--app-gutter)] py-[var(--space-6)]",
        width === "wide" && "mx-auto max-w-[var(--app-content-max)]",
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
  return <div className={cn("flex flex-col gap-[var(--space-6)]", className)}>{children}</div>;
}

/**
 * The dashboard grid.
 *
 * A 12-column grid at `xl`, collapsing to a single column below `lg`. Children
 * position themselves with `col-span-*`, which is what lets a dashboard mix an
 * 8-column chart with a 4-column rail of compact cards — the varied card sizes the
 * layout depends on. A grid of identical thirds is the shape that makes every
 * dashboard look the same.
 */
export function DashGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-[var(--app-panel-gap)] lg:grid-cols-2 xl:grid-cols-12",
        className,
      )}
    >
      {children}
    </div>
  );
}
