"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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
  /**
   * Leading glyph. Two adjacent switchers showing two proper nouns are otherwise
   * indistinguishable now that the trigger no longer carries a visible caption.
   */
  icon,
}: {
  label: string;
  options: readonly SwitcherOption[];
  activeId: string | null;
  onSelect: (id: string) => Promise<void>;
  emptyHint: string;
  icon?: ReactNode;
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
      <span className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
        {emptyHint}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
      {/*
        A single 32px line, not a two-line block.

        The previous trigger stacked an uppercase "WORKSPACE" caption above the
        value, which made two selectors the tallest and loudest objects in the
        chrome. The label is now the control's accessible name and its tooltip
        instead — carried by `aria-label`, so assistive technology still gets it —
        and the leading icon is what distinguishes workspace from brand visually.
      */}
      <button
        ref={triggerRef}
        type="button"
        // `role="combobox"` rather than the implicit button role. This is the
        // ARIA 1.2 select-only combobox: `aria-activedescendant` is defined on
        // combobox and NOT on button, so without the role the virtual cursor
        // below is an attribute the platform is entitled to ignore.
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        // On the trigger, not on the `<ul>`. Focus never leaves this button while
        // the list is open — the arrow keys move a virtual cursor — and
        // `aria-activedescendant` is only honoured on the element that actually
        // holds DOM focus. Declaring it on the list is the common version of this
        // bug and silently announces nothing.
        aria-activedescendant={open ? `${listId}-${focusIndex}` : undefined}
        aria-busy={pending || undefined}
        aria-label={`${label}: ${active?.label ?? emptyHint}`}
        title={label}
        onClick={() => (open ? close({ restoreFocus: false }) : openList())}
        className={cn(
          "relative flex h-8 max-w-[11rem] items-center gap-[var(--space-2)] px-[var(--space-2)]",
          "rounded-[var(--radius-control)] text-left",
          "text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]",
          "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
          "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          open && "bg-[var(--surface-muted)] text-[color:var(--text-primary)]",
          "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
        )}
      >
        {icon && (
          <span aria-hidden="true" className="shrink-0 text-[color:var(--text-muted)]">
            {icon}
          </span>
        )}
        <span className="truncate">{active?.label ?? emptyHint}</span>
        <ChevronsUpDown
          aria-hidden="true"
          size={13}
          strokeWidth={1.75}
          className={cn("ml-auto shrink-0 text-[color:var(--text-muted)]", pending && "opacity-40")}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            "absolute right-0 top-[calc(100%+var(--space-2))] z-[var(--z-overlay)] max-h-[60vh] w-[17rem]",
            "overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border-default)]",
            "bg-[var(--surface-primary)] p-[var(--space-1)] shadow-[var(--elevation-overlay)]",
          )}
        >
          <li aria-hidden="true" className="app-label px-[var(--space-2)] py-[var(--space-2)]">
            {label}
          </li>
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
                  "flex min-h-10 cursor-pointer items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] py-[var(--space-2)]",
                  index === focusIndex && "bg-[var(--surface-muted)]",
                )}
              >
                {/* A real checkmark, not just a background tint: selection must
                    survive being unable to perceive the highlight colour. */}
                <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
                  {selected && (
                    <Check size={14} strokeWidth={2.5} className="text-[color:var(--brand-primary)]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
                    {option.label}
                  </span>
                  {option.detail && (
                    <span className="block truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                      {option.detail}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
