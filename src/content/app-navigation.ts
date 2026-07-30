import type { Permission } from "@/types/database";

/**
 * Application navigation.
 *
 * `requires` gates a destination on a permission so a viewer is not shown a Team
 * page they cannot use. This is presentation only — the route itself re-checks
 * server-side, because hiding a link is not access control.
 *
 * `phase` records which implementation phase owns the surface. Routes whose phase
 * has not shipped render a stated gap rather than a mockup; the field is what lets
 * the shell mark them honestly instead of pretending they work.
 */
export type NavItem = {
  id: string;
  label: string;
  href: string;
  /** Short description used by the command palette and mobile nav. */
  hint: string;
  requires?: Permission;
  phase: number;
  /** Groups items under a divider in the sidebar. */
  group: "operate" | "manage";
};

export const navItems: readonly NavItem[] = [
  { id: "overview", label: "Overview", href: "/app", hint: "Performance, queue and account health", phase: 4, group: "operate" },
  { id: "create", label: "Create", href: "/app/create", hint: "Turn a brief into a campaign", requires: "content.create", phase: 5, group: "operate" },
  { id: "campaigns", label: "Campaigns", href: "/app/campaigns", hint: "Concepts, scripts and variants", phase: 5, group: "operate" },
  { id: "content", label: "Content", href: "/app/content", hint: "Every generated item and variant", phase: 6, group: "operate" },
  { id: "calendar", label: "Calendar", href: "/app/calendar", hint: "Scheduled and published posts", phase: 8, group: "operate" },
  { id: "accounts", label: "Accounts", href: "/app/accounts", hint: "Authorised social accounts", phase: 7, group: "operate" },
  { id: "analytics", label: "Analytics", href: "/app/analytics", hint: "Reach, retention and cost", requires: "analytics.view", phase: 9, group: "operate" },
  { id: "library", label: "Library", href: "/app/library", hint: "Source and generated media", phase: 6, group: "operate" },
  { id: "experiments", label: "Experiments", href: "/app/experiments", hint: "Compare hooks, thumbnails and timing", phase: 10, group: "operate" },

  { id: "team", label: "Team", href: "/app/team", hint: "Members, roles and invitations", requires: "team.manage", phase: 10, group: "manage" },
  { id: "usage", label: "Usage", href: "/app/usage", hint: "Credits, storage and provider cost", requires: "billing.view", phase: 10, group: "manage" },
  { id: "settings", label: "Settings", href: "/app/settings", hint: "Workspace, brand and preferences", phase: 10, group: "manage" },
] as const;

/** The persistent create action, kept out of `navItems` so it renders as a button. */
export const createAction = {
  label: "Create",
  href: "/app/create",
  shortcut: "C",
} as const;

export const shellCopy = {
  searchPlaceholder: "Search campaigns, content, accounts",
  commandPaletteHint: "⌘K",
  workspaceLabel: "Workspace",
  brandLabel: "Brand",
  notificationsLabel: "Notifications",
  userMenuLabel: "Account",
  collapseLabel: "Collapse sidebar",
  expandLabel: "Expand sidebar",
  openNavLabel: "Open navigation",
  closeNavLabel: "Close navigation",
} as const;

/**
 * Copy for a route whose phase has not been implemented.
 *
 * Deliberately specific about what is missing and what already exists, because a
 * generic "coming soon" tells a user nothing about whether their data is safe or
 * whether they should wait.
 */
export const notBuiltCopy = {
  eyebrow: "NOT IMPLEMENTED YET",
  heading: (label: string) => `${label} is not built yet.`,
  body: (phase: number) =>
    `This route exists so navigation never lands on a missing page. The surface is owned by implementation phase ${phase}. Nothing here is a mockup — when it ships it will read live data from your workspace.`,
} as const;
