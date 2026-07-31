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
 * Horizontal overflow is contained here rather than on the page, so a wide table
 * scrolls inside its own panel and the page body never scrolls sideways at
 * 390px.
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
  /** Wraps each row in a link target. Returns null for a non-navigable row. */
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
    <div className={cn("-mx-[var(--app-panel-pad)] overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left">
        {/* Named for screen readers; the panel heading carries it visually. */}
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  "border-b border-[var(--color-border-hairline)]",
                  "px-[var(--space-3)] pb-[var(--space-3)]",
                  "font-utility text-[length:var(--text-utility-xs)] font-medium uppercase tracking-[var(--tracking-utility)]",
                  "text-[color:var(--color-text-muted)]",
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
                  "border-b border-[var(--color-border-hairline)] last:border-b-0",
                  "transition-colors duration-[var(--dur-instant)]",
                  href && "hover:bg-[var(--color-surface-2)]",
                )}
              >
                {columns.map((column, index) => {
                  const content = column.cell(row);
                  return (
                    <td
                      key={column.id}
                      className={cn(
                        "px-[var(--space-3)] py-[var(--space-3)]",
                        "text-[length:var(--text-app-cell)] text-[color:var(--color-text-secondary)]",
                        column.numeric && "text-right font-utility tabular-nums",
                        column.hideBelow && hideClasses[column.hideBelow],
                      )}
                    >
                      {/*
                        The link wraps only the first cell rather than the row.
                        An <a> cannot contain <td>s, and stretching an overlay
                        across the row would swallow the per-row action buttons
                        in the last column. The first cell is the row's name, so
                        it is also the sensible link text.
                      */}
                      {href && index === 0 ? (
                        <a
                          href={href}
                          className="block rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
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
  /** A thumbnail or platform glyph. */
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
        <span className="block truncate text-[color:var(--color-text-primary)]">{title}</span>
        {detail && (
          <span className="block truncate font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}
