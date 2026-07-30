"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { can } from "@/lib/permissions";
import { navItems } from "@/content/app-navigation";
import type { SwitcherOption } from "./Switcher";

/**
 * Command palette (⌘K / Ctrl+K).
 *
 * This IS a modal dialog, so unlike the switcher it does trap focus and does set
 * `aria-modal`. The distinction matters: a dialog owns the screen until dismissed,
 * so Tab must cycle within it; a dropdown does not, so trapping there would strip
 * the user's normal way out.
 *
 * Filtering is a plain substring match over a static command list. It is not a
 * database search — wiring live search here would fire a query per keystroke, and
 * the brief explicitly forbids that pattern. Entity search lands with the surfaces
 * that own the entities.
 */
type Command = {
  id: string;
  label: string;
  hint: string;
  group: string;
  run: () => void | Promise<void>;
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
  const [, startTransition] = useTransition();

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
      list.push({
        id: "action:create-campaign",
        label: "Create campaign",
        hint: "Start from a prompt, URL or upload",
        group: "Create",
        run: () => router.push("/app/create"),
      });
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.hint.toLowerCase().includes(needle) ||
        command.group.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  /**
   * Opening resets the query and remembers what had focus.
   *
   * Done in a callback rather than an effect keyed on `open`: an effect would render
   * the palette once with the previous query still in it and again cleared, which
   * React 19 flags as a cascading render — and the stale frame is visible.
   */
  const openPalette = useCallback(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setFocusIndex(0);
    setOpen(true);
    // After paint: the input is not in the document until this render commits.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // Focus restoration is part of closing, not a consequence to be observed.
    restoreRef.current?.focus();
  }, []);

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
        'input, [role="option"], button',
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
      className="fixed inset-0 z-[var(--z-overlay)] flex items-start justify-center bg-[var(--color-scrim)] px-4 pt-[12vh]"
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
          "w-full max-w-[36rem] overflow-hidden rounded-[var(--radius-lg)]",
          "border border-[var(--color-border)] bg-[var(--color-surface-2)]",
          "shadow-[var(--shadow-panel)]",
        )}
      >
        <div className="border-b border-[var(--color-border-hairline)] p-3">
          <label htmlFor="command-palette-input" className="sr-only">
            Search commands
          </label>
          <input
            ref={inputRef}
            id="command-palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFocusIndex(0);
            }}
            placeholder="Type a command"
            className={cn(
              "min-h-11 w-full bg-transparent px-2",
              "text-[length:var(--text-body)] text-[color:var(--color-text-primary)]",
              "placeholder:text-[color:var(--color-text-muted)]",
              // The dialog border already frames the field; a second border here
              // would read as a nested box.
              "outline-none",
            )}
          />
        </div>

        <ul
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-[50vh] overflow-y-auto p-1"
        >
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
              No command matches “{query}”. Commands cover navigation, creating and
              switching workspace or brand.
            </li>
          )}

          {filtered.map((command, index) => {
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            return (
              <li key={command.id}>
                {showGroup && (
                  <p className="px-3 pb-1 pt-3 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                    {command.group}
                  </p>
                )}
                <div
                  role="option"
                  aria-selected={index === focusIndex}
                  tabIndex={-1}
                  onMouseEnter={() => setFocusIndex(index)}
                  onClick={() => {
                    close();
                    void command.run();
                  }}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-[var(--radius-sm)] px-3 py-2",
                    index === focusIndex && "bg-[var(--color-surface-3)]",
                  )}
                >
                  <span className="text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                    {command.label}
                  </span>
                  <span className="truncate text-right text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                    {command.hint}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-[var(--color-border-hairline)] px-4 py-2 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          <span>↑↓ move</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
