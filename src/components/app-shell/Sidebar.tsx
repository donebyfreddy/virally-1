"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import type { MemberRole } from "@/types/database";
import { cn } from "@/lib/cn";
import { useLocalFlag } from "@/lib/hooks/useLocalFlag";
import { can } from "@/lib/permissions";
import {
  navItems,
  createAction,
  shellCopy,
  navGroupLabels,
  type NavItem,
} from "@/content/app-navigation";
import { Wordmark } from "@/components/navigation/Wordmark";
import { NAV_ICON_SIZE, NAV_ICON_STROKE, navIcons } from "./navIcons";

const COLLAPSE_KEY = "virally:sidebar-collapsed";

/**
 * Desktop sidebar.
 *
 * Light, compact, and structured — the rail is chrome, not a landing surface.
 * Three things changed from the first version, all of them about giving the
 * content column back space it was spending on the rail:
 *
 *   - The create action moved to the TOP, directly under the wordmark. A
 *     permanently-docked button at the bottom of a 12-item rail is a footer that
 *     never scrolls away, and it read as the loudest thing on the page.
 *   - The "need inspiration?" card is gone. Template discovery belongs in the
 *     empty state of the surface it populates, where the user is already stuck,
 *     not in the rail on every screen forever.
 *   - The collapse toggle sits in the header row beside the wordmark rather than
 *     owning a row of its own at the foot.
 *
 * Collapse state is local to the browser (localStorage), not the database: it is
 * a per-device viewport preference, and round-tripping it through the server
 * would add a write on every toggle and still be wrong on a second monitor.
 *
 * Read through `useSyncExternalStore`, which resolves the hydration problem
 * without a mount effect — see useLocalFlag.
 */
export function Sidebar({ role }: { role: MemberRole }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useLocalFlag(COLLAPSE_KEY, false);

  const visible = navItems.filter((item) => !item.requires || can(role, item.requires));
  const operate = visible.filter((item) => item.group === "operate");
  const manage = visible.filter((item) => item.group === "manage");

  return (
    <nav
      aria-label="Product"
      // `transition-[width]` is the one place a non-transform property is
      // animated: a sidebar that scales would distort its text, and the layout
      // genuinely needs to reflow. It is a discrete user-initiated toggle, not a
      // scroll effect, so it does not run on the compositor path that matters.
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col lg:flex",
        "border-r border-[var(--border-default)] bg-[var(--surface-primary)]",
        "transition-[width] duration-[var(--dur-base)] ease-[var(--ease-cut)]",
        collapsed ? "w-[var(--app-rail-collapsed)]" : "w-[var(--app-rail)]",
      )}
    >
      {/* Header. Matches the top bar's height and bottom border exactly, so the
          wordmark and the page title sit on one baseline across the seam. */}
      <div
        className={cn(
          "flex min-h-[var(--app-topbar-height)] items-center gap-[var(--space-2)]",
          "border-b border-[var(--border-default)]",
          collapsed ? "flex-col justify-center py-[var(--space-2)]" : "px-[var(--space-3)]",
        )}
      >
        <Link
          href="/app"
          className={cn(
            "inline-flex items-center rounded-[var(--radius-control)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          )}
        >
          {collapsed ? <BrandMark /> : <Wordmark />}
          <span className="sr-only">Virally — overview</span>
        </Link>

        {!collapsed && (
          <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed(true)} />
        )}
      </div>

      {/* Create action. Compact — a 36px-tall button, not a 56px block. */}
      <div className={cn("pt-[var(--space-3)]", collapsed ? "px-[var(--space-2)]" : "px-[var(--space-3)]")}>
        <Link
          href={createAction.href}
          title={collapsed ? createAction.label : undefined}
          className={cn(
            "flex h-9 items-center justify-center gap-[var(--space-2)]",
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
        </Link>
      </div>

      <div
        className={cn(
          "flex flex-1 flex-col gap-px overflow-y-auto py-[var(--space-4)]",
          collapsed ? "px-[var(--space-2)]" : "px-[var(--space-3)]",
        )}
      >
        <GroupLabel collapsed={collapsed} first>
          {navGroupLabels.operate}
        </GroupLabel>
        {operate.map((item) => (
          <SidebarLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
        ))}

        {manage.length > 0 && (
          <>
            <GroupLabel collapsed={collapsed}>{navGroupLabels.manage}</GroupLabel>
            {manage.map((item) => (
              <SidebarLink key={item.id} item={item} pathname={pathname} collapsed={collapsed} />
            ))}
          </>
        )}
      </div>

      {/* Collapsed state has no room for a label beside the wordmark, so the
          expand control lives at the foot instead. */}
      {collapsed && (
        <div className="flex justify-center border-t border-[var(--border-default)] p-[var(--space-2)]">
          <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed(false)} />
        </div>
      )}
    </nav>
  );
}

