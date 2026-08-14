import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  brandProfiles,
  brands,
  onboardingProgress,
  organizationMembers,
  organizations,
  profiles,
  subscriptions,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { auditLogs } from "@/lib/db/schema.fragment";
import type { SessionUser } from "./session";

/**
 * Tenant bootstrap.
 *
 * Ports `bootstrap_current_user` from supabase/migrations/0013_bootstrap.sql:
 * creates the profile, organisation, owner membership, default workspace,
 * placeholder brand, onboarding row and billing placeholder — idempotently,
 * inside one transaction.
 *
 * Called after every successful authentication rather than only on first
 * sign-up. That sounds wasteful and is deliberate: it is one cheap
 * transaction, and it self-heals the case where a bootstrap previously
 * failed partway — which would otherwise leave an account that can sign in
 * and then hit a broken product forever.
 *
 * The original ran as a Postgres function rather than a trigger on
 * `auth.users` specifically so a bootstrap failure never rolls back the
 * signup itself — see that migration's header for why. The Drizzle
 * transaction here achieves the same thing by running as a separate step
 * after Better Auth has already committed the user row.
 */

export type TenantContext = {
  organizationId: string;
  workspaceId: string;
  brandId: string;
  onboardingComplete: boolean;
  /** True when this call created the organisation, i.e. a genuinely new tenant. */
  wasCreated: boolean;
};

export type BootstrapResult =
  | { status: "ok"; context: TenantContext }
  | { status: "failed"; detail: string };

