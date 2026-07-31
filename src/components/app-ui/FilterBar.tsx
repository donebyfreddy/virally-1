"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The list-page filter bar: search, dimension filters, and a view toggle.
 *
 * State lives in the URL, not in component state. Three consequences that all
 * matter for a product like this: a filtered list is a shareable link, the
 * browser back button undoes a filter, and the page stays a server component
 * that re-queries with the filter applied rather than fetching everything and
 * hiding rows on the client.
 *
 * `useTransition` keeps the current list interactive and visible while the
 * server re-queries, instead of blanking to a skeleton on every keystroke.
 */

export type FilterOption = { id: string; label: string };

export type FilterDefinition = {
  /** URL search-param key. */
  key: string;
  label: string;
  options: readonly FilterOption[];
};

export function FilterBar({
  filters,
  searchPlaceholder = "Search",
  /** Omit to hide the grid/table toggle on pages with a single view. */
  views,
  className,
}: {
  filters: readonly FilterDefinition[];
  searchPlaceholder?: string;
  views?: readonly ("grid" | "table")[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "" || value === "all") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      // Any filter change returns to the first page; staying on page 4 of a
      // narrower result set shows an empty list and looks like a bug.
      next.delete("page");
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  const activeView = params.get("view") ?? views?.[0] ?? "table";
  const query = params.get("q") ?? "";
  const activeFilterCount = filters.filter((filter) => params.get(filter.key)).length;

  return (
    <div
      aria-busy={pending || undefined}
      className={cn(
        "flex flex-wrap items-center gap-[var(--space-2)]",
        // A quiet busy signal rather than a spinner: the list below stays
        // readable and only dims slightly while the server re-queries.
        pending && "opacity-70 transition-opacity duration-[var(--dur-instant)]",
        className,
      )}
    >
      <label className="relative flex min-w-0 flex-1 items-center sm:max-w-[22rem]">
        <span className="sr-only">{searchPlaceholder}</span>
        <Search
          aria-hidden="true"
          size={16}
          strokeWidth={1.5}
          className="pointer-events-none absolute left-[var(--space-3)] text-[color:var(--color-text-muted)]"
        />
        <input
          type="search"
          defaultValue={query}
          placeholder={searchPlaceholder}
          // `onChange` would re-query per keystroke. Committing on Enter or blur
          // is one query per intent, and the native search input already offers
          // a clear button.
          onKeyDown={(event) => {
            if (event.key === "Enter") setParam("q", event.currentTarget.value);
          }}
          onBlur={(event) => {
            if (event.currentTarget.value !== query) setParam("q", event.currentTarget.value);
          }}
          className={cn(
            "min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)]",
            "bg-[var(--color-surface-1)] pl-[calc(var(--space-3)*2+16px)] pr-[var(--space-3)]",
            "text-[length:var(--text-app-cell)] text-[color:var(--color-text-primary)]",
            "placeholder:text-[color:var(--color-text-muted)]",
            "transition-colors duration-[var(--dur-instant)]",
            "hover:border-[var(--color-border)]",
          )}
        />
      </label>

      {filters.map((filter) => {
        const value = params.get(filter.key) ?? "all";
        const active = value !== "all";
        return (
          <label key={filter.key} className="relative">
            <span className="sr-only">{filter.label}</span>
            <select
              value={value}
              onChange={(event) => setParam(filter.key, event.target.value)}
              className={cn(
                "min-h-11 cursor-pointer appearance-none rounded-[var(--radius-sm)] border",
                "bg-[var(--color-surface-1)] px-[var(--space-3)] pr-[var(--space-8)]",
                "text-[length:var(--text-app-cell)]",
                "transition-colors duration-[var(--dur-instant)]",
                active
                  ? "border-[var(--color-action)] text-[color:var(--color-text-primary)]"
                  : "border-[var(--color-border-hairline)] text-[color:var(--color-text-secondary)] hover:border-[var(--color-border)]",
              )}
            >
              <option value="all" className="bg-[var(--color-surface-2)]">
                {filter.label}: all
              </option>
              {filter.options.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  className="bg-[var(--color-surface-2)] text-[color:var(--color-text-primary)]"
                >
                  {option.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-[var(--space-3)] top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)]"
            >
              ▾
            </span>
          </label>
        );
      })}

      {/* Only offered when something is actually filtered, so the control does
          not sit there inert on an unfiltered list. */}
      {(activeFilterCount > 0 || query) && (
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            filters.forEach((filter) => next.delete(filter.key));
            next.delete("q");
            next.delete("page");
            startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
          }}
          className={cn(
            "flex min-h-11 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-3)]",
            "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
            "text-[color:var(--color-text-muted)] transition-colors duration-[var(--dur-instant)]",
            "hover:text-[color:var(--color-text-primary)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
          )}
        >
          <X aria-hidden="true" size={14} strokeWidth={1.5} />
          Clear
        </button>
      )}

      {views && views.length > 1 && (
        <div
          role="group"
          aria-label="View"
          className="ml-auto flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] p-[var(--space-1)]"
        >
          {views.map((view) => {
            const Icon = view === "grid" ? LayoutGrid : List;
            const selected = activeView === view;
            return (
              <button
                key={view}
                type="button"
                aria-pressed={selected}
                onClick={() => setParam("view", view)}
                className={cn(
                  "flex min-h-9 min-w-9 items-center justify-center rounded-[var(--radius-sm)]",
                  "transition-colors duration-[var(--dur-instant)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                  selected
                    ? "bg-[var(--color-surface-3)] text-[color:var(--color-text-primary)]"
                    : "text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]",
                )}
              >
                <Icon aria-hidden="true" size={16} strokeWidth={1.5} />
                <span className="sr-only">{view === "grid" ? "Grid view" : "Table view"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
