import type { MemberRole, Permission } from "@/types/database";

/**
 * Client-side permission resolution.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. Row-level security is, and it is enforced in
 * Postgres regardless of what this file says. This exists so the UI can hide an
 * action the user cannot perform, which is a usability concern — offering a button
 * that will fail is worse than not offering it.
 *
 * The brief is explicit that hiding buttons is not authorisation, so every
 * mutation additionally re-checks server-side and every table is behind RLS.
 *
 * The matrix below MIRRORS `app.role_permissions` in
 * supabase/migrations/0001_foundation.sql. Two copies of a rule will eventually
 * disagree, so `permissions.test.ts` asserts this table against the migration's
 * SQL text — if a role gains a permission in SQL and not here, the test fails.
 */
const ROLE_PERMISSIONS: Readonly<Record<MemberRole, readonly Permission[]>> = {
  // Owner and admin hold every permission. The difference between them is not
  // expressed here: it is enforced by policy — an admin cannot alter an owner or
  // delete the organisation.
  owner: [
    "content.create",
    "content.approve",
    "content.publish",
    "content.delete",
    "campaign.manage",
    "accounts.connect",
    "accounts.disconnect",
    "analytics.view",
    "billing.view",
    "billing.manage",
    "team.manage",
    "workspace.manage",
    "assets.delete",
  ],
  admin: [
    "content.create",
    "content.approve",
    "content.publish",
    "content.delete",
    "campaign.manage",
    "accounts.connect",
    "accounts.disconnect",
    "analytics.view",
    "billing.view",
    "billing.manage",
    "team.manage",
    "workspace.manage",
    "assets.delete",
  ],
  strategist: [
    "content.create",
    "content.approve",
    "campaign.manage",
    "analytics.view",
  ],
  // Makes things. Deliberately cannot approve its own work or publish.
  editor: ["content.create", "analytics.view"],
  // Approves or rejects. Cannot author or publish — the separation is what makes
  // the approval step meaningful rather than ceremonial.
  reviewer: ["content.approve", "analytics.view"],
  publisher: ["content.publish", "analytics.view"],
  analyst: ["analytics.view"],
  viewer: ["analytics.view"],
};

export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as MemberRole[];

/** Presentation order: most privileged first, as the team screen lists them. */
export const ROLE_ORDER: readonly MemberRole[] = [
  "owner",
  "admin",
  "strategist",
  "editor",
  "reviewer",
  "publisher",
  "analyst",
  "viewer",
];

export const ROLE_LABELS: Readonly<Record<MemberRole, string>> = {
  owner: "Owner",
  admin: "Administrator",
  strategist: "Strategist",
  editor: "Editor",
  reviewer: "Reviewer",
  publisher: "Publisher",
  analyst: "Analyst",
  viewer: "Viewer",
};

/**
 * What each role is *for*, in one sentence. Shown next to the role picker: an
 * invitation form that lists eight opaque nouns produces mis-assigned roles, which
 * is a security problem expressed as a UX one.
 */
export const ROLE_DESCRIPTIONS: Readonly<Record<MemberRole, string>> = {
  owner: "Full control, including billing and deleting the organisation.",
  admin: "Everything except transferring ownership.",
  strategist: "Plans campaigns, creates and approves content. No billing or team access.",
  editor: "Creates and edits content. Cannot approve or publish.",
  reviewer: "Approves or rejects content. Cannot create or publish.",
  publisher: "Publishes approved content to connected accounts. Cannot approve.",
  analyst: "Reads analytics only.",
  viewer: "Read-only access to analytics.",
};

export function permissionsFor(role: MemberRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: MemberRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** True when the role holds every listed permission. */
export function canAll(
  role: MemberRole | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => can(role, permission));
}

/** True when the role holds at least one of the listed permissions. */
export function canAny(
  role: MemberRole | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(role, permission));
}

/**
 * The effective role for a workspace: the workspace override when present, else
 * the organisation role. Mirrors `app.workspace_role()`.
 */
export function effectiveRole(
  organizationRole: MemberRole | null,
  workspaceRole: MemberRole | null,
): MemberRole | null {
  return workspaceRole ?? organizationRole;
}
