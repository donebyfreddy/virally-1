"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  CalendarClock,
  Film,
  FolderKanban,
  Image as ImageIcon,
  LoaderCircle,
  Search,
  UserRound,
} from "lucide-react";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { can } from "@/lib/permissions";
import { searchGlobalEntities } from "@/lib/search/actions";
import type { GlobalSearchResult, GlobalSearchResultKind } from "@/lib/search/types";
import { createAction, navItems } from "@/content/app-navigation";
import type { SwitcherOption } from "./Switcher";

/**
 * Command palette (⌘K / Ctrl+K).
 *
 * This IS a modal dialog, so unlike the switcher it does trap focus and does set
 * `aria-modal`. The distinction matters: a dialog owns the screen until dismissed,
 * so Tab must cycle within it; a dropdown does not, so trapping there would strip
 * the user's normal way out.
 *
 * Navigation commands filter immediately. A query of two or more characters also
 * searches workspace entities through a debounced server action. That action
 * re-checks the session, tenant and permission boundary; the client never receives
 * a broad dataset to filter and never issues a request for every keystroke.
 */
type Command = {
  id: string;
  label: string;
  hint: string;
  group: string;
  kind?: GlobalSearchResultKind;
  run: () => void | Promise<void>;
};

type SearchState = "idle" | "loading" | "ready" | "error";

/** Per-item hints for `createAction.items`, keyed by item id. */
const CREATE_ITEM_HINTS: Readonly<Record<string, string>> = {
  quick: "One piece of content, minimal setup",
  campaign: "Plan and create multiple pieces of content",
  image: "Generate a raw image asset",
  video: "Generate a raw video asset",
};

