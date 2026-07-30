"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import type { Platform } from "@/types/database";
import { db } from "@/lib/db";
import { accountSlots } from "@/lib/db/schema";
import { accountLaunchKits, activityEvents } from "@/lib/db/schema.fragment";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { getLanguageProvider, isMockOnly } from "@/lib/ai/registry";
import { sanitiseExternalText } from "@/lib/ai/types";
import { claimAccountSlot, SlotLimitError } from "./claim";

/**
 * ACCOUNT SLOT ACTIONS.
 *
 * The ordering in `prepareLaunchKit` is the load-bearing decision in this
 * file, so it is stated once here: the slot is claimed BEFORE generation
 * runs.
 *
 * Generating first and claiming afterwards reads more efficient — no
 * capacity is spent if the model fails — but it means a user can pay for a
 * full generation and then be told there was no room for it, which is the
 * one outcome worth designing against. Claiming first makes capacity the
 * first thing checked, and a slot left in `planning` by a failed generation
 * is a state the product already has a name for and a way out of (resume it,
 * or archive it).
 */

const VALID_PLATFORMS = new Set<Platform>(["instagram", "tiktok", "youtube", "facebook"]);

function field(formData: FormData, name: string, max = 400): string {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function optionalField(formData: FormData, name: string, max = 400): string | null {
  const value = field(formData, name, max);
  return value.length > 0 ? value : null;
}

export async function prepareLaunchKit(formData: FormData): Promise<void> {
  const session = await readSession();
  if (session.status !== "authenticated") redirect("/auth/sign-in");

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");
  const { context } = resolution;

  // Claiming capacity is an accounts decision, not a content one.
  if (!can(context.role, "accounts.connect")) {
    redirect("/app/accounts?error=permission");
  }

  const platformRaw = field(formData, "platform", 40);
  if (!VALID_PLATFORMS.has(platformRaw as Platform)) {
    redirect("/app/accounts/launch?error=platform");
  }
  const platform = platformRaw as Platform;

  const niche = field(formData, "niche", 200);
  if (niche.length < 3) redirect("/app/accounts/launch?error=niche");

  const brandId = optionalField(formData, "brandId", 40) ?? context.brandId;
  const label = optionalField(formData, "displayLabel", 120);

  // --- claim capacity first -------------------------------------------------
  let slot: { slotId: string; slotNumber: number };
  try {
    slot = await claimAccountSlot({
      workspaceId: context.workspaceId,
      platform,
      brandId,
      displayLabel: label,
      createdBy: context.user.id,
    });
  } catch (error) {
    // Capacity and permission are different problems with different
    // remedies, and the UI says something different for each. Branching on
    // the error type rather than the message so copy changes upstream cannot
    // silently reroute this.
    if (error instanceof SlotLimitError) redirect("/app/accounts?error=limit");
    redirect("/app/accounts?error=claim");
  }

  // --- generate the material ------------------------------------------------
  const provider = getLanguageProvider();
  const origin = isMockOnly() ? ("mock" as const) : ("provider" as const);

  const result = await provider.generateLaunchKit({
    platform,
    brandName: context.brands.find((b) => b.id === brandId)?.name ?? null,
    // First-party input, but it may have been pasted from an imported page,
    // so it takes the same path as external text before reaching a model.
    niche: sanitiseExternalText(niche, 200),
    language: optionalField(formData, "language", 20) ?? "en",
    region: optionalField(formData, "region", 80),
    audience: optionalField(formData, "audience", 400),
    objective: optionalField(formData, "objective", 400),
    contentStyle: optionalField(formData, "contentStyle", 200),
    postingFrequency: optionalField(formData, "postingFrequency", 80),
  });

  if (!result.ok) {
    // The slot stays in `planning` with the reason recorded. It is not
    // released: silently handing capacity back would make a transient
    // provider failure look like the user's form was discarded.
    await db
      .update(accountSlots)
      .set({ internalNotes: `Launch kit generation failed: ${result.failure.message}` })
      .where(eq(accountSlots.id, slot.slotId));

    revalidatePath("/app/accounts");
    redirect("/app/accounts?error=generation");
  }

  const kit = result.value;

  const [inserted] = await db
    .insert(accountLaunchKits)
    .values({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      brandId,
      targetPlatform: platform,
      concept: niche,
      suggestedNames: kit.accountNames,
      suggestedUsernames: kit.usernameCandidates,
      bio: kit.bio,
      profileDescription: kit.profileDescription,
      brandVoice: kit.brandVoice,
      audience: kit.audience,
      contentPillars: kit.contentPillars,
      initialHooks: kit.hooks,
      firstPosts: kit.firstPosts,
      manualChecklist: kit.setupChecklist,
      targetAudience: optionalField(formData, "audience", 400),
      primaryLanguage: optionalField(formData, "language", 20) ?? "en",
      region: optionalField(formData, "region", 80),
      objective: optionalField(formData, "objective", 400),
      visualDirection: kit.profileImageConcept,
      postingFrequency: optionalField(formData, "postingFrequency", 80),
      status: "ready",
      origin,
      createdBy: context.user.id,
    })
    .returning({ id: accountLaunchKits.id });

  if (!inserted) {
    await db
      .update(accountSlots)
      .set({ internalNotes: "Launch kit could not be saved." })
      .where(eq(accountSlots.id, slot.slotId));
    revalidatePath("/app/accounts");
    redirect("/app/accounts?error=save");
  }

  await db
    .update(accountSlots)
    .set({ accountLaunchKitId: inserted.id, status: "launch_kit_ready" })
    .where(eq(accountSlots.id, slot.slotId));

  await db.insert(activityEvents).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    kind: "account_slot.launch_kit_prepared",
    subjectType: "account_slot",
    subjectId: slot.slotId,
    // Says "prepared", not "created". Nothing exists on any platform at this point.
    summary: `Prepared a ${platform} launch kit in slot ${slot.slotNumber}`,
  });

  revalidatePath("/app/accounts");
  redirect(`/app/accounts?prepared=${slot.slotNumber}`);
}

