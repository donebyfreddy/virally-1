import { and, eq, isNull } from "drizzle-orm";
import type { MemberRole, Permission } from "@/types/database";
import { can } from "@/lib/permissions";
import { db as defaultDb } from "./index";
import {
  organizationMembers,
  organizations,
  planLimits,
  subscriptions,
  workspaceLimits,
  workspaceMembers,
  workspaces,
} from "./schema";

/**
 * Application-layer authorization.
 *
 * Ports supabase/migrations/0002_tenancy.sql's SECURITY DEFINER helpers
 * (app.is_org_member, app.has_workspace_permission, etc.) and 0015's
 * app.workspace_account_slot_limit. Neon has no row-level security enforcing
 * these anymore — EVERY query that reads or writes tenant data must call one
 * of the `assert*` functions below before touching the database, and every
 * `list*`/`get*` read must filter by the ids these functions validate.
 *
 * This is a deliberate architectural shift from "the database refuses",
 * which failed closed even for a query nobody remembered to guard, to "the
 * query guards itself" — which fails open if a call site forgets. There is
 * no substitute for reviewing every new query against this file.
 */

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

type DbLike = typeof defaultDb;

/** The caller's role in an organisation, or null if not a member. */
export async function orgRole(
  userId: string,
  organizationId: string,
  database: DbLike = defaultDb,
): Promise<MemberRole | null> {
  const [row] = await database
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

export async function isOrgMember(
  userId: string,
  organizationId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  return (await orgRole(userId, organizationId, database)) !== null;
}

export async function isOrgOwner(
  userId: string,
  organizationId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  return (await orgRole(userId, organizationId, database)) === "owner";
}

/**
 * Effective role for a workspace: the workspace override if set, else the
 * organisation role. Mirrors app.workspace_role().
 */
export async function workspaceRole(
  userId: string,
  workspaceId: string,
  database: DbLike = defaultDb,
): Promise<MemberRole | null> {
  const [workspaceRow] = await database
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspaceRow) return null;

  const [override] = await database
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1);
  if (override?.role) return override.role;

  return orgRole(userId, workspaceRow.organizationId, database);
}

/**
 * Workspace membership. Organisation owners/admins are implicit members of
 * every workspace in their org — otherwise an owner could create a workspace
 * and immediately lose access to it. Mirrors app.is_workspace_member().
 */
export async function isWorkspaceMember(
  userId: string,
  workspaceId: string,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const [directMember] = await database
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1);
  if (directMember) return true;

  const role = await workspaceRole(userId, workspaceId, database);
  // workspaceRole already resolves the org fallback; an implicit owner/admin
  // has no workspace_members row but still resolves a role via the org.
  return role === "owner" || role === "admin"
    ? true
    : role !== null && (await isOrgMemberOfWorkspace(userId, workspaceId, database));
}

async function isOrgMemberOfWorkspace(
  userId: string,
  workspaceId: string,
  database: DbLike,
): Promise<boolean> {
  const [directMember] = await database
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1);
  return Boolean(directMember);
}

export async function hasOrgPermission(
  userId: string,
  organizationId: string,
  permission: Permission,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const role = await orgRole(userId, organizationId, database);
  return can(role, permission);
}

export async function hasWorkspacePermission(
  userId: string,
  workspaceId: string,
  permission: Permission,
  database: DbLike = defaultDb,
): Promise<boolean> {
  const role = await workspaceRole(userId, workspaceId, database);
  return can(role, permission);
}

/**
 * Throws ForbiddenError rather than returning a boolean — server actions and
 * route handlers call this first and let the throw abort the request, so a
 * forgotten `if` cannot silently proceed.
 */
export async function assertWorkspaceMember(
  userId: string,
  workspaceId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  if (!(await isWorkspaceMember(userId, workspaceId, database))) {
    throw new ForbiddenError(`User is not a member of workspace ${workspaceId}.`);
  }
}

export async function assertOrgMember(
  userId: string,
  organizationId: string,
  database: DbLike = defaultDb,
): Promise<void> {
  if (!(await isOrgMember(userId, organizationId, database))) {
    throw new ForbiddenError(`User is not a member of organization ${organizationId}.`);
  }
}

export async function assertWorkspacePermission(
  userId: string,
  workspaceId: string,
  permission: Permission,
  database: DbLike = defaultDb,
): Promise<void> {
  if (!(await hasWorkspacePermission(userId, workspaceId, permission, database))) {
    throw new ForbiddenError(
      `User lacks permission "${permission}" in workspace ${workspaceId}.`,
    );
  }
}

export async function assertOrgPermission(
  userId: string,
  organizationId: string,
  permission: Permission,
  database: DbLike = defaultDb,
): Promise<void> {
  if (!(await hasOrgPermission(userId, organizationId, permission, database))) {
    throw new ForbiddenError(
      `User lacks permission "${permission}" in organization ${organizationId}.`,
    );
  }
}

/**
 * Effective slot limit: workspace override, else plan default, else 10.
 * Mirrors app.workspace_account_slot_limit() — never returns null for an
 * existing workspace, so an unresolvable plan degrades to the documented
 * default rather than to zero capacity (see 0015's rationale).
 */
export async function workspaceAccountSlotLimit(
  workspaceId: string,
  database: DbLike = defaultDb,
): Promise<number> {
  const [workspaceRow] = await database
    .select({ organizationId: workspaces.organizationId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspaceRow) {
    throw new ForbiddenError(`Workspace ${workspaceId} does not exist.`);
  }

  const [override] = await database
    .select({ accountSlotLimit: workspaceLimits.accountSlotLimit })
    .from(workspaceLimits)
    .where(eq(workspaceLimits.workspaceId, workspaceId))
    .limit(1);
  if (override?.accountSlotLimit != null) return override.accountSlotLimit;

  const [subscription] = await database
    .select({ planCode: subscriptions.planCode })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, workspaceRow.organizationId))
    .limit(1);

  if (subscription?.planCode) {
    const [plan] = await database
      .select({ accountSlotLimit: planLimits.accountSlotLimit })
      .from(planLimits)
      .where(eq(planLimits.planCode, subscription.planCode))
      .limit(1);
    if (plan?.accountSlotLimit != null) return plan.accountSlotLimit;
  }

  return 10;
}

/** Re-exported for call sites that only need the "not deleted" predicate. */
export const notDeleted = isNull;
export { organizations };