export function CommandPalette({
  role,
  workspaces,
  brands,
  onSwitchWorkspace,
  onSwitchBrand,
}: {
  role: MemberRole;
  workspaces: readonly SwitcherOption[];
  brands: readonly SwitcherOption[];
  onSwitchWorkspace: (id: string) => Promise<void>;
  onSwitchBrand: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<GlobalSearchResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [, startTransition] = useTransition();

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<number | null>(null);
  const searchRequestRef = useRef(0);
  // Remembers what had focus so it can be restored on close.
  const restoreRef = useRef<HTMLElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    for (const item of navItems) {
      if (item.requires && !can(role, item.requires)) continue;
      list.push({
        id: `go:${item.id}`,
        label: `Open ${item.label}`,
        hint: item.hint,
        group: "Navigate",
        run: () => router.push(item.href),
      });
    }

    if (can(role, "content.create")) {
      for (const item of createAction.items) {
        list.push({
          id: `action:create-${item.id}`,
          label: `Create ${item.label.toLowerCase()}`,
          hint: CREATE_ITEM_HINTS[item.id] ?? "Start from a prompt, URL or upload",
          group: "Create",
          run: () => router.push(item.href),
        });
      }
    }
    if (can(role, "accounts.connect")) {
      list.push({
        id: "action:connect-account",
        label: "Connect an account",
        hint: "Authorise a social account",
        group: "Create",
        run: () => router.push("/app/accounts"),
      });
    }

    // Only offer switching when there is something to switch to.
    if (workspaces.length > 1) {
      for (const workspace of workspaces) {
        list.push({
          id: `ws:${workspace.id}`,
          label: `Switch to ${workspace.label}`,
          hint: workspace.detail ?? "Workspace",
          group: "Switch workspace",
          run: () => startTransition(async () => { await onSwitchWorkspace(workspace.id); }),
        });
      }
    }
    if (brands.length > 1) {
      for (const brand of brands) {
        list.push({
          id: `brand:${brand.id}`,
          label: `Switch to ${brand.label}`,
          hint: brand.detail ?? "Brand",
          group: "Switch brand",
          run: () => startTransition(async () => { await onSwitchBrand(brand.id); }),
        });
      }
    }

    return list;
  }, [role, router, workspaces, brands, onSwitchWorkspace, onSwitchBrand, startTransition]);

  const filteredCommands = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.hint.toLowerCase().includes(needle) ||
        command.group.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  const filtered = useMemo<Command[]>(() => {
    const entityCommands = entityResults.map<Command>((result) => ({
      id: result.id,
      label: result.label,
      hint: result.hint,
      group: result.group,
      kind: result.kind,
      run: () => router.push(result.href),
    }));
    return [...entityCommands, ...filteredCommands];
  }, [entityResults, filteredCommands, router]);

  const cancelSearch = useCallback(() => {
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    searchRequestRef.current += 1;
  }, []);

  const scheduleSearch = useCallback(
    (value: string) => {
      cancelSearch();
      const trimmed = value.trim();

      if (trimmed.length < 2) {
        setEntityResults([]);
        setSearchState("idle");
        return;
      }

      const requestId = searchRequestRef.current;
      setSearchState("loading");
      searchTimerRef.current = window.setTimeout(async () => {
        try {
          const results = await searchGlobalEntities(trimmed);
          if (searchRequestRef.current !== requestId) return;
          setEntityResults(results);
          setFocusIndex(0);
          setSearchState("ready");
        } catch {
          if (searchRequestRef.current !== requestId) return;
          setEntityResults([]);
          setSearchState("error");
        }
      }, 240);
    },
    [cancelSearch],
  );

  /**
   * Opening resets the query and remembers what had focus.
   *
   * Done in a callback rather than an effect keyed on `open`: an effect would render
   * the palette once with the previous query still in it and again cleared, which
   * React 19 flags as a cascading render — and the stale frame is visible.
   */
  const openPalette = useCallback(() => {
    cancelSearch();
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setFocusIndex(0);
    setEntityResults([]);
    setSearchState("idle");
    setOpen(true);
    // After paint: the input is not in the document until this render commits.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [cancelSearch]);

  const close = useCallback(() => {
    cancelSearch();
    setOpen(false);
    // Focus restoration is part of closing, not a consequence to be observed.
    restoreRef.current?.focus();
  }, [cancelSearch]);

  /**
   * Global shortcut. `metaKey || ctrlKey` covers both platforms without sniffing the
   * user agent.
   *
   * `open` is a real dependency, so the listener re-binds on toggle. That is
   * deliberate: the alternative is writing `open` to a ref during render, which is
   * exactly the pattern React 19 rejects, and re-binding one keydown listener is
   * cheaper than the bug it avoids.
   */
  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close();
        else openPalette();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [open, close, openPalette]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[focusIndex];
      if (command) {
        close();
        void command.run();
      }
      return;
    }
    // Focus trap: only Tab needs handling, and only to wrap at the ends.
    if (event.key === "Tab") {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, [role="option"][tabindex="0"], button:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
    }
  }

  if (!open) return null;

  let lastGroup = "";

  return (
    <div
      className={cn(
        "fixed inset-0 z-[var(--z-overlay)] flex items-start justify-center bg-[var(--color-scrim)] px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]",
        "motion-safe:animate-[virally-app-fade-in_var(--dur-base)_var(--ease-enter)_backwards]",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className={cn(
          "w-full max-w-[40rem] overflow-hidden rounded-[var(--radius-card)]",
          "border border-[var(--border-default)] bg-[var(--surface-primary)]",
          "shadow-[var(--elevation-overlay)]",
          "motion-safe:animate-[virally-app-pop-in_var(--dur-base)_var(--ease-settle)_backwards]",
        )}
      >
        <div className="flex items-center gap-[var(--space-3)] border-b border-[var(--border-subtle)] px-[var(--space-4)] py-[var(--space-3)]">
          <Search
            aria-hidden="true"
            size={18}
            strokeWidth={1.8}
            className="shrink-0 text-[color:var(--text-muted)]"
          />
          <label htmlFor="command-palette-input" className="sr-only">
            Search Virally
          </label>
          <input
            ref={inputRef}
            id="command-palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={
              filtered[focusIndex] ? `command-option-${filtered[focusIndex].id}` : undefined
            }
            autoComplete="off"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              setFocusIndex(0);
              scheduleSearch(nextQuery);
            }}
            placeholder="Search campaigns, content, assets, accounts and people"
            className={cn(
              "min-h-11 min-w-0 flex-1 bg-transparent",
              "text-[length:var(--text-app-body)] text-[color:var(--text-primary)]",
              "placeholder:text-[color:var(--text-muted)]",
              // The dialog border already frames the field; a second border here
              // would read as a nested box.
              "outline-none",
            )}
          />
          {searchState === "loading" && (
            <LoaderCircle
              aria-label="Searching"
              size={17}
              strokeWidth={1.8}
              className="shrink-0 text-[color:var(--brand-primary)] motion-safe:animate-spin"
            />
          )}
        </div>

        <ul
          id="command-palette-list"
          role="listbox"
          aria-label="Commands and search results"
          className="max-h-[62vh] overflow-y-auto p-[var(--space-2)]"
        >
          {searchState === "error" && (
            <li
              role="status"
              className="rounded-[var(--radius-control)] bg-[var(--error-soft)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-app-cell)] text-[color:var(--error)]"
            >
              Search is temporarily unavailable. Navigation commands still work.
            </li>
          )}

          {filtered.length === 0 && searchState !== "loading" && searchState !== "error" && (
            <li className="px-[var(--space-4)] py-[var(--space-8)] text-center text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
              No campaigns, content, assets, accounts, scheduled posts or team members match “{query}”.
            </li>
          )}

          {filtered.map((command, index) => {
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            return (
              <li key={command.id}>
                {showGroup && (
                  <p className="app-label px-[var(--space-3)] pb-1 pt-[var(--space-3)]">
                    {command.group}
                  </p>
                )}
                <button
                  id={`command-option-${command.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === focusIndex}
                  tabIndex={index === focusIndex ? 0 : -1}
                  onMouseEnter={() => setFocusIndex(index)}
                  onClick={() => {
                    close();
                    void command.run();
                  }}
                  className={cn(
                    "flex min-h-12 w-full cursor-pointer items-center gap-[var(--space-3)] rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-2)] text-left",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]",
                    index === focusIndex && "bg-[var(--brand-soft)]",
                  )}
                >
                  <ResultIcon kind={command.kind} active={index === focusIndex} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                      {command.label}
                    </span>
                    <span className="block truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                      {command.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-[var(--space-4)] border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-app-label-xs)] text-[color:var(--text-muted)]">
          <span>↑↓ move</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

const RESULT_ICONS: Readonly<Record<GlobalSearchResultKind, typeof FolderKanban>> = {
  campaign: FolderKanban,
  content: Film,
  asset: ImageIcon,
  account: AtSign,
  scheduled_post: CalendarClock,
  team_member: UserRound,
};

function ResultIcon({
  kind,
  active,
}: {
  kind?: GlobalSearchResultKind;
  active: boolean;
}) {
  const Icon = kind ? RESULT_ICONS[kind] : Search;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]",
        active
          ? "bg-[var(--surface-primary)] text-[color:var(--brand-primary)] shadow-[var(--elevation-card)]"
          : "bg-[var(--surface-muted)] text-[color:var(--text-muted)]",
      )}
    >
      <Icon size={15} strokeWidth={1.8} />
    </span>
  );
}
