/**
 * ACCOUNT NETWORK — server reads.
 *
 * Every query here is explicitly filtered to `context.workspaceId`. There is
 * no RLS behind this anymore, so this filter IS the isolation boundary, not a
 * defence-in-depth belt over a database policy.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountSlots, connectedAccounts } from "@/lib/db/schema";
import { workspaceAccountSlotLimit } from "@/lib/db/authorization";
import type { TenantContext } from "@/lib/tenant/context";
import type { Platform } from "@/types/database";
import { buildSlotGrid, type OccupiedSlot, type SlotUsage, type SlotView } from "./slots";

export type UnslottedAccount = {
  id: string;
  platform: Platform;
  username: string | null;
  displayName: string | null;
  health: string;
};

export type AccountNetwork = {
  usage: SlotUsage;
  grid: SlotView[];
  archived: OccupiedSlot[];
  /**
   * Connected accounts with no slot pointing at them.
   *
   * Should be empty: slots are claimed as part of connecting. It is surfaced
   * rather than ignored because the alternative is an account that exists,
   * can be published to, and is invisible on the screen that is supposed to
   * list every account.
   */
  unslotted: UnslottedAccount[];
  /** True when the usage view returned nothing — see resolveUsage. */
  usageUnavailable: boolean;
};

/**
 * Ports `public.workspace_slot_usage` (supabase/migrations/0015) into
 * application code — the view's own WHERE clause was its only authorisation
 * (`app.is_workspace_member`), which is dropped along with RLS, so this is
 * now computed directly from data already scoped to the caller's workspace
 * rather than queried from a view with no equivalent guard left to give it.
 *
 * `workspaceAccountSlotLimit` never fails for a workspace that exists (it
 * falls back through workspace override → plan default → a hardcoded floor
 * of 10 — see that function's docs), so `unavailable` stays false; it is
 * kept in the return shape only so a future failure mode has somewhere to
 * report itself without changing every caller.
 */
async function resolveUsage(
  workspaceId: string,
  activeCount: number,
  archivedCount: number,
  connectedCount: number,
): Promise<{ usage: SlotUsage; unavailable: boolean }> {
  const limit = await workspaceAccountSlotLimit(workspaceId);
  return {
    usage: {
      slotLimit: limit,
      activeSlots: activeCount,
      connectedSlots: connectedCount,
      archivedSlots: archivedCount,
      availableSlots: Math.max(0, limit - activeCount),
    },
    unavailable: false,
  };
}

export async function loadAccountNetwork(context: TenantContext): Promise<AccountNetwork> {
  const [slotRows, accountRows] = await Promise.all([
    db
      .select({
        id: accountSlots.id,
        slotNumber: accountSlots.slotNumber,
        platform: accountSlots.platform,
        status: accountSlots.status,
        displayLabel: accountSlots.displayLabel,
        brandId: accountSlots.brandId,
        accountLaunchKitId: accountSlots.accountLaunchKitId,
        connectedAccountId: accountSlots.connectedAccountId,
        archivedAt: accountSlots.archivedAt,
      })
      .from(accountSlots)
      .where(eq(accountSlots.workspaceId, context.workspaceId))
      .orderBy(accountSlots.slotNumber),
    db
      .select({
        id: connectedAccounts.id,
        platform: connectedAccounts.platform,
        username: connectedAccounts.username,
        displayName: connectedAccounts.displayName,
        avatarUrl: connectedAccounts.avatarUrl,
        followerCount: connectedAccounts.followerCount,
        lastSyncedAt: connectedAccounts.lastSyncedAt,
        health: connectedAccounts.health,
      })
      .from(connectedAccounts)
      .where(
        and(eq(connectedAccounts.workspaceId, context.workspaceId), isNull(connectedAccounts.disconnectedAt)),
      ),
  ]);

  const accountsById = new Map(accountRows.map((a) => [a.id, a]));
  const brandsById = new Map(context.brands.map((b) => [b.id, b.name]));

  const toOccupied = (row: (typeof slotRows)[number]): OccupiedSlot => {
    const account = row.connectedAccountId ? accountsById.get(row.connectedAccountId) : undefined;
    return {
      kind: "occupied",
      id: row.id,
      slotNumber: row.slotNumber,
      platform: row.platform,
      status: row.status,
      displayLabel: row.displayLabel,
      brandName: row.brandId ? brandsById.get(row.brandId) ?? null : null,
      launchKitId: row.accountLaunchKitId,
      account: account
        ? {
            id: account.id,
            username: account.username,
            displayName: account.displayName,
            avatarUrl: account.avatarUrl,
            followerCount: account.followerCount,
            lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
          }
        : null,
    };
  };

  const active = slotRows.filter((r) => r.archivedAt === null).map(toOccupied);
  const archived = slotRows.filter((r) => r.archivedAt !== null).map(toOccupied);

  const { usage, unavailable } = await resolveUsage(
    context.workspaceId,
    active.length,
    archived.length,
    active.filter((s) => s.status === "connected").length,
  );

  // Archived numbers included: the allocator does not reuse them, so the
  // empty-tile previews must not either.
  const usedNumbers = slotRows.map((r) => r.slotNumber);

  const slottedAccountIds = new Set(
    slotRows.map((r) => r.connectedAccountId).filter((id): id is string => id !== null),
  );

  return {
    usage,
    grid: buildSlotGrid(active, usedNumbers, usage.slotLimit),
    archived,
    unslotted: accountRows
      .filter((a) => !slottedAccountIds.has(a.id))
      .map((a) => ({
        id: a.id,
        platform: a.platform,
        username: a.username,
        displayName: a.displayName,
        health: a.health,
      })),
    usageUnavailable: unavailable,
  };
}
