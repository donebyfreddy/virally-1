import { sql, count, eq, and, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountSlots, workspaces } from "@/lib/db/schema";
import { workspaceAccountSlotLimit, ForbiddenError } from "@/lib/db/authorization";
import type { Platform } from "@/types/database";
import { SLOT_LIMIT_SQLSTATE } from "./slots";

/**
 * Ports `public.claim_account_slot` from
 * supabase/migrations/0015_account_slots.sql: atomically allocates the
 * lowest free slot number in a workspace.
 *
 * The advisory lock is what makes this safe under concurrent claims — without
 * it, two concurrent inserts could both count 9 against a limit of 10 and
 * both commit, because neither can see the other's uncommitted row. Taken
 * inside a transaction (`pg_advisory_xact_lock`), so it releases automatically
 * on commit or rollback with no cleanup path to forget.
 *
 * Unlike the original SQL function (SECURITY INVOKER, relying on
 * account_slots' RLS policy to check `accounts.connect`), the permission
 * check here is the caller's job — see src/lib/db/authorization.ts's
 * `assertWorkspacePermission`. Call that BEFORE this function; it does not
 * check permissions itself.
 */
export class SlotLimitError extends Error {
  code = SLOT_LIMIT_SQLSTATE;
  constructor(limit: number) {
    super(`Account slot limit reached: workspace holds ${limit} of ${limit} active slots.`);
    this.name = "SlotLimitError";
  }
}

export async function claimAccountSlot(params: {
  workspaceId: string;
  platform: Platform;
  brandId?: string | null;
  displayLabel?: string | null;
  createdBy: string;
}): Promise<{ slotId: string; slotNumber: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"virally:account_slots:" + params.workspaceId}, 0))`,
    );

    const [workspace] = await tx
      .select({ id: workspaces.id, organizationId: workspaces.organizationId })
      .from(workspaces)
      .where(and(eq(workspaces.id, params.workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!workspace) {
      throw new ForbiddenError(`Workspace ${params.workspaceId} is not available.`);
    }

    const existing = await tx
      .select({ slotNumber: accountSlots.slotNumber })
      .from(accountSlots)
      .where(eq(accountSlots.workspaceId, params.workspaceId));

    // Lowest positive integer not already taken. Archived rows are included
    // in `existing` (no archivedAt filter) — their numbers stay theirs so
    // historical references keep meaning the same slot.
    const taken = new Set(existing.map((r) => r.slotNumber));
    let nextNumber = 1;
    while (taken.has(nextNumber)) nextNumber += 1;

    const [slot] = await tx
      .insert(accountSlots)
      .values({
        organizationId: workspace.organizationId,
        workspaceId: params.workspaceId,
        slotNumber: nextNumber,
        platform: params.platform,
        status: "planning",
        brandId: params.brandId ?? null,
        displayLabel: params.displayLabel ?? null,
        createdBy: params.createdBy,
      })
      .returning({ id: accountSlots.id, slotNumber: accountSlots.slotNumber });

    // Limit check runs AFTER the insert, same ordering as the original
    // AFTER-trigger: a caller without permission must see a permission error
    // before ever learning whether the workspace is full (see 0015's
    // rationale — checking the limit first both mis-attributes the error and
    // leaks occupancy to a non-member).
    const limit = await workspaceAccountSlotLimit(params.workspaceId, tx as unknown as typeof db);
    const [{ value: activeCount }] = await tx
      .select({ value: count() })
      .from(accountSlots)
      .where(and(eq(accountSlots.workspaceId, params.workspaceId), isNull(accountSlots.archivedAt)));

    if (activeCount > limit) {
      throw new SlotLimitError(limit);
    }

    return { slotId: slot!.id, slotNumber: slot!.slotNumber };
  });
}
