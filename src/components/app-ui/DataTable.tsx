import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The product's table.
 *
 * A real `<table>` with `<th scope>` headers, not a grid of divs. A campaign or
 * content list IS tabular data, and the semantic element gives row/column
 * association, screen-reader table navigation and correct reading order for
 * free — all of which a div grid has to reimplement and usually does not.
 *
 * Two structural changes in this rewrite:
 *
 *   - The header is a banded row on `--surface-muted` with sentence-case labels,
 *     rather than wide-tracked uppercase mono on the card surface. The band is
 *     what separates header from body; the old version needed a rule to do it and
 *     still read as part of the first data row.
 *   - The negative margin is gone. It assumed the table always sat inside a
 *     `--app-panel-pad` panel and silently broke anywhere else. The table now
 *     bleeds to its container's edge and pads its own cells, so the correct
 *     parent is `<CardBody pad="none">`.
 *
 * Horizontal overflow is contained here rather than on the page, so a wide table
 * scrolls inside its own card and the page body never scrolls sideways at 390px.
 */

export type Column<Row> = {
  /** Stable key, also used for the React key on cells. */
  id: string;
  header: string;
  /** Renders the cell. Given the whole row so it can combine fields. */
  cell: (row: Row) => ReactNode;
  /** Right-aligned for numeric columns so figures line up. */
  numeric?: boolean;
  /**
   * Hides the column below this breakpoint. Dense tables must shed columns on
   * narrow viewports rather than compress every column into illegibility.
   */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Fixed width, e.g. "8rem". Omit to size to content. */
  width?: string;
};

const hideClasses: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  /** Wraps each row's first cell in a link target. Return null for a static row. */
  rowHref,
  className,
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | null;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left">
        {/* Named for screen readers; the card heading carries it visually. */}
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr className="bg-[var(--surface-muted)]">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  "whitespace-nowrap px-[var(--space-4)] py-[var(--space-2)]",
                  "text-[length:var(--text-app-label)] font-[var(--weight-strong)]",
                  "text-[color:var(--text-muted)]",
                  "first:pl-[var(--app-panel-pad)] last:pr-[var(--app-panel-pad)]",
                  column.numeric && "text-right",
                  column.hideBelow && hideClasses[column.hideBelow],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row) ?? null;
            return (
              <tr
                key={rowKey(row)}
                className={cn(
                  "border-b border-[var(--border-subtle)] last:border-b-0",
                  "transition-colors duration-[var(--dur-instant)]",
                  href && "hover:bg-[var(--surface-secondary)]",
                )}
              >
                {columns.map((column, index) => {
                  const content = column.cell(row);
                  return (
                    <td
                      key={column.id}
                      className={cn(
                        "px-[var(--space-4)] py-[var(--space-3)]",
                        "text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]",
                        "first:pl-[var(--app-panel-pad)] last:pr-[var(--app-panel-pad)]",
                        column.numeric && "app-figure text-right",
                        column.hideBelow && hideClasses[column.hideBelow],
                      )}
                    >
                      {/*
                        The link wraps only the first cell rather than the row. An
                        <a> cannot contain <td>s, and stretching an overlay across
                        the row would swallow the per-row action buttons in the
                        last column. The first cell is the row's name, so it is
                        also the sensible link text.
                      */}
                      {href && index === 0 ? (
                        <a
                          href={href}
                          className="block rounded-[var(--radius-chip)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                        >
                          {content}
                        </a>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The primary cell of a row: a name with a line of metadata under it.
 *
 * Extracted because every list page needs it and hand-rolling it produced four
 * slightly different versions of the same two-line cell.
 */
export function PrimaryCell({
  title,
  detail,
  /** A thumbnail, avatar or platform glyph. */
  leading,
}: {
  title: string;
  detail?: string;
  leading?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-[var(--space-3)]">
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0">
        <span className="block truncate font-[var(--weight-strong)] text-[color:var(--text-primary)]">
          {title}
        </span>
        {detail && (
          <span className="block truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * A square media/avatar slot for `PrimaryCell`'s leading slot.
 *
 * Renders a real thumbnail when there is one and a lettered fallback when there
 * is not — a broken-image glyph in a table is worse than no image, and an empty
 * box makes the column look misaligned.
 */
export function CellThumb({
  src,
  alt,
  fallback,
}: {
  src?: string | null;
  alt?: string;
  fallback: string;
}) {
  if (src) {
    return (
      // Sources are signed storage URLs on arbitrary hosts, which next/image
      // cannot optimise without a remote-pattern allowlist per tenant. For a
      // 36px cell the parts that actually matter are `loading="lazy"` and the
      // fixed intrinsic box, both of which are set below.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
        width={36}
        height={36}
        className="size-9 rounded-[var(--radius-chip)] border border-[var(--border-subtle)] object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 items-center justify-center rounded-[var(--radius-chip)]",
        "bg-[var(--surface-muted)] text-[length:var(--text-app-meta)]",
        "font-[var(--weight-heading)] text-[color:var(--text-muted)]",
      )}
    >
      {fallback.charAt(0).toUpperCase()}
    </span>
  );
}
