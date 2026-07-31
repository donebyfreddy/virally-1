import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The product's surface primitive.
 *
 * This is deliberately NOT the generic `<Card>` the design brief forbids. The
 * distinction is that a Card owns a layout skeleton — media slot, title, body,
 * footer — which is what makes every section built from one look identical.
 * `Panel` owns only the four properties a surface has: which step of the
 * elevation ramp it sits on, whether it has a boundary, how much padding, and
 * its radius. It renders `children` verbatim and imposes no internal structure.
 *
 * Every distinct product surface (plan summary, KPI strip, queue row, inspector)
 * composes its own layout inside a Panel rather than inheriting one from it.
 */

export type PanelTone =
  /** Default product surface, one step above canvas. */
  | "default"
  /** A control or nested surface sitting ON a default panel. */
  | "raised"
  /** Recessed: preview wells, code, empty containers. */
  | "inset"
  /**
   * The one ambient treatment — a barely-there cool lift for a hero panel.
   * Not a glow and not glassmorphism: opaque, no blur, no hue outside the
   * existing slate ramp, and it never carries information.
   */
  | "wash";

const toneClasses: Record<PanelTone, string> = {
  default: "bg-[var(--app-panel)]",
  raised: "bg-[var(--app-panel-raised)]",
  inset: "bg-[var(--app-panel-inset)]",
  wash: "bg-[var(--app-panel-wash)]",
};

export type PanelPad = "none" | "tight" | "default" | "loose";

const padClasses: Record<PanelPad, string> = {
  none: "",
  tight: "p-[var(--app-panel-pad-tight)]",
  default: "p-[var(--app-panel-pad)]",
  loose: "p-[var(--app-panel-pad-loose)]",
};

export function Panel({
  children,
  as: Tag = "div",
  tone = "default",
  pad = "default",
  /**
   * Hairline by default. `border={false}` is for a panel that sits inside
   * another bordered panel, where a second boundary reads as a seam.
   */
  border = true,
  className,
  ...rest
}: {
  children: ReactNode;
  as?: ElementType;
  tone?: PanelTone;
  pad?: PanelPad;
  border?: boolean;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      className={cn(
        "rounded-[var(--radius-card)]",
        toneClasses[tone],
        padClasses[pad],
        // Same border and hairline elevation as `Card`. The two must not drift:
        // Panel is the unstructured surface and Card is the structured one, but a
        // page mixing them should not show two different card treatments.
        border && "border border-[var(--border-default)] shadow-[var(--elevation-card)]",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A titled region inside a Panel.
 *
 * Exists because the alternative — every caller hand-rolling the
 * uppercase-label-plus-optional-action row — produced six slightly different
 * versions of the same header during the first pass. It supplies the label row
 * only; the body is still the caller's own layout.
 */
export function PanelSection({
  title,
  /** Rendered at the end of the title row: a count, a link, a small control. */
  aside,
  children,
  className,
  id,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex min-h-6 items-center justify-between gap-[var(--space-4)]">
        {/* Sentence case at reading weight, not wide-tracked uppercase. A section
            label is a heading; uppercase in the product is reserved for the
            compact utility labels on table columns and KPI captions. */}
        <h2 id={id} className="app-card-title text-[color:var(--text-primary)]">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-[var(--space-3)]">{children}</div>
    </section>
  );
}
