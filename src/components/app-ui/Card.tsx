import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The product's card system.
 *
 * `Panel` (see Panel.tsx) remains the low-level surface: it owns only elevation,
 * boundary, padding and radius, and imposes no internal structure. That is the
 * right primitive for a bespoke composition like the editor inspector.
 *
 * `Card` is the layer above it, and it exists because the product has one
 * recurring shape — a bordered white surface with an optional titled header, a
 * body, and an optional footer — which was being hand-rolled per page. Six
 * slightly different versions of the same header row is what makes a dashboard
 * look assembled rather than designed.
 *
 * The distinction the design brief draws still holds: there is no single
 * universal card that everything is poured into. `Card` supplies the frame;
 * `CardBody` renders its children verbatim, so each surface still composes its
 * own interior. The specialised cards further down (KpiCard) are the cases where
 * the interior IS the pattern.
 */

export type CardTone =
  /** Default: white. Everything sits on this unless it has a reason not to. */
  | "default"
  /** A nested surface ON a card — a control strip, a sub-panel. */
  | "muted"
  /** Recessed: preview wells, drop targets, empty containers. */
  | "inset";

const toneClasses: Record<CardTone, string> = {
  default: "bg-[var(--surface-primary)] border-[var(--border-default)]",
  muted: "bg-[var(--surface-secondary)] border-[var(--border-default)]",
  inset: "bg-[var(--surface-muted)] border-[var(--border-subtle)]",
};

export type CardPad = "none" | "tight" | "default" | "loose";

const padClasses: Record<CardPad, string> = {
  none: "",
  tight: "p-[var(--app-panel-pad-tight)]",
  default: "p-[var(--app-panel-pad)]",
  loose: "p-[var(--app-panel-pad-loose)]",
};

