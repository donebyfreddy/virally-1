import { cookies } from "next/headers";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { MemberRole } from "@/types/database";
import { db } from "@/lib/db";
import {
  brands,
  organizationMembers,
  organizations,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { onboardingProgress } from "@/lib/db/schema.fragment";
import { bootstrapTenant } from "@/lib/auth/bootstrap";
import type { SessionUser } from "@/lib/auth/session";
import { effectiveRole } from "@/lib/permissions";

/**
 * Resolves which organisation, workspace and brand the request is operating in.
 *
 * Every product page needs this, so it is one query set rather than each
 * surface fetching its own. The selected workspace and brand live in cookies,
 * and both are VALIDATED against real membership rows on every read — a
 * cookie is user-controlled input, and there is no RLS to fall back on
 * anymore, so this function IS the isolation boundary for workspace/brand
 * selection (see src/lib/db/authorization.ts for the rest of it).
 */

export const WORKSPACE_COOKIE = "virally_workspace";
export const BRAND_COOKIE = "virally_brand";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  organizationId: string;
  organizationName: string;
};

export type BrandSummary = {
  id: string;
  name: string;
  isPlaceholder: boolean;
  isDefault: boolean;
};

export type TenantContext = {
  user: SessionUser;
  organizationId: string;
  organizationName: string;
  workspaceId: string;
  workspaceName: string;
  /** Effective role in the active workspace: override, else organisation role. */
  role: MemberRole;
  brandId: string | null;
  onboardingComplete: boolean;
  /** Every workspace the user can switch to, across all their organisations. */
  workspaces: readonly WorkspaceSummary[];
  brands: readonly BrandSummary[];
};

export type TenantResolution =
  | { status: "ok"; context: TenantContext }
  /** Authenticated but no tenant rows yet — onboarding has not run. */
  | { status: "needs_bootstrap" }
  | { status: "failed"; detail: string };

export async function resolveTenantContext(user: SessionUser): Promise<TenantResolution> {
  // Bootstrap first. It is idempotent and cheap, and running it here means a
  // user whose earlier bootstrap failed self-heals on their next page load
  // rather than being permanently stuck with an account that cannot use the
  // product.
  const bootstrap = await bootstrapTenant(user);
  if (bootstrap.status === "failed") {
    return { status: "failed", detail: bootstrap.detail };
  }

  const memberships = await db
    .select({
      organizationId: organizationMembers.organizationId,
      role: organizationMembers.role,
      organizationName: organizations.name,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, user.id))
    .orderBy(asc(organizationMembers.createdAt));

  if (memberships.length === 0) return { status: "needs_bootstrap" };

  const roleByOrg = new Map<string, MemberRole>();
  const nameByOrg = new Map<string, string>();
  const orgIds: string[] = [];
  for (const row of memberships) {
    roleByOrg.set(row.organizationId, row.role);
    nameByOrg.set(row.organizationId, row.organizationName);
    orgIds.push(row.organizationId);
  }

  // Scoped explicitly to the caller's own organisations — there is no RLS to
  // do this implicitly anymore, so an unscoped query here would leak every
  // tenant's workspaces.
  const workspaceRows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      isDefault: workspaces.isDefault,
      organizationId: workspaces.organizationId,
    })
    .from(workspaces)
    .where(and(isNull(workspaces.deletedAt), inArray(workspaces.organizationId, orgIds)))
    .orderBy(desc(workspaces.isDefault), asc(workspaces.name));

  const workspaceList: WorkspaceSummary[] = workspaceRows.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    isDefault: w.isDefault,
    organizationId: w.organizationId,
    organizationName: nameByOrg.get(w.organizationId) ?? "Organisation",
  }));

  if (workspaceList.length === 0) return { status: "needs_bootstrap" };

  const cookieStore = await cookies();
  const requestedWorkspace = cookieStore.get(WORKSPACE_COOKIE)?.value;

  // The validation that matters: fall back to the default rather than
  // trusting the cookie. `find` over the caller's own workspace list above is
  // the membership check.
  const active =
    workspaceList.find((w) => w.id === requestedWorkspace) ??
    workspaceList.find((w) => w.isDefault) ??
    workspaceList[0];

  if (!active) return { status: "needs_bootstrap" };

  const [workspaceMembership] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, active.id), eq(workspaceMembers.userId, user.id)))
    .limit(1);

  const role =
    effectiveRole(roleByOrg.get(active.organizationId) ?? null, workspaceMembership?.role ?? null) ??
    "viewer";

  const brandRows = await db
    .select({
      id: brands.id,
      name: brands.name,
      isPlaceholder: brands.isPlaceholder,
      isDefault: brands.isDefault,
    })
    .from(brands)
    .where(and(eq(brands.workspaceId, active.id), isNull(brands.deletedAt)))
    .orderBy(desc(brands.isDefault), asc(brands.name));

  const brandList: BrandSummary[] = brandRows;

  const requestedBrand = cookieStore.get(BRAND_COOKIE)?.value;
  const activeBrand =
    brandList.find((b: BrandSummary) => b.id === requestedBrand) ??
    brandList.find((b: BrandSummary) => b.isDefault) ??
    brandList[0];

  const [onboarding] = await db
    .select({ completedAt: onboardingProgress.completedAt })
    .from(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.organizationId, active.organizationId),
        eq(onboardingProgress.userId, user.id),
      ),
    )
    .limit(1);

  return {
    status: "ok",
    context: {
      user,
      organizationId: active.organizationId,
      organizationName: active.organizationName,
      workspaceId: active.id,
      workspaceName: active.name,
      role,
      brandId: activeBrand?.id ?? null,
      onboardingComplete: Boolean(onboarding?.completedAt),
      workspaces: workspaceList,
      brands: brandList,
    },
  };
}