/**
 * The collapsed-rail brand mark.
 *
 * A teal tile rather than a bare letter: at 4rem wide the rail has nothing else
 * to anchor the eye, and an unboxed "V" reads as a stray character.
 */
function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 items-center justify-center rounded-[var(--radius-control)]",
        "bg-[var(--brand-primary)] text-[color:var(--text-on-brand)]",
        "text-[0.9375rem] font-[var(--weight-heading)]",
      )}
    >
      V
    </span>
  );
}

function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const label = collapsed ? shellCopy.expandLabel : shellCopy.collapseLabel;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={collapsed}
      title={label}
      className={cn(
        // 32px visually, with the touch target extended by a transparent inset
        // pseudo-element rather than by padding, so it does not push the
        // wordmark off the header row. See the `after:` classes.
        "relative ml-auto flex size-8 shrink-0 items-center justify-center",
        "rounded-[var(--radius-control)] text-[color:var(--text-muted)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2",
      )}
    >
      <Icon aria-hidden="true" size={17} strokeWidth={NAV_ICON_STROKE} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * Group heading inside the rail.
 *
 * Collapsed, a text label has nowhere to go, so the group boundary degrades to a
 * rule — which still says "these are different kinds of destination" without
 * requiring a hover to read.
 */
function GroupLabel({
  children,
  collapsed,
  first = false,
}: {
  children: string;
  collapsed: boolean;
  first?: boolean;
}) {
  if (collapsed) {
    return first ? null : (
      <hr className="mx-auto my-[var(--space-3)] w-6 border-0 border-t border-[var(--border-default)]" />
    );
  }

  return (
    <p
      className={cn(
        "app-label px-[var(--space-2)] pb-[var(--space-2)]",
        !first && "pt-[var(--space-5)]",
      )}
    >
      {children}
    </p>
  );
}

/**
 * A rail destination.
 *
 * The active state is carried by three channels, not one: a soft teal
 * background, a teal icon, and a heavier label weight. Colour alone would fail
 * for a user who cannot separate the mint wash from white, and
 * `aria-current="page"` carries it for assistive technology regardless.
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
  // /app/campaigns/abc still highlights Campaigns without /app matching all.
  const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
  const Icon = navIcons[item.id];

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-[var(--space-3)]",
        // 36px rows rather than 44px: twelve destinations at 44px is 528px of
        // rail, which overflows a 13" laptop. The 44px touch-target floor is met
        // by the transparent `after:` inset below, which the pointer and
        // assistive tech both hit.
        "h-9 rounded-[var(--radius-control)]",
        "text-[length:var(--text-app-cell)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
        collapsed ? "justify-center px-0" : "px-[var(--space-2)]",
        active
          ? "bg-[var(--brand-soft)] text-[color:var(--brand-ink)] font-[var(--weight-strong)]"
          : "text-[color:var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
      )}
    >
      <Icon
        aria-hidden="true"
        size={NAV_ICON_SIZE}
        strokeWidth={active ? 2 : NAV_ICON_STROKE}
        className={cn(
          "shrink-0 transition-colors duration-[var(--dur-instant)]",
          active
            ? "text-[color:var(--brand-primary)]"
            : "text-[color:var(--text-muted)] group-hover:text-[color:var(--text-secondary)]",
        )}
      />

      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
    </Link>
  );
}
