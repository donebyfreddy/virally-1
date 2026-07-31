"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Lightbulb, Plus } from "lucide-react";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { useLocalFlag } from "@/lib/hooks/useLocalFlag";
import { can } from "@/lib/permissions";
import {
  navItems,
  createAction,
  shellCopy,
  supportCard,
  type NavItem,
} from "@/content/app-navigation";
import { Wordmark } from "@/components/navigation/Wordmark";
import { NAV_ICON_SIZE, NAV_ICON_STROKE, navIcons } from "./navIcons";

const COLLAPSE_KEY = "virally:sidebar-collapsed";

/**
 * Desktop sidebar.
 *
 * Collapse state is local to the browser (localStorage), not the database: it is a
 * per-device viewport preference, and round-tripping it through the server would
 * add a write on every toggle and still be wrong on a second monitor.
 *
 * Read through `useSyncExternalStore`, which resolves the hydration problem without
 * a mount effect — see useLocalFlag.
 */
export function Sidebar({ role }: { role: MemberRole }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useLocalFlag(COLLAPSE_KEY, false);

  function toggle() {
    setCollapsed(!collapsed);
  }

  const visible = navItems.filter((item) => !item.requires || can(role, item.requires));
  const operate = visible.filter((item) => item.group === "operate");
  const manage = visible.filter((item) => item.group === "manage");

  return (
    <nav
      aria-label="Product"
      // `transition-[width]` is the one place a non-transform property is animated:
      // a sidebar that scales would distort its text, and the layout genuinely
      // needs to reflow. It is a discrete user-initiated toggle, not a scroll
      // effect, so it does not run on the compositor path that matters.
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col",
        "border-r border-[var(--color-border-hairline)]",
        "bg-[var(--color-surface-1)] lg:flex",
        "transition-[width] duration-[var(--dur-base)] ease-[var(--ease-cut)]",
        collapsed ? "w-[var(--app-rail-collapsed)]" : "w-[var(--app-rail)]",
      )}
    >
      <div
        className={cn(
          "flex min-h-[var(--app-topbar-height)] items-center",
          // Matches the top bar's height and bottom border exactly, so the
          // wordmark and the breadcrumb sit on one baseline across the seam.
          "border-b border-[var(--color-border-hairline)]",
          collapsed ? "justify-center px-[var(--space-2)]" : "px-[var(--space-6)]",
        )}
      >
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
        >
          {collapsed ? (
            <span aria-hidden="true" className="font-display text-[length:var(--text-title)]">
              V
            </span>
          ) : (
            <Wordmark />
          )}
          <span className="sr-only">Virally — overview</span>
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-[var(--space-1)] overflow-y-auto px-[var(--space-2)] py-[var(--space-4)]">
        {operate.map((item) => (
          <SidebarLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
        ))}

        {manage.length > 0 && (
          <>
            {/* A labelled group rather than a bare divider: the lower section is
                workspace administration, and saying so costs one line. Collapsed,
                there is no room for the label, so the rule carries it. */}
            {collapsed ? (
              <hr className="my-[var(--space-3)] border-0 border-t border-[var(--color-border-hairline)]" />
            ) : (
              <p className="mt-[var(--space-6)] px-[var(--space-3)] pb-[var(--space-2)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                {shellCopy.manageGroupLabel}
              </p>
            )}
            {manage.map((item) => (
              <SidebarLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
            ))}
          </>
        )}
      </div>

      <div className="flex flex-col gap-[var(--space-2)] border-t border-[var(--color-border-hairline)] p-[var(--space-2)]">
        <Link
          href={createAction.href}
          className={cn(
            "flex min-h-11 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)]",
            "bg-[var(--color-action)] text-[color:var(--color-text-oncolor)]",
            "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
            "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
            "hover:bg-[var(--color-action-hover)] active:translate-y-px",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
          )}
        >
          <Plus aria-hidden="true" size={NAV_ICON_SIZE} strokeWidth={2} />
          {!collapsed && <span>{createAction.label}</span>}
          <span className="sr-only">Create a campaign</span>
        </Link>

        {/* Support card. Hidden when collapsed rather than reduced to an icon —
            a prompt to explore templates is not urgent enough to earn a glyph
            the user would have to hover to understand. */}
        {!collapsed && (
          <Link
            href={supportCard.href}
            className={cn(
              "group flex items-start gap-[var(--space-3)] rounded-[var(--radius-sm)]",
              "border border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
              "p-[var(--space-3)]",
              "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
              "hover:border-[var(--color-border)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            )}
          >
            <Lightbulb
              aria-hidden="true"
              size={NAV_ICON_SIZE}
              strokeWidth={NAV_ICON_STROKE}
              className="mt-0.5 shrink-0 text-[color:var(--color-text-muted)]"
            />
            <span className="min-w-0">
              <span className="block text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                {supportCard.title}
              </span>
              <span className="mt-0.5 flex items-center gap-[var(--space-1)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-primary)]">
                {supportCard.action}
                <ChevronRight
                  aria-hidden="true"
                  size={12}
                  strokeWidth={NAV_ICON_STROKE}
                  className="transition-transform duration-[var(--dur-instant)] ease-[var(--ease-cut)] motion-safe:group-hover:translate-x-0.5"
                />
              </span>
            </span>
          </Link>
        )}

        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          className={cn(
            "flex w-full min-h-11 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-3)]",
            "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
            "text-[color:var(--color-text-muted)]",
            "transition-colors duration-[var(--dur-instant)]",
            "hover:text-[color:var(--color-text-primary)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
          ) : (
            <ChevronLeft aria-hidden="true" size={NAV_ICON_SIZE} strokeWidth={NAV_ICON_STROKE} />
          )}
          {!collapsed && <span>{shellCopy.collapseLabel}</span>}
          {collapsed && <span className="sr-only">{shellCopy.expandLabel}</span>}
        </button>
      </div>
    </nav>
  );
}

/**
 * `aria-current="page"` rather than colour alone marks the active route — the
 * amber rule, the raised surface and the icon tint carry it visually, and the
 * attribute carries it for assistive technology.
 */
function SidebarLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  // Exact match for the root, prefix match for everything else, so
  // /app/campaigns/abc still highlights Campaigns without /app matching everything.
  const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
  const Icon = navIcons[item.id];

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex min-h-11 items-center gap-[var(--space-3)] rounded-[var(--radius-sm)]",
        "text-[length:var(--text-body-s)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        collapsed ? "justify-center px-0" : "px-[var(--space-3)]",
        active
          ? "bg-[var(--color-surface-2)] text-[color:var(--color-text-primary)]"
          : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[color:var(--color-text-primary)]",
      )}
    >
      {/* A 2px amber rule pinned to the leading edge, not a colour swap: the
          active state stays legible without relying on hue. Absolutely
          positioned so it does not consume layout width when collapsed. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 h-4 w-0.5 rounded-r-[var(--radius-sm)]",
          active ? "bg-[var(--color-action)]" : "bg-transparent",
        )}
      />

      <Icon
        aria-hidden="true"
        size={NAV_ICON_SIZE}
        strokeWidth={NAV_ICON_STROKE}
        className={cn(
          "shrink-0 transition-colors duration-[var(--dur-instant)]",
          active
            ? "text-[color:var(--color-action)]"
            : "text-[color:var(--color-text-muted)] group-hover:text-[color:var(--color-text-secondary)]",
        )}
      />

      {collapsed ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
    </Link>
  );
}