function slugify(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length < 2) slug = "workspace";
  return `${slug.slice(0, 40)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export async function bootstrapTenant(user: SessionUser): Promise<BootstrapResult> {
  try {
    // Fast path: this call runs on EVERY authenticated page load (see
    // resolveTenantContext's doc comment), and the slow path below is a
    // ~10-round-trip transaction that only ever does real work the very
    // first time a tenant is created. For every load after that — which is
    // effectively all of them — one join tells us everything already exists,
    // which is the difference between one round trip and ten on a page a
    // user's browser polls every few seconds while generation runs (see
    // `/app/content/[contentId]`).
    const fast = await tryFastPath(user);
    if (fast) return { status: "ok", context: fast };

    const context = await db.transaction(async (tx) => {
      const avatar = user.image ?? null;

      // --- profile ---------------------------------------------------------
      await tx
        .insert(profiles)
        .values({ id: user.id, email: user.email, fullName: user.name, avatarUrl: avatar })
        .onConflictDoUpdate({
          target: profiles.id,
          set: {
            email: user.email,
            fullName: user.name,
            avatarUrl: avatar ?? undefined,
          },
        });

      // --- existing organisation? -------------------------------------------
      // Owned organisations first: a user invited to someone else's org must
      // not be treated as already bootstrapped, or they never get their own.
      const [existingOwned] = await tx
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.role, "owner")))
        .orderBy(organizationMembers.createdAt)
        .limit(1);

      let organizationId = existingOwned?.organizationId;
      let wasCreated = false;

      if (!organizationId) {
        const [org] = await tx
          .insert(organizations)
          .values({
            name: user.name,
            slug: slugify(user.name),
            accountType: "personal",
            createdBy: user.id,
          })
          .returning({ id: organizations.id });
        organizationId = org!.id;
        wasCreated = true;
      }

      await tx
        .insert(organizationMembers)
        .values({ organizationId, userId: user.id, role: "owner", acceptedAt: new Date() })
        .onConflictDoNothing();

      // --- default workspace -------------------------------------------------
      const [existingWorkspace] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.organizationId, organizationId),
            eq(workspaces.isDefault, true),
          ),
        )
        .limit(1);

      let workspaceId = existingWorkspace?.id;
      if (!workspaceId) {
        const [ws] = await tx
          .insert(workspaces)
          .values({
            organizationId,
            name: "Default workspace",
            slug: "default",
            isDefault: true,
            createdBy: user.id,
          })
          .onConflictDoNothing()
          .returning({ id: workspaces.id });

        workspaceId =
          ws?.id ??
          (
            await tx
              .select({ id: workspaces.id })
              .from(workspaces)
              .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, "default")))
              .limit(1)
          )[0]?.id;
      }
      if (!workspaceId) throw new Error("Failed to resolve a default workspace.");

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId, organizationId, userId: user.id, role: "owner" })
        .onConflictDoNothing();

      // --- placeholder brand ---------------------------------------------
      const [existingBrand] = await tx
        .select({ id: brands.id })
        .from(brands)
        .where(and(eq(brands.workspaceId, workspaceId), eq(brands.isDefault, true)))
        .limit(1);

      let brandId = existingBrand?.id;
      if (!brandId) {
        const [brand] = await tx
          .insert(brands)
          .values({
            organizationId,
            workspaceId,
            name: user.name,
            isPlaceholder: true,
            isDefault: true,
            createdBy: user.id,
          })
          .returning({ id: brands.id });
        brandId = brand!.id;

        await tx
          .insert(brandProfiles)
          .values({ brandId, workspaceId })
          .onConflictDoNothing();
      }

      // --- onboarding ------------------------------------------------------
      await tx
        .insert(onboardingProgress)
        .values({ organizationId, userId: user.id })
        .onConflictDoNothing();

      const [onboarding] = await tx
        .select({ completedAt: onboardingProgress.completedAt })
        .from(onboardingProgress)
        .where(
          and(
            eq(onboardingProgress.organizationId, organizationId),
            eq(onboardingProgress.userId, user.id),
          ),
        )
        .limit(1);

      // --- billing placeholder ---------------------------------------------
      await tx
        .insert(subscriptions)
        .values({ organizationId, provider: "none", planCode: "free", status: "unconfigured" })
        .onConflictDoNothing();

      // --- audit -------------------------------------------------------------
      if (wasCreated) {
        await tx.insert(auditLogs).values({
          organizationId,
          workspaceId,
          actorId: user.id,
          actorEmail: user.email,
          action: "organization.bootstrapped",
          subjectType: "organization",
          subjectId: organizationId,
        });
      }

      return {
        organizationId,
        workspaceId,
        brandId,
        onboardingComplete: Boolean(onboarding?.completedAt),
        wasCreated,
      } satisfies TenantContext;
    });

    return { status: "ok", context };
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "Unknown bootstrap failure.",
    };
  }
}

/**
 * One query, no writes in the common case.
 *
 * Mirrors exactly what the slow path resolves for a user who already owns an
 * organisation: the same "owned, oldest first" org, its default workspace,
 * its default brand and its onboarding row. Returns null — falling through to
 * the full self-healing transaction — for anything that query cannot find in
 * one shot: no owned org yet, or a workspace/brand that a previous partial
 * bootstrap failed to create. The slow path's inserts are all
 * `onConflictDoNothing`/idempotent, so falling through here is always safe,
 * just occasionally slower than it needs to be.
 */
async function tryFastPath(user: SessionUser): Promise<TenantContext | null> {
  const rows = await db
    .select({
      organizationId: organizationMembers.organizationId,
      workspaceId: workspaces.id,
      brandId: brands.id,
      onboardingCompletedAt: onboardingProgress.completedAt,
      profileEmail: profiles.email,
      profileName: profiles.fullName,
      profileAvatar: profiles.avatarUrl,
    })
    .from(organizationMembers)
    .innerJoin(
      workspaces,
      and(eq(workspaces.organizationId, organizationMembers.organizationId), eq(workspaces.isDefault, true)),
    )
    .leftJoin(brands, and(eq(brands.workspaceId, workspaces.id), eq(brands.isDefault, true)))
    .leftJoin(
      onboardingProgress,
      and(
        eq(onboardingProgress.organizationId, organizationMembers.organizationId),
        eq(onboardingProgress.userId, organizationMembers.userId),
      ),
    )
    .leftJoin(profiles, eq(profiles.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.userId, user.id), eq(organizationMembers.role, "owner")))
    .orderBy(organizationMembers.createdAt)
    .limit(1);

  const row = rows[0];
  if (!row || !row.brandId) return null;

  const avatar = user.image ?? null;
  const profileStale =
    row.profileEmail !== user.email || row.profileName !== user.name || row.profileAvatar !== avatar;
  if (profileStale) {
    await db
      .update(profiles)
      .set({ email: user.email, fullName: user.name, avatarUrl: avatar ?? undefined })
      .where(eq(profiles.id, user.id));
  }

  return {
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    brandId: row.brandId,
    onboardingComplete: Boolean(row.onboardingCompletedAt),
    wasCreated: false,
  };
}
