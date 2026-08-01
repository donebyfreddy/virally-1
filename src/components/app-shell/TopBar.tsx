"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  LogOut,
  Palette,
  Search,
  Settings as SettingsIcon,
  Zap,
} from "lucide-react";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/lib/permissions";
import { navItems, shellCopy } from "@/content/app-navigation";
import { switchBrand, switchWorkspace } from "@/lib/tenant/actions";
import { signOut } from "@/lib/auth/actions";
import { formatMetric } from "@/lib/format";
import { Switcher, type SwitcherOption } from "./Switcher";
import { CommandPalette } from "./CommandPalette";
import { MobileNav } from "./MobileNav";
import { NAV_ICON_STROKE } from "./navIcons";

/**
 * Top bar: orientation on the left, context and identity on the right.
 *
 * 56px tall against the previous 72px. On an operations surface the bar is pure
 * chrome — every pixel it takes is a pixel the table below does not get — so the
 * controls are 32px and the type is 13px. That is still above the 44px touch
 * floor, which is met by transparent inset targets rather than by real height
 * (see `after:` in the control classes).
 *
 * The "search" control opens the command palette rather than being a live search
 * field. A text input that queries on every keystroke is the pattern the brief
 * rules out; a button that opens a keyboard-driven palette is honest about what
 * it does and costs no queries.
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
  creditsAvailable,
  creditsReserved,
}: {
  role: MemberRole;
  workspaces: readonly SwitcherOption[];
  brands: readonly SwitcherOption[];
  activeWorkspaceId: string;
  activeBrandId: string | null;
  userLabel: string;
  userEmail: string;
  unreadNotifications: number;
  creditsAvailable: number;
  creditsReserved: number;
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
          "sticky top-0 z-[var(--z-sticky)] flex min-h-[var(--app-topbar-height)] items-center gap-[var(--space-2)]",
          "border-b border-[var(--border-default)] bg-[rgb(255_255_255_/_0.92)] backdrop-blur-xl",
          "px-[var(--space-4)]",
        )}
      >
        <MobileNav role={role} />

        {/* Breadcrumb. Two levels, sentence case, no mono: a page whose own
            header already carries a 28px title does not need its location
            restated in wide-tracked uppercase. */}
        <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
          <ol className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-meta)]">
            <li>
              <Link
                href="/app"
                className={cn(
                  "rounded-[var(--radius-chip)] text-[color:var(--text-muted)]",
                  "transition-colors duration-[var(--dur-instant)]",
                  "hover:text-[color:var(--text-primary)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                )}
              >
                Virally
              </Link>
            </li>
            {current && current.href !== "/app" && (
              <>
                <li aria-hidden="true" className="text-[color:var(--border-strong)]">
                  /
                </li>
                <li
                  aria-current="page"
                  className="min-w-0 truncate font-[var(--weight-strong)] text-[color:var(--text-primary)]"
                >
                  {current.label}
                </li>
              </>
            )}
          </ol>
        </nav>

        <div className="ml-auto flex items-center gap-[var(--space-2)]">
          <SearchTrigger />

          <div className="hidden md:block">
            <Switcher
              label={shellCopy.workspaceLabel}
              options={workspaces}
              activeId={activeWorkspaceId}
              onSelect={switchWorkspace}
              emptyHint="No workspace"
              icon={<Building2 size={14} strokeWidth={NAV_ICON_STROKE} />}
            />
          </div>

          <div className="hidden xl:block">
            <Switcher
              label={shellCopy.brandLabel}
              options={brands}
              activeId={activeBrandId}
              onSelect={switchBrand}
              emptyHint="No brand yet"
              icon={<Palette size={14} strokeWidth={NAV_ICON_STROKE} />}
            />
          </div>

          <CreditBalance available={creditsAvailable} reserved={creditsReserved} />

          <NotificationBell count={unreadNotifications} />

          {/* User menu. `details`/`summary` gives open/close, Escape and click
              semantics from the platform — hand-rolling them here would be a
              third copy of the dropdown contract for a menu with two items. */}
          <details
            open={menuOpen}
            onToggle={(event) => setMenuOpen((event.currentTarget as HTMLDetailsElement).open)}
            className="relative"
          >
            <summary
              className={cn(
                "relative flex size-8 cursor-pointer list-none items-center justify-center",
                "rounded-[var(--radius-full)]",
                "transition-shadow duration-[var(--dur-instant)]",
                "hover:ring-2 hover:ring-[var(--border-strong)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                "[&::-webkit-details-marker]:hidden",
                "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-8 items-center justify-center rounded-[var(--radius-full)]",
                  "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]",
                  "text-[length:var(--text-app-meta)] font-[var(--weight-heading)]",
                )}
              >
                {userLabel.charAt(0).toUpperCase()}
              </span>
              <span className="sr-only">{shellCopy.userMenuLabel}</span>
            </summary>

            <div
              className={cn(
                "absolute right-0 top-[calc(100%+var(--space-2))] z-[var(--z-overlay)] w-[16rem]",
                "rounded-[var(--radius-card)] border border-[var(--border-default)]",
                "bg-[var(--surface-primary)] p-[var(--space-1)] shadow-[var(--elevation-overlay)]",
              )}
            >
              <div className="border-b border-[var(--border-subtle)] px-[var(--space-3)] py-[var(--space-3)]">
                <p className="truncate text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
                  {userLabel}
                </p>
                <p className="truncate text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                  {userEmail}
                </p>
                <p className="mt-[var(--space-2)] app-label">{ROLE_LABELS[role]}</p>
              </div>

              <Link
                href="/app/settings"
                className={cn(
                  "flex min-h-10 items-center gap-[var(--space-3)] rounded-[var(--radius-control)] px-[var(--space-3)]",
                  "text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]",
                  "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                )}
              >
                <SettingsIcon
                  aria-hidden="true"
                  size={16}
                  strokeWidth={NAV_ICON_STROKE}
                  className="text-[color:var(--text-muted)]"
                />
                Settings
              </Link>

              <form action={signOut}>
                <button
                  type="submit"
                  className={cn(
                    "flex w-full min-h-10 items-center gap-[var(--space-3)] rounded-[var(--radius-control)] px-[var(--space-3)] text-left",
                    "text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]",
                    "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  )}
                >
                  <LogOut
                    aria-hidden="true"
                    size={16}
                    strokeWidth={NAV_ICON_STROKE}
                    className="text-[color:var(--text-muted)]"
                  />
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
 * Dispatches the same keyboard event the palette listens for, so there is
 * exactly one place that decides when the palette opens.
 *
 * A soft-filled field rather than an outlined one: on a white bar an outlined
 * input is the highest-contrast object in the chrome, which is the wrong
 * emphasis for a control the user reaches by keyboard anyway.
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
        "relative hidden h-8 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] sm:flex",
        "bg-[var(--surface-muted)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:bg-[var(--border-subtle)] hover:text-[color:var(--text-secondary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "lg:w-[15rem]",
        "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
      )}
    >
      <Search aria-hidden="true" size={15} strokeWidth={NAV_ICON_STROKE} className="shrink-0" />
      <span className="hidden truncate lg:inline">{shellCopy.searchPlaceholder}</span>
      <span className="sr-only">Open the command palette</span>
      <kbd
        aria-hidden="true"
        className={cn(
          "ml-auto hidden shrink-0 rounded-[var(--radius-chip)] px-1.5 py-0.5 lg:inline",
          "bg-[var(--surface-primary)] text-[length:var(--text-app-label-xs)] text-[color:var(--text-muted)]",
          "shadow-[var(--elevation-card)]",
        )}
      >
        {shellCopy.commandPaletteHint}
      </kbd>
    </button>
  );
}

/**
 * Production credit balance.
 *
 * Real, read from the ledger in the layout — not a decorative number. It sits in
 * the bar because every generation action spends it, so "can I afford this?" has
 * to be answerable without navigating to Usage.
 *
 * Held credits are shown only when there are any. A permanent "0 held" is noise;
 * a non-zero hold is the answer to "why is my balance lower than I expected?".
 */
function CreditBalance({ available, reserved }: { available: number; reserved: number }) {
  const low = available <= 0;

  return (
    <Link
      href="/app/usage"
      className={cn(
        "relative hidden h-8 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)] md:flex",
        "text-[length:var(--text-app-meta)] font-[var(--weight-strong)]",
        "transition-colors duration-[var(--dur-instant)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
        // Colour AND the word "none" carry the empty state, never colour alone.
        low
          ? "bg-[var(--warning-soft)] text-[color:var(--warning)] hover:bg-[var(--warning-soft)]"
          : "bg-[var(--brand-soft)] text-[color:var(--brand-ink)] hover:bg-[var(--brand-soft-border)]",
      )}
    >
      <Zap aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
      <span className="app-figure">{low ? "None" : formatMetric(available, "compact")}</span>
      <span className="sr-only">
        {shellCopy.creditsLabel}:{" "}
        {low ? "none available" : `${available.toLocaleString("en-US")} available`}
        {reserved > 0 ? `, ${reserved.toLocaleString("en-US")} held for work in flight` : ""}
      </span>
      {reserved > 0 && (
        <span
          aria-hidden="true"
          title={`${reserved.toLocaleString("en-US")} held for work in flight`}
          className="size-1.5 shrink-0 rounded-[var(--radius-full)] bg-[var(--brand-mark)]"
        />
      )}
    </Link>
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
        "relative flex size-8 items-center justify-center rounded-[var(--radius-control)]",
        "text-[color:var(--text-muted)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
      )}
    >
      <Bell aria-hidden="true" size={17} strokeWidth={NAV_ICON_STROKE} />
      <span className="sr-only">
        {count === 0
          ? `${shellCopy.notificationsLabel}: none unread`
          : `${shellCopy.notificationsLabel}: ${count} unread`}
      </span>
      {count > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-[var(--radius-full)] px-1",
            // `--error`, not `--error-mark`: this badge carries white TEXT, and the mark
            // is only held to the 3:1 graphical floor (white on it measures
            // 4.29:1). The darker ink puts it at 5.66:1.
            "bg-[var(--error)] text-[length:var(--text-app-label-xs)] font-[var(--weight-heading)] leading-4 text-white",
          )}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
