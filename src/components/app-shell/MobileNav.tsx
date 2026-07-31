"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Plus, X } from "lucide-react";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { can } from "@/lib/permissions";
import { navItems, createAction, shellCopy, navGroupLabels } from "@/content/app-navigation";
import { Wordmark } from "@/components/navigation/Wordmark";
import { NAV_ICON_SIZE, NAV_ICON_STROKE, navIcons } from "./navIcons";

/**
 * Mobile navigation drawer.
 *
 * A drawer rather than a compressed sidebar: at 390px a 14.5rem rail leaves 8rem
 * of content, which is not a product. The drawer is a real dialog — focus
 * trapped, Escape closes, focus restored — because it does own the screen while
 * open.
 *
 * Each item shows its hint text, which the desktop sidebar reveals on hover.
 * Hover does not exist here, so the information has to be present rather than
 * hidden behind an interaction the device cannot perform.
 */
export function MobileNav({ role }: { role: MemberRole }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Prevents the page behind the drawer scrolling under the user's finger.
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
  const operate = visible.filter((item) => item.group === "operate");
  const manage = visible.filter((item) => item.group === "manage");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-[var(--radius-control)] lg:hidden",
          "text-[color:var(--text-secondary)]",
          "transition-colors duration-[var(--dur-instant)]",
          "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
        )}
      >
        <Menu aria-hidden="true" size={19} strokeWidth={NAV_ICON_STROKE} />
        <span className="sr-only">{shellCopy.openNavLabel}</span>
      </button>

      {open && (
        <div
          className={cn(
            "fixed inset-0 z-[var(--z-overlay)] bg-[var(--color-scrim)] lg:hidden",
            "motion-safe:animate-[virally-app-fade-in_var(--dur-base)_var(--ease-enter)_backwards]",
          )}
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
              "flex h-full w-[min(19rem,86vw)] flex-col",
              "bg-[var(--surface-primary)] shadow-[var(--elevation-overlay)]",
              "motion-safe:animate-[virally-app-drawer-in_var(--dur-panel)_var(--ease-settle)_backwards]",
            )}
          >
            <div className="flex min-h-[var(--app-topbar-height)] items-center justify-between border-b border-[var(--border-default)] px-[var(--space-4)]">
              <Wordmark />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-[var(--radius-control)]",
                  "text-[color:var(--text-muted)]",
                  "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
                )}
              >
                <X aria-hidden="true" size={18} strokeWidth={NAV_ICON_STROKE} />
                <span className="sr-only">{shellCopy.closeNavLabel}</span>
              </button>
            </div>

            <div className="border-b border-[var(--border-default)] p-[var(--space-3)]">
              <Link
                href={createAction.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-control)]",
                  "bg-[var(--brand-primary)] text-[color:var(--text-on-brand)]",
                  "text-[length:var(--text-app-body)] font-[var(--weight-strong)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                )}
              >
                <Plus aria-hidden="true" size={16} strokeWidth={2.25} />
                {createAction.label}
              </Link>
            </div>

            <nav aria-label="Product" className="flex-1 overflow-y-auto p-[var(--space-3)]">
              <DrawerGroup label={navGroupLabels.operate} first>
                {operate.map((item) => (
                  <DrawerLink
                    key={item.id}
                    item={item}
                    pathname={pathname}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </DrawerGroup>

              {manage.length > 0 && (
                <DrawerGroup label={navGroupLabels.manage}>
                  {manage.map((item) => (
                    <DrawerLink
                      key={item.id}
                      item={item}
                      pathname={pathname}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </DrawerGroup>
              )}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

function DrawerGroup({
  label,
  children,
  first = false,
}: {
  label: string;
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <>
      <p className={cn("app-label px-[var(--space-2)] pb-[var(--space-2)]", !first && "pt-[var(--space-5)]")}>
        {label}
      </p>
      <ul className="flex flex-col gap-px">{children}</ul>
    </>
  );
}

function DrawerLink({
  item,
  pathname,
  onNavigate,
}: {
  item: (typeof navItems)[number];
  pathname: string;
  onNavigate: () => void;
}) {
  const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
  const Icon = navIcons[item.id];

  return (
    <li>
      <Link
        href={item.href}
        // Closed here rather than in an effect on `pathname`: navigation is
        // user-initiated, so the handler owns it.
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-start gap-[var(--space-3)] rounded-[var(--radius-control)] px-[var(--space-2)] py-[var(--space-2)]",
          "transition-colors duration-[var(--dur-instant)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          active
            ? "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]"
            : "text-[color:var(--text-secondary)]",
        )}
      >
        <Icon
          aria-hidden="true"
          size={NAV_ICON_SIZE}
          strokeWidth={active ? 2 : NAV_ICON_STROKE}
          className={cn(
            "mt-0.5 shrink-0",
            active ? "text-[color:var(--brand-primary)]" : "text-[color:var(--text-muted)]",
          )}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[length:var(--text-app-cell)]",
              active && "font-[var(--weight-strong)]",
            )}
          >
            {item.label}
          </span>
          <span className="block text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {item.hint}
          </span>
        </span>
      </Link>
    </li>
  );
}
