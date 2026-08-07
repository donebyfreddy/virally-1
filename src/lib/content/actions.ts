"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import type { AspectRatio, Platform } from "@/types/database";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  campaignBriefs,
  campaignStages,
  campaigns,
  contentConcepts,
  contentHooks,
  contentItems,
  generationRuns,
  activityEvents,
} from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { getLanguageProvider, isMockOnly } from "@/lib/ai/registry";
import { sanitiseExternalText } from "@/lib/ai/types";
import {
  DEFAULT_LENGTH_DAYS,
  GOAL_OPTIONS,
  LENGTH_OPTIONS,
  TONE_OPTIONS,
} from "@/content/create";
import {
  estimateCost,
  requiresConfirmation,
  validatePlanRequest,
  type PlanRequest,
  type Quality,
} from "./plan";
import { estimateBatch, creditsForGate, type GenerationGateId } from "@/lib/creative/estimator";
import { DEFAULT_PRODUCTION_MODE } from "@/lib/creative/modes";
import type { ProductionMode } from "@/lib/creative/types";
import { isAnyProviderConfigured } from "@/lib/creative/env";
import { InsufficientCreditsError, reserveCredits } from "@/lib/creative/credits";
import { tenantScope } from "@/lib/creative/scope";
import { deriveName } from "./naming";

/**
 * Campaign creation.
 *
 * The request is re-validated and re-costed server-side from the submitted fields. The
 * client's numbers are never trusted: they arrive in a form body and could be anything,
 * and the confirmation gate for an expensive batch is only meaningful if the server
 * decides whether the gate applied.
 *
 * Only the `plan` stage runs here. Scripts, storyboards and renders are enqueued jobs,
 * because a request handler is not a render queue — the brief is explicit about not
 * pretending otherwise.
 */

const VALID_PLATFORMS = new Set<Platform>(["instagram", "tiktok", "youtube", "facebook"]);
const VALID_RATIOS = new Set<AspectRatio>(["9:16", "4:5", "1:1", "16:9", "4:3", "3:2", "custom"]);
const VALID_QUALITY = new Set<Quality>(["draft", "standard", "high"]);
const VALID_PRODUCTION_MODES = new Set<ProductionMode>(["fast", "hybrid", "cinematic"]);
const VALID_GATES = new Set<GenerationGateId>([
  "plan",
  "scripts",
  "storyboards",
  "preview",
  "media",
  "render",
]);

// Allow-lists for the three campaign-shape controls. Validated against the same
// option sets the composer renders, so a hand-crafted form body cannot write an
// arbitrary string into the campaign's objective or the brief's tone.
const VALID_TONES = new Set(TONE_OPTIONS.map((option) => option.id));
const VALID_GOALS = new Set(GOAL_OPTIONS.map((option) => option.id));
const VALID_LENGTH_DAYS = new Set(LENGTH_OPTIONS.map((option) => option.days));

/**
 * Renders a campaign's date range from a length in days.
 *
 * Starts today. `endsOn` is inclusive, hence `days - 1`: a 7-day campaign
 * starting Monday ends the following Sunday, not the Monday after.
 *
 * Both are `date` columns (no time component), so they are formatted as
 * calendar dates rather than passed as `Date` objects — a timestamp would be
 * interpreted in the server's zone and could land on the previous day.
 */
function dateRangeFor(days: number): { startsOn: string; endsOn: string } {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return { startsOn: toDateOnly(start), endsOn: toDateOnly(end) };
}

function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The model is prompted with the human-readable label, not the stored id.
 *
 * "product_awareness" is a database value; "Product awareness" is what the
 * option actually means, and sending the snake_case id would have the model
 * infer the intent from an identifier.
 */
