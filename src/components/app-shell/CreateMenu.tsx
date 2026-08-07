"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { createAction } from "@/content/app-navigation";

/**
 * The sidebar's create action.
 *
 * A menu rather than a direct link, because the create action no longer
 * assumes Campaign — Quick Content, Campaign, Image and Video are four
 * different starting points, and picking one for the button to always open
 * would just move the "campaign by default" problem from the composer to the
 * button that opens it.
 *
 * A plain button + absolutely positioned panel rather than a library
 * component: the sidebar has exactly one of these, and closing on outside
 * click, on Escape and returning focus to the trigger is the entire contract
 * a menu this small needs.
 */
export function CreateMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? createAction.label : undefined}
        className={cn(
          "flex h-9 w-full items-center justify-center gap-[var(--space-2)]",
          "rounded-[var(--radius-control)]",
          "bg-[var(--brand-primary)] text-[color:var(--text-on-brand)]",
          "text-[length:var(--text-app-cell)] font-[var(--weight-strong)]",
          "shadow-[var(--elevation-card)]",
          "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
          "hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-active)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        )}
      >
        <Plus aria-hidden="true" size={15} strokeWidth={2.25} />
        {!collapsed && <span>{createAction.label}</span>}
        {collapsed && <span className="sr-only">{createAction.label}</span>}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={createAction.label}
          className={cn(
            "absolute left-0 top-[calc(100%+var(--space-2))] z-50 w-48",
            "rounded-[var(--radius-card)] border border-[var(--border-default)]",
            "bg-[var(--surface-primary)] p-[var(--space-1)] shadow-[var(--elevation-card)]",
          )}
        >
          {createAction.items.map((item) => (
            <Link
              key={item.id}
              role="menuitem"
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex min-h-9 items-center rounded-[var(--radius-control)] px-[var(--space-3)]",
                "text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]",
                "transition-colors duration-[var(--dur-instant)]",
                "hover:bg-[var(--surface-secondary)]",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
