"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { can } from "@/lib/permissions";
import { navItems, createAction, shellCopy } from "@/content/app-navigation";

/**
 * Mobile navigation drawer.
 *
 * A drawer rather than a compressed sidebar: at 390px a 15rem rail leaves 8rem of
 * content, which is not a product. The drawer is a real dialog — focus trapped,
 * Escape closes, focus restored — because it does own the screen while open.
 *
 * Each item shows its hint text, which the desktop sidebar reveals on hover. Hover
 * does not exist here, so the information has to be present rather than hidden
 * behind an interaction the device cannot perform.
 */
export function MobileNav({ role }: { role: MemberRole }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Prevents the page behind the drawer from scrolling under the user's finger.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const firstLink = panelRef.current?.querySelector<HTMLElement>("a, button");
    firstLink?.focus();

    // Captured now rather than read in the cleanup: by the time cleanup runs the
    // ref may point elsewhere, and focus would be restored to the wrong element.
    const trigger = triggerRef.current;

    return () => {
      document.body.style.overflow = previous;
      trigger?.focus();
    };
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = panelRef.current?.querySelectorAll<HTMLElement>("a, button");
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

  const visible = navItems.filter((item) => !item.requires || can(role, item.requires));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className={cn(
          "flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)] lg:hidden",
          "border border-[var(--color-border-hairline)] text-[color:var(--color-text-secondary)]",
          "transition-colors duration-[var(--dur-instant)]",
          "hover:border-[var(--color-border)] hover:text-[color:var(--color-text-primary)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        )}
      >
        <span aria-hidden="true">☰</span>
        <span className="sr-only">{shellCopy.openNavLabel}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[var(--z-overlay)] bg-[var(--color-scrim)] lg:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Product navigation"
            onKeyDown={onKeyDown}
            className={cn(
              "flex h-full w-[min(20rem,88vw)] flex-col",
              "border-r border-[var(--color-border)] bg-[var(--color-surface-1)]",
            )}
          >
            <div className="flex min-h-16 items-center justify-between border-b border-[var(--color-border-hairline)] px-4">
              <span className="font-display text-[length:var(--text-title)]">Virally</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
              >
                <span aria-hidden="true">✕</span>
                <span className="sr-only">{shellCopy.closeNavLabel}</span>
              </button>
            </div>

            <nav aria-label="Product" className="flex-1 overflow-y-auto p-2">
              <ul className="flex flex-col gap-1">
                {visible.map((item) => {
                  const active =
                    item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        // Closed here rather than in an effect on `pathname`:
                        // navigation is user-initiated, so the handler owns it.
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 flex-col justify-center rounded-[var(--radius-sm)] px-3 py-2",
                          "transition-colors duration-[var(--dur-instant)]",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                          active
                            ? "bg-[var(--color-surface-2)] text-[color:var(--color-text-primary)]"
                            : "text-[color:var(--color-text-secondary)]",
                        )}
                      >
                        <span className="flex items-center gap-2 text-[length:var(--text-body-s)]">
                          {active && (
                            <span aria-hidden="true" className="text-[color:var(--color-action)]">
                              ▸
                            </span>
                          )}
                          {item.label}
                        </span>
                        <span className="text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                          {item.hint}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="border-t border-[var(--color-border-hairline)] p-3">
              <Link
                href={createAction.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)]",
                  "bg-[var(--color-action)] text-[color:var(--color-text-oncolor)]",
                  "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                )}
              >
                <span aria-hidden="true">+</span>
                {createAction.label}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
