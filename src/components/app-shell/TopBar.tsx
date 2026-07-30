"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/lib/permissions";
import { navItems, shellCopy } from "@/content/app-navigation";
import { switchBrand, switchWorkspace } from "@/lib/tenant/actions";
import { signOut } from "@/lib/auth/actions";
import { Switcher, type SwitcherOption } from "./Switcher";
import { CommandPalette } from "./CommandPalette";
import { MobileNav } from "./MobileNav";

/**
 * Top bar: identity, context switchers, search entry, notifications, user menu.
 *
 * The "search" control opens the command palette rather than being a live search
 * field. Presenting a text input that queries on every keystroke is the pattern the
 * brief rules out; a button that opens a keyboard-driven palette is honest about
 * what it does and costs no queries.
 */
export function TopBar({
  role,
  workspaces,
  brands,
  activeWorkspaceId,
  activeBrandId,
  userLabel,
  userEmail,
  unreadNotifications,
}: {
  role: MemberRole;
  workspaces: readonly SwitcherOption[];
  brands: readonly SwitcherOption[];
  activeWorkspaceId: string;
  activeBrandId: string | null;
  userLabel: string;
  userEmail: string;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const current = navItems.find((item) =>
    item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href),
  );

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-[var(--z-sticky)] flex min-h-16 items-center gap-3",
          "border-b border-[var(--color-border-hairline)] bg-[var(--color-canvas)]",
          "px-[var(--gutter)] py-2",
        )}
      >
        <MobileNav role={role} />

        {/* Breadcrumb. Two levels only — deeper trails on a product this wide
            become longer than the page title they describe. */}
        <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
          <ol className="flex items-center gap-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]">
            <li>
              <Link
                href="/app"
                className="text-[color:var(--color-text-muted)] transition-colors duration-[var(--dur-instant)] hover:text-[color:var(--color-text-primary)]"
              >
                Virally
              </Link>
            </li>
            {current && current.href !== "/app" && (
              <>
                <li aria-hidden="true" className="text-[color:var(--color-text-muted)]">
                  /
                </li>
                <li aria-current="page" className="truncate text-[color:var(--color-text-primary)]">
                  {current.label}
                </li>
              </>
            )}
          </ol>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:block">
            <Switcher
              label={shellCopy.workspaceLabel}
              options={workspaces}
              activeId={activeWorkspaceId}
              onSelect={switchWorkspace}
              emptyHint="No workspace"
            />
          </div>

          <div className="hidden lg:block">
            <Switcher
              label={shellCopy.brandLabel}
              options={brands}
              activeId={activeBrandId}
              onSelect={switchBrand}
              emptyHint="No brand yet"
            />
          </div>

          <SearchTrigger />

          <NotificationBell count={unreadNotifications} />

          {/* User menu. `details`/`summary` gives open/close, Escape and click
              semantics from the platform — hand-rolling them here would be a third
              copy of the dropdown contract for a menu with two items. */}
          <details
            open={menuOpen}
            onToggle={(event) => setMenuOpen((event.currentTarget as HTMLDetailsElement).open)}
            className="relative"
          >
            <summary
              className={cn(
                "flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center gap-2",
                "rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] px-2",
                "transition-colors duration-[var(--dur-instant)]",
                "hover:border-[var(--color-border)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                "[&::-webkit-details-marker]:hidden",
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-7 items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-surface-3)] font-utility text-[length:var(--text-utility-xs)]"
              >
                {userLabel.charAt(0).toUpperCase()}
              </span>
              <span className="sr-only">{shellCopy.userMenuLabel}</span>
            </summary>

            <div
              className={cn(
                "absolute right-0 top-[calc(100%+0.25rem)] z-[var(--z-overlay)] w-[16rem]",
                "rounded-[var(--radius-sm)] border border-[var(--color-border)]",
                "bg-[var(--color-surface-2)] p-1 shadow-[var(--shadow-panel)]",
              )}
            >
              <div className="border-b border-[var(--color-border-hairline)] px-3 py-3">
                <p className="truncate text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                  {userLabel}
                </p>
                <p className="truncate font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                  {userEmail}
                </p>
                <p className="mt-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]">
                  {ROLE_LABELS[role]}
                </p>
              </div>

              <Link
                href="/app/settings"
                className="flex min-h-11 items-center rounded-[var(--radius-sm)] px-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[color:var(--color-text-primary)]"
              >
                Settings
              </Link>

              <form action={signOut}>
                <button
                  type="submit"
                  className="flex w-full min-h-11 items-center rounded-[var(--radius-sm)] px-3 text-left text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[color:var(--color-text-primary)]"
                >
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <CommandPalette
        role={role}
        workspaces={workspaces}
        brands={brands}
        onSwitchWorkspace={switchWorkspace}
        onSwitchBrand={switchBrand}
      />
    </>
  );
}

/**
 * Dispatches the same keyboard event the palette listens for, so there is exactly
 * one place that decides when the palette opens.
 */
function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        )
      }
      className={cn(
        "hidden min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3 sm:flex",
        "border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)]",
        "text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:border-[var(--color-border)] hover:text-[color:var(--color-text-secondary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
      )}
    >
      <span aria-hidden="true">⌕</span>
      <span className="hidden lg:inline">{shellCopy.searchPlaceholder}</span>
      <span className="sr-only">Open the command palette</span>
      <kbd
        aria-hidden="true"
        className="ml-2 hidden rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] px-1.5 py-0.5 font-utility text-[length:var(--text-utility-xs)] lg:inline"
      >
        {shellCopy.commandPaletteHint}
      </kbd>
    </button>
  );
}

/**
 * Notification entry point.
 *
 * Renders the real unread count, and zero renders as an empty bell rather than a
 * "0" badge. The centre itself is part of the realtime phase; this is the anchor
 * and the count, both of which are real today.
 */
function NotificationBell({ count }: { count: number }) {
  return (
    <Link
      href="/app/settings#notifications"
      className={cn(
        "relative flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)]",
        "border border-[var(--color-border-hairline)]",
        "text-[color:var(--color-text-secondary)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:border-[var(--color-border)] hover:text-[color:var(--color-text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
      )}
    >
      <span aria-hidden="true">◔</span>
      <span className="sr-only">
        {count === 0
          ? `${shellCopy.notificationsLabel}: none unread`
          : `${shellCopy.notificationsLabel}: ${count} unread`}
      </span>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-action)] font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-oncolor)]"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
