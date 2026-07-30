"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { useLocalFlag } from "@/lib/hooks/useLocalFlag";
import { can } from "@/lib/permissions";
import { navItems, createAction, shellCopy, type NavItem } from "@/content/app-navigation";
import { Wordmark } from "@/components/navigation/Wordmark";

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
        "hidden h-dvh shrink-0 flex-col border-r border-[var(--color-border-hairline)]",
        "bg-[var(--color-surface-1)] lg:flex",
        "transition-[width] duration-[var(--dur-base)] ease-[var(--ease-cut)]",
        collapsed ? "w-[4.5rem]" : "w-[15rem]",
      )}
    >
      <div className={cn("flex min-h-16 items-center", collapsed ? "justify-center px-2" : "px-6")}>
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

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-4">
        {operate.map((item) => (
          <SidebarLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
        ))}

        {manage.length > 0 && (
          <>
            <hr className="my-3 border-0 border-t border-[var(--color-border-hairline)]" />
            {manage.map((item) => (
              <SidebarLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
            ))}
          </>
        )}
      </div>

      <div className="border-t border-[var(--color-border-hairline)] p-2">
        <Link
          href={createAction.href}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)]",
            "bg-[var(--color-action)] text-[color:var(--color-text-oncolor)]",
            "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
            "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
            "hover:bg-[var(--color-action-hover)] active:translate-y-px",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
          )}
        >
          <span aria-hidden="true">+</span>
          {!collapsed && <span>{createAction.label}</span>}
          <span className="sr-only">Create a campaign</span>
        </Link>

        <button
          type="button"
          onClick={toggle}
          aria-pressed={collapsed}
          className={cn(
            "mt-1 flex w-full min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3",
            "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
            "text-[color:var(--color-text-muted)]",
            "transition-colors duration-[var(--dur-instant)]",
            "hover:text-[color:var(--color-text-primary)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            collapsed && "justify-center px-0",
          )}
        >
          <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          {!collapsed && <span>{shellCopy.collapseLabel}</span>}
          {collapsed && <span className="sr-only">{shellCopy.expandLabel}</span>}
        </button>
      </div>
    </nav>
  );
}

/**
 * `aria-current="page"` rather than colour alone marks the active route — the
 * border and the weight change carry it visually, and the attribute carries it for
 * assistive technology.
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

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-[var(--radius-sm)] px-3",
        "text-[length:var(--text-body-s)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        active
          ? "bg-[var(--color-surface-2)] text-[color:var(--color-text-primary)]"
          : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[color:var(--color-text-primary)]",
        collapsed && "justify-center px-0",
      )}
    >
      {/* A 2px rule, not a colour swap: the active state stays legible without
          relying on hue. */}
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-0.5 shrink-0 rounded-[var(--radius-sm)]",
          active ? "bg-[var(--color-action)]" : "bg-transparent",
        )}
      />
      {collapsed ? (
        <>
          <span aria-hidden="true" className="font-utility text-[length:var(--text-utility)]">
            {item.label.charAt(0)}
          </span>
          <span className="sr-only">{item.label}</span>
        </>
      ) : (
        <span>{item.label}</span>
      )}
    </Link>
  );
}