function toneLabel(id: string): string {
  return TONE_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

function goalLabel(id: string): string {
  return GOAL_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseInt10(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export async function createCampaign(formData: FormData): Promise<void> {
  const session = await readSession();
  if (session.status !== "authenticated") redirect("/auth/sign-in");

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  const { context } = resolution;

  // Server-side permission check. The composer is hidden from a role that cannot
  // create, but hiding a form is not authorisation.
  if (!can(context.role, "content.create")) {
    redirect("/app?error=permission");
  }

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (prompt.length < 10) redirect("/app/create?error=prompt");

  // A brief typed by the user is first-party input, but it may have been pasted from
  // an imported page, so it goes through the same sanitiser before reaching a model.
  const safePrompt = sanitiseExternalText(prompt, 4000);

  const request: PlanRequest = {
    concepts: parseInt10(String(formData.get("concepts") ?? ""), 3),
    hooksPerConcept: parseInt10(String(formData.get("hooksPerConcept") ?? ""), 2),
    platforms: parseList(String(formData.get("platforms") ?? "")).filter((value): value is Platform =>
      VALID_PLATFORMS.has(value as Platform),
    ),
    ratios: parseList(String(formData.get("ratios") ?? "")).filter((value): value is AspectRatio =>
      VALID_RATIOS.has(value as AspectRatio),
    ),
    languages: parseList(String(formData.get("languages") ?? "en")).slice(0, 20),
    accountCount: 0,
    withVoiceover: String(formData.get("withVoiceover") ?? "") === "true",
    withThumbnail: String(formData.get("withThumbnail") ?? "") === "true",
    durationSeconds: parseInt10(String(formData.get("durationSeconds") ?? ""), 20),
    quality: VALID_QUALITY.has(String(formData.get("quality") ?? "") as Quality)
      ? (String(formData.get("quality")) as Quality)
      : "standard",
  };

  // The three campaign-shape controls. Each falls back to its default rather
  // than rejecting the submission: an unrecognised value here is a stale client
  // or a crafted body, and losing the user's brief over it would be the worse
  // outcome. The plan request itself is still validated strictly below.
  const rawTone = String(formData.get("tone") ?? "");
  const tone = VALID_TONES.has(rawTone) ? rawTone : null;

  const rawGoal = String(formData.get("goal") ?? "");
  const objective = VALID_GOALS.has(rawGoal) ? rawGoal : null;

  const rawLengthDays = parseInt10(String(formData.get("lengthDays") ?? ""), DEFAULT_LENGTH_DAYS);
  const lengthDays = VALID_LENGTH_DAYS.has(rawLengthDays) ? rawLengthDays : DEFAULT_LENGTH_DAYS;
  const { startsOn, endsOn } = dateRangeFor(lengthDays);

  const errors = validatePlanRequest(request);
  if (errors.length > 0) redirect("/app/create?error=invalid");

  const estimate = estimateCost(request);
  const stage = String(formData.get("stage") ?? "plan");

  // Falls back to the cheapest mode rather than rejecting. An unrecognised value
  // is a stale client or a crafted body, and defaulting UP would charge someone
  // for Cinematic because their browser was out of date.
  const rawMode = String(formData.get("productionMode") ?? "");
  const productionMode: ProductionMode = VALID_PRODUCTION_MODES.has(rawMode as ProductionMode)
    ? (rawMode as ProductionMode)
    : DEFAULT_PRODUCTION_MODE;

  /**
   * The estimate is recomputed here from the submitted request.
   *
   * `quotedCredits` from the client is used ONLY as a cross-check. Trusting it
   * would let a crafted body reserve one credit for a thousand-video batch, and
   * the reservation is the only thing standing between a user and an unbounded
   * provider bill.
   */
  const modeEstimate = estimateBatch({
    concepts: request.concepts,
    hooksPerConcept: request.hooksPerConcept,
    platforms: request.platforms,
    ratios: request.ratios,
    languages: request.languages,
    accountCount: request.accountCount,
    withVoiceover: request.withVoiceover,
    withThumbnail: request.withThumbnail,
    withMusic: String(formData.get("withMusic") ?? "") === "true",
    durationSeconds: request.durationSeconds,
    quality: request.quality,
    mode: productionMode,
  });

  // The confirmation gate, re-decided here. A client that omitted the checkbox cannot
  // start an expensive batch by simply not rendering it.
  if (stage === "render" && requiresConfirmation(estimate.counts)) {
    if (String(formData.get("confirmed") ?? "") !== "on") {
      redirect("/app/create?error=unconfirmed");
    }
  }

  const language = request.languages[0] ?? "en";

  // --- persist the campaign -------------------------------------------------
  const [campaign] = await db
    .insert(campaigns)
    .values({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      brandId: context.brandId,
      name: deriveName(prompt),
      objective,
      mode: "campaign",
      status: "draft",
      startsOn,
      endsOn,
      // Copied to mutable arrays: the generated Insert types are mutable, and the
      // PlanRequest fields are readonly by design so a validator cannot mutate them.
      languages: [...request.languages],
      platforms: [...request.platforms],
      estimatedCostCents: estimate.totalCents,
      createdBy: context.user.id,
    })
    .returning({ id: campaigns.id });

  if (!campaign) {
    redirect("/app/create?error=save");
  }

  /**
   * Reserve the credits this gate will spend.
   *
   * Placed after the campaign row so a shortfall has something to attribute the
   * failure to, and so the user's brief survives — losing a typed brief to a
   * billing error is the worse outcome.
   *
   * Skipped entirely when no provider is configured: the batch will run on the
   * deterministic mock, which bills nothing, and holding real credits against
   * free work would be taking something for nothing.
   *
   * Only the CHOSEN gate is reserved, not the whole pipeline. Reserving the full
   * batch cost for a "plan only" run would withhold credits for work the user
   * explicitly declined to start.
   */
  if (isAnyProviderConfigured()) {
    const gate = (VALID_GATES.has(stage as GenerationGateId) ? stage : "plan") as GenerationGateId;
    const credits = creditsForGate(modeEstimate, gate);

    if (credits > 0) {
      try {
        await reserveCredits({
          scope: tenantScope(context.organizationId, context.workspaceId),
          // Keyed on the campaign, so a double-submitted form reserves once.
          idempotencyKey: `campaign:${campaign.id}:${gate}`,
          credits,
          purpose: "campaign_batch",
          campaignId: campaign.id,
          createdBy: context.user.id,
        });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          // The campaign is kept as a draft. Nothing was generated and nothing
          // was charged, so the user can lower the batch and try again without
          // retyping the brief.
          redirect(`/app/campaigns/${campaign.id}?error=credits`);
        }
        throw error;
      }
    }
  }

  await db.insert(campaignBriefs).values({
    campaignId: campaign.id,
    workspaceId: context.workspaceId,
    version: 1,
    rawPrompt: prompt,
    sourceKind: "prompt",
    tone,
    // The sanitiser ran, so downstream generation may proceed. A stage that finds
    // this false must refuse rather than assume it was handled upstream.
    externalTextSanitised: true,
    createdBy: context.user.id,
  });

  // Every stage of the campaign, so the pipeline visual reads real state from row one.
  await db.insert(campaignStages).values(
    (
      [
        "brief",
        "concepts",
        "scripts",
        "storyboards",
        "assets",
        "editing",
        "approval",
        "schedule",
        "publish",
        "learn",
      ] as const
    ).map((name) => ({
      campaignId: campaign.id,
      workspaceId: context.workspaceId,
      stage: name,
      state:
        name === "brief" ? ("complete" as const) : name === "concepts" ? ("active" as const) : ("pending" as const),
      startedAt: name === "brief" ? new Date() : null,
      completedAt: name === "brief" ? new Date() : null,
    })),
  );

  // --- generate the plan ----------------------------------------------------
  // Only the plan. It is cheap, synchronous and reviewable; everything downstream is
  // a queued job.
  const provider = getLanguageProvider();
  const origin = isMockOnly() ? ("mock" as const) : ("provider" as const);

  // Tone and objective are passed through, not just persisted: a control that is
  // stored but never reaches the model would change the record without changing
  // the output, which is the same as not working.
  const briefResult = await provider.buildBrief({
    prompt: safePrompt,
    brandName: context.brands.find((brand) => brand.id === context.brandId)?.name ?? null,
    audience: null,
    tone: tone ? toneLabel(tone) : null,
    objective: objective ? goalLabel(objective) : null,
    language,
  });

  if (!briefResult.ok) {
    // The campaign row survives so the user does not lose their brief; the stage is
    // marked blocked with the real reason.
    await db
      .update(campaignStages)
      .set({ state: "blocked", blockedReason: briefResult.failure.message })
      .where(and(eq(campaignStages.campaignId, campaign.id), eq(campaignStages.stage, "concepts")));
    redirect(`/app/campaigns/${campaign.id}`);
  }

  const conceptsResult = await provider.generateConcepts(briefResult.value, {
    count: request.concepts,
    hooksPerConcept: request.hooksPerConcept,
    language,
  });

  if (!conceptsResult.ok) {
    await db
      .update(campaignStages)
      .set({ state: "blocked", blockedReason: conceptsResult.failure.message })
      .where(and(eq(campaignStages.campaignId, campaign.id), eq(campaignStages.stage, "concepts")));
    redirect(`/app/campaigns/${campaign.id}`);
  }

  // Recorded before the concepts, so provenance exists even if the inserts fail.
  await db.insert(generationRuns).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    campaignId: campaign.id,
    stage: "concepts",
    provider: conceptsResult.meta.id,
    providerModel: conceptsResult.meta.model,
    promptVersion: conceptsResult.meta.promptVersion,
    status: "completed",
    origin,
    durationMs: conceptsResult.meta.durationMs,
    costCents: conceptsResult.meta.costCents ?? 0,
    costIncurred: (conceptsResult.meta.costCents ?? 0) > 0,
    startedAt: new Date(Date.now() - conceptsResult.meta.durationMs),
    completedAt: new Date(),
  });

  for (const [index, concept] of conceptsResult.value.entries()) {
    const [inserted] = await db
      .insert(contentConcepts)
      .values({
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        campaignId: campaign.id,
        position: index,
        title: concept.title,
        angle: concept.angle,
        summary: concept.summary,
        status: "draft",
        origin,
        createdBy: context.user.id,
      })
      .returning({ id: contentConcepts.id });

    if (!inserted) continue;

    await db.insert(contentHooks).values(
      concept.hooks.map((hook, hookIndex) => ({
        workspaceId: context.workspaceId,
        conceptId: inserted.id,
        label: hook.label,
        text: hook.text,
        position: hookIndex,
        origin,
      })),
    );
  }

  await db
    .update(campaigns)
    .set({ conceptsCount: conceptsResult.value.length })
    .where(eq(campaigns.id, campaign.id));

  await db
    .update(campaignStages)
    .set({ state: "complete", completedAt: new Date() })
    .where(and(eq(campaignStages.campaignId, campaign.id), eq(campaignStages.stage, "concepts")));

  await db.insert(activityEvents).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    kind: "campaign.created",
    subjectType: "campaign",
    subjectId: campaign.id,
    summary: `Created campaign with ${conceptsResult.value.length} concepts`,
  });

  revalidatePath("/app", "layout");
  redirect(`/app/campaigns/${campaign.id}`);
}