/**
 * Records that the USER says they registered the account.
 *
 * Moves the slot to `awaiting_connection` and nothing further. It
 * deliberately does not set `connected` and does not create a
 * `connected_accounts` row: only a real OAuth callback may do that.
 */
export async function markAccountRegistered(formData: FormData): Promise<void> {
  const session = await readSession();
  if (session.status !== "authenticated") redirect("/auth/sign-in");

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");
  const { context } = resolution;

  if (!can(context.role, "accounts.connect")) redirect("/app/accounts?error=permission");

  const slotId = field(formData, "slotId", 40);
  if (!slotId) redirect("/app/accounts");

  const [slot] = await db
    .select({
      id: accountSlots.id,
      slotNumber: accountSlots.slotNumber,
      accountLaunchKitId: accountSlots.accountLaunchKitId,
      status: accountSlots.status,
    })
    .from(accountSlots)
    .where(and(eq(accountSlots.id, slotId), eq(accountSlots.workspaceId, context.workspaceId)))
    .limit(1);

  if (!slot) redirect("/app/accounts");

  await db
    .update(accountSlots)
    .set({ status: "awaiting_connection" })
    .where(and(eq(accountSlots.id, slot.id), eq(accountSlots.workspaceId, context.workspaceId)));

  if (slot.accountLaunchKitId) {
    await db
      .update(accountLaunchKits)
      .set({ status: "account_created" })
      .where(
        and(
          eq(accountLaunchKits.id, slot.accountLaunchKitId),
          eq(accountLaunchKits.workspaceId, context.workspaceId),
        ),
      );
  }

  await db.insert(activityEvents).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    kind: "account_slot.marked_registered",
    subjectType: "account_slot",
    subjectId: slot.id,
    summary: `User reported registering the account for slot ${slot.slotNumber}`,
  });

  revalidatePath("/app/accounts");
  redirect("/app/accounts");
}

/**
 * Releases a slot's capacity.
 *
 * Archives rather than deletes: the launch kit, and any content already
 * planned against the slot, stay readable. Requires accounts.disconnect, the
 * same permission as removing an account.
 */
export async function archiveAccountSlot(formData: FormData): Promise<void> {
  const session = await readSession();
  if (session.status !== "authenticated") redirect("/auth/sign-in");

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");
  const { context } = resolution;

  if (!can(context.role, "accounts.disconnect")) redirect("/app/accounts?error=permission");

  const slotId = field(formData, "slotId", 40);
  if (!slotId) redirect("/app/accounts");

  const [slot] = await db
    .select({
      id: accountSlots.id,
      slotNumber: accountSlots.slotNumber,
      status: accountSlots.status,
      connectedAccountId: accountSlots.connectedAccountId,
    })
    .from(accountSlots)
    .where(and(eq(accountSlots.id, slotId), eq(accountSlots.workspaceId, context.workspaceId)))
    .limit(1);

  if (!slot) redirect("/app/accounts");

  // A slot with a live authorisation must be disconnected first. Archiving
  // it here would leave a connected account with no slot representing it —
  // publishable and invisible, the exact state `unslotted` in data.ts exists
  // to report.
  if (slot.connectedAccountId) {
    redirect("/app/accounts?error=connected");
  }

  await db
    .update(accountSlots)
    .set({ status: "archived", archivedAt: new Date() })
    .where(and(eq(accountSlots.id, slot.id), eq(accountSlots.workspaceId, context.workspaceId)));

  await db.insert(activityEvents).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    kind: "account_slot.archived",
    subjectType: "account_slot",
    subjectId: slot.id,
    summary: `Archived slot ${slot.slotNumber}, releasing its capacity`,
  });

  revalidatePath("/app/accounts");
  redirect("/app/accounts");
}
