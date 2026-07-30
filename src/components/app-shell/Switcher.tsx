"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";

export type SwitcherOption = {
  id: string;
  label: string;
  /** Secondary line — organisation name, or a placeholder warning. */
  detail?: string;
};

/**
 * Workspace / brand switcher.
 *
 * A real listbox rather than a styled `<select>`: it needs two lines per option
 * and a "needs setup" marker, which a native select cannot render. That means
 * owning the keyboard contract, so this implements it rather than approximating it:
 * Escape closes and restores focus, arrows move, Home/End jump, Enter commits,
 * click-outside closes, and the trigger reports expanded state.
 *
 * Not a modal, so focus is NOT trapped — trapping focus in a dropdown breaks Tab
 * as a way out, and the brief is explicit that trapping belongs only in real
 * dialogs.
 */
export function Switcher({
  label,
  options,
  activeId,
  onSelect,
  emptyHint,
}: {
  label: string;
  options: readonly SwitcherOption[];
  activeId: string | null;
  onSelect: (id: string) => Promise<void>;
  emptyHint: string;
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const active = options.find((option) => option.id === activeId) ?? options[0];

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /**
   * Opening positions the cursor on the current selection, not the first option —
   * arrowing from "where I am" is what a listbox is expected to do.
   *
   * Set here rather than in an effect keyed on `open`: an effect would render once
   * with a stale index and again with the right one, which React 19 flags as a
   * cascading render. Opening is always user-initiated, so the handler is the
   * correct place for it.
   */
  function openList() {
    const index = options.findIndex((option) => option.id === activeId);
    setFocusIndex(index >= 0 ? index : 0);
    setOpen(true);
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function commit(id: string) {
    close({ restoreFocus: true });
    if (id === activeId) return;
    startTransition(async () => {
      await onSelect(id);
    });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close({ restoreFocus: true });
        break;
      case "ArrowDown":
        event.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setFocusIndex(0);
        break;
      case "End":
        event.preventDefault();
        setFocusIndex(options.length - 1);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const option = options[focusIndex];
        if (option) commit(option.id);
        break;
      }
      case "Tab":
        // Tabbing away is a legitimate exit; do not restore focus to the trigger
        // or the user is bounced backwards.
        close({ restoreFocus: false });
        break;
      default:
        break;
    }
  }

  if (options.length === 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
          {label}
        </span>
        <span className="text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          {emptyHint}
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-busy={pending || undefined}
        onClick={() => (open ? close({ restoreFocus: false }) : openList())}
        className={cn(
          "flex min-h-11 max-w-[14rem] items-center gap-2 rounded-[var(--radius-sm)] px-3",
          "border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)]",
          "text-left transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
          "hover:border-[var(--color-border)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
            {label}
          </span>
          <span className="truncate text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
            {active?.label ?? emptyHint}
          </span>
        </span>
        <span aria-hidden="true" className="ml-auto text-[color:var(--color-text-muted)]">
          {pending ? "…" : "▾"}
        </span>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${listId}-${focusIndex}`}
          className={cn(
            "absolute left-0 top-[calc(100%+0.25rem)] z-[var(--z-overlay)] max-h-[60vh] w-[18rem]",
            "overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border)]",
            "bg-[var(--color-surface-2)] p-1 shadow-[var(--shadow-panel)]",
          )}
        >
          {options.map((option, index) => {
            const selected = option.id === activeId;
            return (
              <li
                key={option.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected}
                onClick={() => commit(option.id)}
                onMouseEnter={() => setFocusIndex(index)}
                className={cn(
                  "flex min-h-11 cursor-pointer flex-col justify-center rounded-[var(--radius-sm)] px-3 py-2",
                  index === focusIndex && "bg-[var(--color-surface-3)]",
                )}
              >
                <span className="flex items-center gap-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                  {/* Checkmark, not just a background tint: selection must survive
                      being unable to perceive the highlight colour. */}
                  <span aria-hidden="true" className="w-3 font-utility text-[color:var(--color-action)]">
                    {selected ? "✓" : ""}
                  </span>
                  <span className="truncate">{option.label}</span>
                </span>
                {option.detail && (
                  <span className="pl-5 text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                    {option.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
