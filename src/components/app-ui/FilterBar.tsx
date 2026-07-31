"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, LayoutGrid, List, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The list-page filter bar: search, dimension filters, and a view toggle.
 *
 * State lives in the URL, not in component state. Three consequences that all
 * matter for a product like this: a filtered list is a shareable link, the browser
 * back button undoes a filter, and the page stays a server component that
 * re-queries with the filter applied rather than fetching everything and hiding
 * rows on the client.
 *
 * That second promise needs `router.push`, not `replace`. This used `replace`,
 * which creates no history entry — so the documented undo did not exist, and the
 * view switcher beside it (built from real `<Link>`s) behaved differently from the
 * filters next to it. `push` is safe here precisely because filters commit on
 * intent (Enter, blur, change) rather than per keystroke.
 *
 * `useTransition` keeps the current list interactive and visible while the server
 * re-queries, instead of blanking to a skeleton on every keystroke.
 *
 * Visually this is now a 32px control strip on the muted surface rather than a row
 * of 44px outlined boxes. Filters are chrome above the data; when they are the
 * same weight as the table they compete with it.
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
  /**
   * `false` when the page has nothing to search. There is no default-off, because
   * the failure this prevents was silent: a page rendered the box, the user typed
   * into it, and the page's SQL ignored `q` entirely. A search input that does
   * nothing is worse than no search input.
   */
  search = true,
  /** Omit to hide the grid/table toggle on pages with a single view. */
  views,
  className,
}: {
  filters: readonly FilterDefinition[];
  searchPlaceholder?: string;
  search?: boolean;
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
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [params, pathname, router],
  );

  const activeView = params.get("view") ?? views?.[0] ?? "table";
  const query = params.get("q") ?? "";
  const activeFilterCount = filters.filter((filter) =>
    params.get(filter.key),
  ).length;

  return (
    <div
      aria-busy={pending || undefined}
      className={cn(
        "flex flex-wrap items-center gap-[var(--space-2)]",
        // A quiet busy signal rather than a spinner: the list below stays readable
        // and only dims slightly while the server re-queries.
        pending &&
          "opacity-70 transition-opacity duration-[var(--dur-instant)]",
        className,
      )}
    >
      {/*
        `basis-full` below `sm`: the search field shares a flex row with up to four
        selects, and at 390px they wrap around it and squeezed the input down to
        roughly its own magnifier glyph. Taking a whole row on narrow viewports is
        the only arrangement in which it is actually usable.
      */}
      {search && (
        <label className="relative flex min-w-0 basis-full items-center sm:flex-1 sm:basis-auto sm:max-w-[18rem]">
          <span className="sr-only">{searchPlaceholder}</span>
          <Search
            aria-hidden="true"
            size={15}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-[var(--space-3)] text-[color:var(--text-muted)]"
          />
          <input
            type="search"
            defaultValue={query}
            placeholder={searchPlaceholder}
            // `onChange` would re-query per keystroke. Committing on Enter or blur is
            // one query per intent, and the native search input already offers a
            // clear button.
            onKeyDown={(event) => {
              if (event.key === "Enter")
                setParam("q", event.currentTarget.value);
            }}
            onBlur={(event) => {
              if (event.currentTarget.value !== query)
                setParam("q", event.currentTarget.value);
            }}
            className={cn(
              "h-8 w-full rounded-[var(--radius-control)]",
              "border border-[var(--border-default)] bg-[var(--surface-primary)]",
              "pl-[calc(var(--space-3)*2+15px)] pr-[var(--space-2)]",
              "text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]",
              "placeholder:text-[color:var(--text-muted)]",
              "transition-colors duration-[var(--dur-instant)]",
              "hover:border-[var(--border-strong)]",
              // The control border is only 1.35:1, so focus cannot rely on a border
              // change. The ring is the state, and it is never removed.
              "focus:border-[var(--brand-primary)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--focus-ring)]",
            )}
          />
        </label>
      )}

      {filters.map((filter) => {
        const value = params.get(filter.key) ?? "all";
        const active = value !== "all";
        return (
          <label key={filter.key} className="relative flex items-center">
            <span className="sr-only">{filter.label}</span>
            <select
              value={value}
              onChange={(event) => setParam(filter.key, event.target.value)}
              className={cn(
                "h-8 cursor-pointer appearance-none rounded-[var(--radius-control)] border",
                "pl-[var(--space-3)] pr-[var(--space-8)]",
                // A native select sizes to its widest OPTION, and option text for a
                // campaign or brand filter is user-supplied and unbounded. Without a
                // cap here one long name widens the control past a 390px viewport,
                // which no amount of care at the call site can prevent.
                "max-w-[11rem] truncate",
                "text-[length:var(--text-app-cell)]",
                "transition-colors duration-[var(--dur-instant)]",
                "focus:outline-2 focus:outline-offset-1 focus:outline-[var(--focus-ring)]",
                // An applied filter is legible without colour: the option label
                // replaces the dimension name, so the control reads
                // "Needs review" rather than "Status: all".
                active
                  ? "border-[var(--brand-soft-border)] bg-[var(--brand-soft)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]"
                  : "border-[var(--border-default)] bg-[var(--surface-primary)] text-[color:var(--text-secondary)] hover:border-[var(--border-strong)]",
              )}
            >
              <option value="all">{filter.label}: all</option>
              {filter.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              size={14}
              strokeWidth={1.75}
              className={cn(
                "pointer-events-none absolute right-[var(--space-2)]",
                active
                  ? "text-[color:var(--brand-ink)]"
                  : "text-[color:var(--text-muted)]",
              )}
            />
          </label>
        );
      })}

      {/* Only offered when something is actually filtered, so the control does not
          sit there inert on an unfiltered list. */}
      {(activeFilterCount > 0 || query) && (
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            filters.forEach((filter) => next.delete(filter.key));
            next.delete("q");
            next.delete("page");
            startTransition(() =>
              router.push(`${pathname}?${next.toString()}`, { scroll: false }),
            );
          }}
          className={cn(
            "relative flex h-8 items-center gap-[var(--space-1)] rounded-[var(--radius-control)] px-[var(--space-2)]",
            "text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]",
            "transition-colors duration-[var(--dur-instant)]",
            "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
            "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
          )}
        >
          <X aria-hidden="true" size={14} strokeWidth={2} />
          Clear
        </button>
      )}

      {views && views.length > 1 && (
        <div
          role="group"
          aria-label="View"
          className={cn(
            "ml-auto flex items-center gap-0.5 rounded-[var(--radius-control)] p-0.5",
            "bg-[var(--surface-muted)]",
          )}
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
                  "relative flex size-7 items-center justify-center rounded-[var(--radius-chip)]",
                  "transition-colors duration-[var(--dur-instant)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
                  selected
                    ? "bg-[var(--surface-primary)] text-[color:var(--text-primary)] shadow-[var(--elevation-card)]"
                    : "text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]",
                )}
              >
                <Icon aria-hidden="true" size={15} strokeWidth={1.75} />
                <span className="sr-only">
                  {view === "grid" ? "Grid view" : "Table view"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