export function Card({
  children,
  as: Tag = "div",
  tone = "default",
  /** `none` when the card contains its own header/body/footer, which pad themselves. */
  pad = "none",
  /**
   * Lifts the card on hover. For cards that are themselves a link target —
   * campaign tiles, content tiles. Not for static containers, where a hover
   * response promises an interaction that does not exist.
   */
  interactive = false,
  className,
  ...rest
}: {
  children: ReactNode;
  as?: ElementType;
  tone?: CardTone;
  pad?: CardPad;
  interactive?: boolean;
  className?: string;
  // `AnchorHTMLAttributes` rather than `HTMLAttributes`: it is a superset, and it
  // is what lets `as="a"` pass `href` without a cast. A card rendered as a `div`
  // simply never sets the anchor-only members.
} & Omit<React.AnchorHTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      className={cn(
        "rounded-[var(--radius-card)] border",
        // One hairline shadow, not a glow. On a light theme the border does the
        // separating; the shadow only says "this floats above the canvas".
        "shadow-[var(--elevation-card)]",
        toneClasses[tone],
        padClasses[pad],
        interactive && [
          "transition-[box-shadow,border-color] duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
          "hover:border-[var(--border-strong)] hover:shadow-[var(--elevation-raised)]",
          "focus-within:border-[var(--brand-primary)]",
        ],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A card's header row.
 *
 * `divided` draws the rule under the header. Wanted on a card whose body is a
 * table or a chart, where the header is a distinct band; not wanted on a card
 * whose body is prose, where a rule cuts a single thought in half.
 */
export function CardHeader({
  title,
  /** One quiet line under the title. Not a paragraph — this is a card, not a page. */
  description,
  /** Rendered at the end of the row: a link, a count, a small control, a filter. */
  action,
  /** Heading level. Defaults to h3, since a card sits under a section heading. */
  as: Tag = "h3",
  id,
  divided = false,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  as?: ElementType;
  id?: string;
  divided?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-[var(--space-4)]",
        "px-[var(--app-panel-pad)] pt-[var(--app-panel-pad)]",
        divided && "border-b border-[var(--border-subtle)] pb-[var(--app-panel-pad)]",
        className,
      )}
    >
      <div className="min-w-0">
        <Tag id={id} className="app-card-title text-[color:var(--text-primary)]">
          {title}
        </Tag>
        {description && (
          <p className="mt-1 text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-[var(--space-2)]">{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  /** `none` for a body that is a table or a chart, which bleed to the card edge. */
  pad = "default",
  className,
}: {
  children: ReactNode;
  pad?: CardPad;
  className?: string;
}) {
  return (
    <div
      className={cn(
        pad === "default" && "p-[var(--app-panel-pad)]",
        pad === "tight" && "p-[var(--app-panel-pad-tight)]",
        pad === "loose" && "p-[var(--app-panel-pad-loose)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A card's footer.
 *
 * Sits on the muted surface with a rule above it, so a "view all" link or a
 * summary total reads as a separate register from the body content.
 */
export function CardFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-[var(--space-3)]",
        "rounded-b-[calc(var(--radius-card)-1px)] border-t border-[var(--border-subtle)]",
        "bg-[var(--surface-secondary)]",
        "px-[var(--app-panel-pad)] py-[var(--space-3)]",
        "text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ==========================================================================
   KPI CARD
   ======================================================================== */

export type KpiTone = "neutral" | "brand" | "success" | "warning" | "error";

const kpiIconClasses: Record<KpiTone, string> = {
  neutral: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  brand: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]",
  success: "bg-[var(--success-soft)] text-[color:var(--success)]",
  warning: "bg-[var(--warning-soft)] text-[color:var(--warning)]",
  error: "bg-[var(--error-soft)] text-[color:var(--error)]",
};

/**
 * A single boxed KPI.
 *
 * Distinct from `Metric` (Metric.tsx), which is borderless and belongs in a
 * definition list INSIDE a panel. This one is the standalone tile at the top of
 * a dashboard, where each figure needs its own frame because they are the page's
 * primary content rather than supporting detail on a larger surface.
 *
 * `value` is a string, formatted by the caller. Formatting here would need a
 * locale and a unit convention this component cannot know, and lib/format
 * already owns it.
 */
export function KpiCard({
  label,
  value,
  /** A delta, a unit, a status dot. Rendered under the figure. */
  detail,
  /** Small leading glyph. Sized by this component, so pass the bare icon. */
  icon,
  tone = "neutral",
  /** Makes the whole tile a link target. */
  href,
  className,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      {/*
        `min-h-7` on the label row, matching the icon tile's height.

        Without it, a tile WITH an icon has a 28px first row and a tile without one
        has a 17px first row — so in a strip where only some tiles carry an icon,
        their figures sit on different baselines. In a row of six numbers meant to
        be compared at a glance, that misalignment is the first thing the eye
        catches and the hardest to name.
      */}
      <div className="flex min-h-7 items-start justify-between gap-[var(--space-3)]">
        {/*
          Sentence case, NOT the uppercase `.app-label`.

          At six tiles across a 1536px grid each caption gets about 130px, and
          uppercase at 0.06em tracking overflowed it: "Followers gained" and
          "Connected accounts" both truncated to an ellipsis, which is worse than
          any styling gain. Uppercase in this product is for table column headers,
          where the string is one or two short words by construction.
        */}
        <p className="truncate text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]">
          {label}
        </p>
        {icon && (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-chip)]",
              kpiIconClasses[tone],
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <p
        className={cn(
          "app-figure mt-[var(--space-2)] truncate",
          "text-[length:var(--text-metric)] font-[var(--weight-heading)]",
          "text-[color:var(--text-primary)]",
        )}
      >
        {value}
      </p>

      {/*
        Rendered even when empty, for the same reason as the label row above: in a
        strip where two tiles have a delta line and four do not, an absent row makes
        those four shorter and the grid's `items-stretch` then pads them unevenly.
      */}
      <div className="mt-1 flex min-h-4 items-center gap-[var(--space-2)] text-[length:var(--text-app-label)]">
        {detail}
      </div>
    </>
  );

  if (href) {
    return (
      <Card
        as="a"
        interactive
        pad="default"
        href={href}
        className={cn(
          "block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          className,
        )}
      >
        {body}
      </Card>
    );
  }

  return (
    <Card pad="default" className={className}>
      {body}
    </Card>
  );
}

/**
 * The KPI strip.
 *
 * Horizontal scroll below `sm` rather than a 1-column stack: six stacked tiles
 * push the actual dashboard two screens down, and a swipeable row is how a phone
 * user expects to read a set of peer figures. `snap-x` makes the scroll land on
 * tile boundaries instead of mid-card.
 */
export function KpiGrid({
  children,
  /** Tiles per row at `xl`. Steps down to 3 at lg and 2 at sm. */
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 3 | 4 | 5 | 6;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-[var(--app-gutter)] flex snap-x snap-mandatory gap-[var(--app-panel-gap)]",
        "overflow-x-auto px-[var(--app-gutter)] pb-1",
        "[&>*]:min-w-[13rem] [&>*]:shrink-0 [&>*]:snap-start",
        // At `sm` and up it stops being a scroller and becomes a real grid.
        "sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 sm:grid-cols-2",
        "sm:[&>*]:min-w-0",
        "lg:grid-cols-3",
        columns === 3 && "xl:grid-cols-3",
        columns === 4 && "xl:grid-cols-4",
        columns === 5 && "xl:grid-cols-5",
        columns === 6 && "xl:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