export type AddToCampaignResult = { ok: true; campaignName: string } | { ok: false; error: string };

/**
 * Attaches a standalone content item to an existing campaign.
 *
 * Sets `campaign_id` on the row that already exists — it does not duplicate
 * the item, does not re-run generation, and does not touch anything already
 * generated for it. The brief's "Add to campaign" is exactly this: an
 * association, not a copy.
 *
 * Refuses when the item already belongs to a different campaign rather than
 * silently moving it — a content item switching campaigns is a decision a
 * user should make explicitly from the campaign it is leaving, not a side
 * effect of adding it somewhere else.
 */
export async function addContentToCampaign(
  contentId: string,
  campaignId: string,
): Promise<AddToCampaignResult> {
  const session = await readSession();
  if (session.status !== "authenticated") return { ok: false, error: "Sign in to continue." };

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") return { ok: false, error: "This workspace is not ready yet." };
  const { context } = resolution;

  if (!can(context.role, "content.create")) {
    return { ok: false, error: "Your role does not include editing content." };
  }

  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.workspaceId, context.workspaceId),
        isNull(campaigns.deletedAt),
      ),
    )
    .limit(1);
  if (!campaign) return { ok: false, error: "That campaign is not available in this workspace." };

  const [item] = await db
    .select({ id: contentItems.id, campaignId: contentItems.campaignId })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.id, contentId),
        eq(contentItems.workspaceId, context.workspaceId),
        isNull(contentItems.deletedAt),
      ),
    )
    .limit(1);
  if (!item) return { ok: false, error: "That content item is not available in this workspace." };
  if (item.campaignId && item.campaignId !== campaignId) {
    return { ok: false, error: "This item already belongs to a different campaign." };
  }

  await db
    .update(contentItems)
    .set({ campaignId, updatedAt: new Date() })
    .where(eq(contentItems.id, contentId));

  await db.insert(activityEvents).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    kind: "content.added_to_campaign",
    subjectType: "content_item",
    subjectId: contentId,
    summary: `Added to campaign "${campaign.name}"`,
  });

  revalidatePath(`/app/content/${contentId}`);
  revalidatePath(`/app/campaigns/${campaign.id}`);

  return { ok: true, campaignName: campaign.name };
}
