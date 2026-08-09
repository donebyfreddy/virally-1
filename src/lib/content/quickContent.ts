"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  activityEvents,
  contentItems,
  contentVariants,
  jobs,
  mediaAssets,
  scriptSegments,
  scripts,
  shots,
  storyboards,
} from "@/lib/db/schema.fragment";
import { getLanguageProvider } from "@/lib/ai/registry";
import { sanitiseExternalText } from "@/lib/ai/types";
import { deriveName } from "./naming";
import {
  findQuickContentType,
  findQuickPlatform,
  isQuickContentPlanSnapshot,
  QUICK_QUALITY,
  toneLabelFor,
  VALID_QUICK_MODES,
  VALID_QUICK_RATIOS,
  type QuickActionResult,
  type QuickContentAssetCounts,
  type QuickContentInput,
  type QuickContentPlan,
  type QuickContentPlanRow,
} from "./quickContentTypes";
import { estimateBatch } from "@/lib/creative/estimator";
import { DEFAULT_PRODUCTION_MODE } from "@/lib/creative/modes";
import { tenantScope } from "@/lib/creative/scope";
import type { ProductionMode } from "@/lib/creative/types";
import { startGeneration } from "@/lib/generation/service";
import {
  InsufficientCreditsError,
  releaseReservation,
  reserveCredits,
  setReservationExpectedRuns,
} from "@/lib/creative/credits";
import type { AspectRatio, Platform } from "@/types/database";
import { isFalConfigured } from "@/lib/creative/env";
import { isContentReadyToRender } from "@/lib/creative/contentRender";
import { enqueueJob } from "@/lib/jobs/queue";

/**
 * Quick Content: one content item, created directly, with no campaign.
 *
 * `/app/create` previously had one path, and it always ran the campaign
 * pipeline — `concepts × hooksPerConcept × languages × platforms × ratios`,
 * which is the right arithmetic for a batch and the wrong one for "make me one
 * reel". This module is the other path: it builds exactly one content item,
 * with `campaign_id` left null, through the SAME language provider, the SAME
 * estimator, and the SAME `startGeneration` entry point every other surface
 * generates through — see `src/lib/generation/service.ts`. There is no second
 * generation engine here, only a second way to arrive at one content item.
 *
 * Split into two actions, mirroring the campaign composer's staged gates:
 * `planQuickContent` runs the language provider only (brief, one concept, one
 * hook, one script, one storyboard) and persists the result — cheap and
 * unbilled, the same as the campaign flow's `plan` gate. `generateQuickContent`
 * is the paid step: it reads the plan back and submits one real generation per
 * shot, one for voiceover and one for music, each through `startGeneration`,
 * which reserves credits and enqueues a job exactly as the studios do.
 *
 * This file exports ONLY the two async actions below. A `"use server"` module
 * may not export a plain value or a synchronous function — Next.js strips
 * anything that is not an action from the client bundle, which turns a
 * constant or a helper imported from here into a runtime "does not exist"
 * error rather than a type error. The option vocabulary, input/output types
 * and pure lookups that used to live here are in `./quickContentTypes`.
 */

// --- Authorisation --------------------------------------------------------------

type Gate =
  | { ok: true; context: Awaited<ReturnType<typeof resolveTenantContext>> extends infer R
      ? R extends { status: "ok"; context: infer C }
        ? C
        : never
      : never }
  | { ok: false; error: string };

async function authoriseQuickContent(): Promise<Gate> {
  const session = await readSession();
  if (session.status !== "authenticated") {
    return { ok: false, error: "Sign in to create content." };
  }
  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") {
    return { ok: false, error: "This workspace is not ready yet." };
  }
  if (!can(resolution.context.role, "content.create")) {
    return { ok: false, error: "Your role does not include creating content." };
  }
  return { ok: true, context: resolution.context };
}

// --- Plan -----------------------------------------------------------------------

/**
 * Plans one content item: brief, one concept, one hook, one script, one
 * storyboard. Persists all of it and returns the numbers the confirmation
 * screen shows. Nothing here calls a media provider or spends a credit.
 */
export async function planQuickContent(
  input: QuickContentInput,
): Promise<QuickActionResult<QuickContentPlan>> {
  const gate = await authoriseQuickContent();
  if (!gate.ok) return gate;
  const { context } = gate;

  const prompt = input.prompt.trim();
  if (prompt.length < 10) {
    return { ok: false, error: "Describe what you want to create in at least ten characters." };
  }

  const contentTypeDef = findQuickContentType(input.contentTypeId);
  const platformDef = findQuickPlatform(input.platformId);
  const ratio = input.ratio ?? platformDef.ratio;
  if (!VALID_QUICK_RATIOS.has(ratio)) return { ok: false, error: "Choose a valid format." };

  const mode: ProductionMode = VALID_QUICK_MODES.has(input.productionMode)
    ? input.productionMode
    : DEFAULT_PRODUCTION_MODE;

  const durationSeconds = contentTypeDef.hasDuration
    ? Math.min(120, Math.max(5, Math.trunc(input.durationSeconds ?? 30)))
    : null;

  // Single-language by design. Multiple languages are what makes several
  // scripts out of one idea, which is a campaign decision, not a quick one.
  const language = "en";
  const safePrompt = sanitiseExternalText(prompt, 2000);

  const provider = getLanguageProvider();

  const briefResult = await provider.buildBrief({
    prompt: safePrompt,
    brandName: context.brands.find((brand) => brand.id === context.brandId)?.name ?? null,
    audience: null,
    tone: toneLabelFor(input.tone),
    objective: null,
    language,
  });
  if (!briefResult.ok) return { ok: false, error: briefResult.failure.message };

  // Exactly one concept, exactly one hook. Quick Content is not "brainstorm
  // alternatives" — that is what Campaign mode's concept count is for.
  const conceptsResult = await provider.generateConcepts(briefResult.value, {
    count: 1,
    hooksPerConcept: 1,
    language,
  });
  if (!conceptsResult.ok) return { ok: false, error: conceptsResult.failure.message };
  const concept = conceptsResult.value[0];
  if (!concept) return { ok: false, error: "Could not derive a concept from that brief." };
  const hook = concept.hooks[0]?.text ?? concept.title;

  const scriptResult = await provider.generateScript(concept, {
    hook,
    durationSeconds: durationSeconds ?? 20,
    language,
  });
  if (!scriptResult.ok) return { ok: false, error: scriptResult.failure.message };

  const storyboardResult = await provider.generateStoryboard(scriptResult.value);
  if (!storyboardResult.ok) return { ok: false, error: storyboardResult.failure.message };

  const isMock = briefResult.meta.origin === "mock";
  const origin = isMock ? ("mock" as const) : ("provider" as const);

  // Forced to one item and one format, regardless of what the campaign
  // arithmetic would compute for the same mode — this is the fix for the
  // multiplication bug: `contentItems` and `variants` are 1 by construction,
  // not by coincidence of the inputs. `platformsForCount` is never persisted;
  // it exists only so `computeCounts`' `variants = items × platforms × ratios`
  // multiplies by 1 rather than by 0 when the chosen platform has no Platform
  // enum value (LinkedIn, X, generic) to pass.
  const platformsForCount: readonly Platform[] = platformDef.dbPlatform
    ? [platformDef.dbPlatform]
    : ["instagram"];

  const estimate = estimateBatch({
    mode,
    concepts: 1,
    hooksPerConcept: 1,
    platforms: platformsForCount,
    ratios: [ratio],
    languages: [language],
    accountCount: 0,
    withVoiceover: input.withVoiceover,
    withThumbnail: false,
    withMusic: input.withMusic,
    durationSeconds: durationSeconds ?? 5,
    quality: QUICK_QUALITY,
  });

  const assets: QuickContentAssetCounts = {
    generatedImages: estimate.work.generatedImages,
    aiVideoClips: estimate.work.aiVideoClips,
    voiceovers: estimate.work.voiceovers,
    musicTracks: estimate.work.musicTracks,
    compositions: estimate.work.renders,
  };

  const structure: QuickContentPlanRow[] = [];
  let cursorMs = 0;
  for (const segment of scriptResult.value.segments) {
    structure.push({
      position: structure.length,
      role: segment.role,
      text: segment.text,
      startMs: cursorMs,
      endMs: cursorMs + segment.durationMs,
    });
    cursorMs += segment.durationMs;
  }

  const title = concept.title || deriveName(prompt);

  const plan: Omit<QuickContentPlan, "contentId"> = {
    title,
    hook,
    contentTypeLabel: contentTypeDef.label,
    ratio,
    durationSeconds,
    structure,
    assets,
    estimatedCredits: estimate.credits,
    isMock,
  };

  // --- persist ------------------------------------------------------------

  const [item] = await db
    .insert(contentItems)
    .values({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      brandId: context.brandId,
      campaignId: null,
      conceptId: null,
      hookId: null,
      title,
      contentType: contentTypeDef.contentType,
      language,
      durationMs: durationSeconds !== null ? durationSeconds * 1000 : null,
      tone: input.tone,
      productionMode: mode,
      origin,
      generationPlan: plan,
      generationStatus: "planned",
      estimatedCredits: estimate.credits,
      createdBy: context.user.id,
    })
    .returning({ id: contentItems.id });

  if (!item) return { ok: false, error: "Could not save the content item." };

  const [scriptRow] = await db
    .insert(scripts)
    .values({
      workspaceId: context.workspaceId,
      contentItemId: item.id,
      version: 1,
      isCurrent: true,
      fullText: scriptResult.value.fullText,
      wordCount: scriptResult.value.fullText.split(/\s+/).filter(Boolean).length,
      origin,
      createdBy: context.user.id,
    })
    .returning({ id: scripts.id });

  if (scriptRow) {
    await db.insert(scriptSegments).values(
      structure.map((row) => ({
        scriptId: scriptRow.id,
        position: row.position,
        role: row.role as "hook" | "body" | "cta" | "outro",
        text: row.text,
        startMs: row.startMs,
        endMs: row.endMs,
      })),
    );
  }

  const [storyboardRow] = await db
    .insert(storyboards)
    .values({
      workspaceId: context.workspaceId,
      contentItemId: item.id,
      version: 1,
      isCurrent: true,
      origin,
    })
    .returning({ id: storyboards.id });

  if (storyboardRow) {
    const segmentRows = scriptRow
      ? await db
          .select({ id: scriptSegments.id, position: scriptSegments.position })
          .from(scriptSegments)
          .where(eq(scriptSegments.scriptId, scriptRow.id))
      : [];
    const segmentIdByPosition = new Map(segmentRows.map((row) => [row.position, row.id]));

    await db.insert(shots).values(
      storyboardResult.value.shots.map((shot, index) => ({
        storyboardId: storyboardRow.id,
        scriptSegmentId: segmentIdByPosition.get(index) ?? null,
        position: index,
        description: shot.description,
        visualPrompt: shot.visualPrompt,
        camera: shot.camera,
        durationMs: shot.durationMs,
        origin,
      })),
    );
  }

  if (platformDef.dbPlatform) {
    await db.insert(contentVariants).values({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      contentItemId: item.id,
      platform: platformDef.dbPlatform,
      aspectRatio: ratio,
      language,
      status: "draft",
      origin,
    });
  }

  await db.insert(activityEvents).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    kind: "content.created",
    subjectType: "content_item",
    subjectId: item.id,
    summary: `Planned "${title}" as standalone content`,
  });

  return { ok: true, data: { ...plan, contentId: item.id } };
}

// --- Generate ---------------------------------------------------------------

export type QuickContentGenerateOutcome = {
  contentId: string;
  jobsStarted: number;
  isMock: boolean;
  /**
   * Reasons any individual asset was refused. Successful starts are preserved
   * and the content is moved to a visible failed state when the batch cannot
   * be completed, so the caller can offer a targeted retry on the same item.
   */
  errors: readonly string[];
};

/**
 * The paid step. Re-reads the plan `planQuickContent` persisted — never the
 * client's copy of it — and submits one real generation per shot, plus
 * voiceover and music if requested, through `startGeneration`. The complete
 * estimate is reserved once before any provider work begins; every job links
 * to that batch hold so completed runs settle it exactly once.
 */
export async function generateQuickContent(
  contentId: string,
): Promise<QuickActionResult<QuickContentGenerateOutcome>> {
  const gate = await authoriseQuickContent();
  if (!gate.ok) return gate;
  const { context } = gate;
  const scope = tenantScope(context.organizationId, context.workspaceId);

  const [item] = await db
    .select({
      id: contentItems.id,
      contentType: contentItems.contentType,
      productionMode: contentItems.productionMode,
      generationPlan: contentItems.generationPlan,
      generationStatus: contentItems.generationStatus,
    })
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
  if (
    item.generationStatus &&
    item.generationStatus !== "planned"
  ) {
    return { ok: false, error: "Generation has already started for this content item." };
  }

  const plan = isQuickContentPlanSnapshot(item.generationPlan) ? item.generationPlan : null;
  if (!plan) {
    return { ok: false, error: "No plan found for this item. Generate a plan first." };
  }

  const mode: ProductionMode = VALID_QUICK_MODES.has(item.productionMode as ProductionMode)
    ? (item.productionMode as ProductionMode)
    : DEFAULT_PRODUCTION_MODE;

  const [storyboardRow] = await db
    .select({ id: storyboards.id })
    .from(storyboards)
    .where(and(eq(storyboards.contentItemId, contentId), eq(storyboards.isCurrent, true)))
    .limit(1);
  if (!storyboardRow) return { ok: false, error: "No storyboard found. Generate a plan first." };

  const shotRows = await db
    .select({
      id: shots.id,
      position: shots.position,
      visualPrompt: shots.visualPrompt,
      description: shots.description,
      durationMs: shots.durationMs,
    })
    .from(shots)
    .where(eq(shots.storyboardId, storyboardRow.id))
    .orderBy(asc(shots.position));

  const [variantRow] = await db
    .select({ aspectRatio: contentVariants.aspectRatio })
    .from(contentVariants)
    .where(eq(contentVariants.contentItemId, contentId))
    .limit(1);
  const ratio: AspectRatio = variantRow?.aspectRatio ?? plan.ratio ?? "9:16";

  const [scriptRow] = await db
    .select({ id: scripts.id, fullText: scripts.fullText })
    .from(scripts)
    .where(and(eq(scripts.contentItemId, contentId), eq(scripts.isCurrent, true)))
    .limit(1);

  const isVideoContentType = item.contentType === "short_video" || item.contentType === "long_video";
  if (shotRows.length === 0) {
    return { ok: false, error: "The storyboard has no shots. Edit the plan before generating." };
  }
  if (plan.assets.voiceovers > 0 && !scriptRow?.fullText?.trim()) {
    return { ok: false, error: "The script is empty. Generate a valid script before production." };
  }

  // The mode-typical video count decides how many of the REAL shots become a
  // video generation rather than a still — the same split the estimate was
  // built from, applied to the storyboard that actually exists rather than to
  // a formula. Every shot still gets exactly one asset; nothing here
  // multiplies a shot into several.
  const videoCount = isVideoContentType ? Math.min(plan.assets.aiVideoClips, shotRows.length) : 0;
  const requiredProvider = isFalConfigured() ? "fal" : null;
  const expectedJobCount =
    shotRows.length +
    (plan.assets.voiceovers > 0 ? 1 : 0) +
    (plan.assets.musicTracks > 0 ? 1 : 0);

  const claimed = await db
    .update(contentItems)
    .set({
      generationStatus: "queued",
      generationStartedAt: new Date(),
      generationCompletedAt: null,
      generationErrorCode: null,
      generationErrorMessage: null,
      generationErrorStage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentItems.id, contentId),
        eq(contentItems.workspaceId, context.workspaceId),
        or(isNull(contentItems.generationStatus), eq(contentItems.generationStatus, "planned")),
      ),
    )
    .returning({ id: contentItems.id });
  if (claimed.length === 0) {
    return { ok: false, error: "Generation has already started for this content item." };
  }

  let reservationId: string;
  try {
    const reservation = await reserveCredits({
      scope,
      idempotencyKey: `quick-content:${contentId}:initial`,
      credits: Math.max(1, plan.estimatedCredits),
      purpose: "single_generation",
      createdBy: context.user.id,
      expectedRunCount: expectedJobCount,
    });
    reservationId = reservation.id;
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      await db
        .update(contentItems)
        .set({ generationStatus: "planned", generationStartedAt: null, updatedAt: new Date() })
        .where(and(eq(contentItems.id, contentId), eq(contentItems.workspaceId, context.workspaceId)));
      return {
        ok: false,
        error: `Not enough Production Credits. Required: ${error.required}. Available: ${error.available}.`,
      };
    }
    await db
      .update(contentItems)
      .set({ generationStatus: "planned", generationStartedAt: null, updatedAt: new Date() })
      .where(and(eq(contentItems.id, contentId), eq(contentItems.workspaceId, context.workspaceId)));
    throw error;
  }

  let jobsStarted = 0;
  let sawMock = false;
  const errors: string[] = [];

  for (const [index, shot] of shotRows.entries()) {
    const capability = index < videoCount ? "text-to-video" : "text-to-image";
    const prompt = shot.visualPrompt || shot.description || plan.hook;

    const outcome = await startGeneration(scope, {
      capability,
      prompt,
      mode,
      quality: QUICK_QUALITY,
      ratio,
      durationSeconds: shot.durationMs ? Math.max(1, Math.round(shot.durationMs / 1000)) : undefined,
      contentItemId: contentId,
      // Without this, a completed generation has no way back to which shot it
      // fills — `attachCompletedAssets` only calls `attachAssetToShot` when a
      // `shotId` rode along on the job payload (see jobs/generation.ts).
      shotId: shot.id,
      campaignId: null,
      createdBy: context.user.id,
      allowMockFallback: false,
      reservationId,
      idempotencyKey: `quick-content:${contentId}:shot:${shot.id}:attempt:1`,
      preferredProviderId: requiredProvider,
      requirePreferredProvider: requiredProvider !== null,
    });

    if (outcome.status === "started") {
      jobsStarted += 1;
      if (outcome.isMock) sawMock = true;
    } else if (outcome.status === "refused") {
      errors.push(outcome.reason);
    }
  }

  if (plan.assets.voiceovers > 0 && scriptRow?.fullText) {
    const outcome = await startGeneration(scope, {
      capability: "audio",
      prompt: scriptRow.fullText,
      mode,
      quality: QUICK_QUALITY,
      durationSeconds: plan.durationSeconds ?? 20,
      contentItemId: contentId,
      campaignId: null,
      createdBy: context.user.id,
      allowMockFallback: false,
      reservationId,
      idempotencyKey: `quick-content:${contentId}:voice:attempt:1`,
      preferredProviderId: requiredProvider,
      requirePreferredProvider: requiredProvider !== null,
    });
    if (outcome.status === "started") {
      jobsStarted += 1;
      if (outcome.isMock) sawMock = true;
    } else if (outcome.status === "refused") {
      errors.push(outcome.reason);
    }
  }

  if (plan.assets.musicTracks > 0) {
    const outcome = await startGeneration(scope, {
      capability: "music",
      prompt: `Instrumental background music for: ${plan.title}`,
      mode,
      quality: QUICK_QUALITY,
      durationSeconds: plan.durationSeconds ?? 20,
      contentItemId: contentId,
      campaignId: null,
      createdBy: context.user.id,
      allowMockFallback: false,
      reservationId,
      idempotencyKey: `quick-content:${contentId}:music:attempt:1`,
      preferredProviderId: requiredProvider,
      requirePreferredProvider: requiredProvider !== null,
    });
    if (outcome.status === "started") {
      jobsStarted += 1;
      if (outcome.isMock) sawMock = true;
    } else if (outcome.status === "refused") {
      errors.push(outcome.reason);
    }
  }

  if (jobsStarted === 0) {
    await releaseReservation(scope, reservationId, "No provider job could be started.");
  } else {
    await setReservationExpectedRuns(scope, reservationId, jobsStarted);
    if (!sawMock) {
      await Promise.all([
        db
          .update(contentItems)
          .set({ origin: "provider", updatedAt: new Date() })
          .where(and(eq(contentItems.id, contentId), eq(contentItems.workspaceId, context.workspaceId))),
        db
          .update(contentVariants)
          .set({ origin: "provider", updatedAt: new Date() })
          .where(eq(contentVariants.contentItemId, contentId)),
      ]);
    }
  }

  if (errors.length > 0 || jobsStarted === 0) {
    await db
      .update(contentItems)
      .set({
        generationStatus: "failed",
        generationErrorCode:
          jobsStarted === 0 ? "PROVIDER_UNAVAILABLE" : "PARTIAL_SUBMISSION_FAILED",
        generationErrorMessage: errors[0] ?? "No generation job could be started.",
        generationErrorStage: "asset_generation",
        generationCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(contentItems.id, contentId), eq(contentItems.workspaceId, context.workspaceId)));
  }

  await db.insert(activityEvents).values({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    kind: "content.generation_started",
    subjectType: "content_item",
    subjectId: contentId,
    summary: `Started generation for "${plan.title}" (${jobsStarted} job${jobsStarted === 1 ? "" : "s"}${errors.length > 0 ? `, ${errors.length} failed to start` : ""})`,
  });

  revalidatePath(`/app/content/${contentId}`);
  revalidatePath("/app/content");

  return { ok: true, data: { contentId, jobsStarted, isMock: sawMock, errors } };
}

/**
 * Retries only missing or failed production work for an existing item.
 * Completed shots and audio assets are read from storage-backed rows and are
 * never submitted again. Attempt-numbered idempotency keys keep history while
 * making a double click converge on the same retry.
 */
export async function retryQuickContentGeneration(
  contentId: string,
): Promise<QuickActionResult<{ contentId: string; jobsStarted: number }>> {
  const gate = await authoriseQuickContent();
  if (!gate.ok) return gate;
  const { context } = gate;
  const scope = tenantScope(context.organizationId, context.workspaceId);

  const [item] = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      contentType: contentItems.contentType,
      productionMode: contentItems.productionMode,
      generationPlan: contentItems.generationPlan,
      generationStatus: contentItems.generationStatus,
    })
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
  if (item.generationStatus !== "failed") {
    return { ok: false, error: "Only a failed generation can be retried." };
  }

  const activeRows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, context.workspaceId),
        sql`${jobs.payload}->>'contentItemId' = ${contentId}`,
        sql`${jobs.status} in ('pending', 'queued', 'running', 'waiting_external')`,
      ),
    )
    .limit(1);
  if (activeRows.length > 0) {
    return { ok: false, error: "The remaining generation jobs are still running." };
  }

  const plan = isQuickContentPlanSnapshot(item.generationPlan) ? item.generationPlan : null;
  if (!plan) return { ok: false, error: "No saved generation plan is available." };

  if (await isContentReadyToRender(scope, contentId)) {
    const renderAttempts = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, context.workspaceId),
          eq(jobs.type, "content.render"),
          sql`${jobs.payload}->>'contentItemId' = ${contentId}`,
        ),
      );
    const attempt = renderAttempts.length + 1;
    const result = await enqueueJob({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      userId: context.user.id,
      type: "content.render",
      payload: { contentItemId: contentId },
      idempotencyKey: `content.render:${contentId}:attempt:${attempt}`,
      priority: 3,
    });
    await setContentQueued(contentId, context.workspaceId);
    revalidatePath(`/app/content/${contentId}`);
    return { ok: true, data: { contentId, jobsStarted: result.created ? 1 : 0 } };
  }

  const [storyboard] = await db
    .select({ id: storyboards.id })
    .from(storyboards)
    .where(and(eq(storyboards.contentItemId, contentId), eq(storyboards.isCurrent, true)))
    .limit(1);
  if (!storyboard) return { ok: false, error: "No storyboard is available for retry." };

  const missingShots = await db
    .select({
      id: shots.id,
      position: shots.position,
      prompt: shots.visualPrompt,
      description: shots.description,
      durationMs: shots.durationMs,
    })
    .from(shots)
    .where(and(eq(shots.storyboardId, storyboard.id), isNull(shots.assetId)))
    .orderBy(asc(shots.position));

  const existingAssets = await db
    .select({ kind: mediaAssets.kind })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.contentItemId, contentId), isNull(mediaAssets.deletedAt)));
  const presentKinds = new Set(existingAssets.map((asset) => asset.kind));
  const [variant] = await db
    .select({ aspectRatio: contentVariants.aspectRatio })
    .from(contentVariants)
    .where(eq(contentVariants.contentItemId, contentId))
    .limit(1);
  const [script] = await db
    .select({ fullText: scripts.fullText })
    .from(scripts)
    .where(and(eq(scripts.contentItemId, contentId), eq(scripts.isCurrent, true)))
    .limit(1);

  const mode: ProductionMode = VALID_QUICK_MODES.has(item.productionMode as ProductionMode)
    ? (item.productionMode as ProductionMode)
    : DEFAULT_PRODUCTION_MODE;
  const requiredProvider = isFalConfigured() ? "fal" : null;
  const videoCount =
    item.contentType === "short_video" || item.contentType === "long_video"
      ? plan.assets.aiVideoClips
      : 0;
  let jobsStarted = 0;
  const errors: string[] = [];

  for (const shot of missingShots) {
    const previous = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, context.workspaceId),
          sql`${jobs.payload}->>'contentItemId' = ${contentId}`,
          sql`${jobs.payload}->>'shotId' = ${shot.id}`,
        ),
      );
    const attempt = previous.length + 1;
    const outcome = await startGeneration(scope, {
      capability: shot.position < videoCount ? "text-to-video" : "text-to-image",
      prompt: shot.prompt || shot.description || plan.hook,
      mode,
      quality: QUICK_QUALITY,
      ratio: variant?.aspectRatio ?? plan.ratio,
      durationSeconds: shot.durationMs ? Math.max(1, Math.round(shot.durationMs / 1000)) : undefined,
      contentItemId: contentId,
      shotId: shot.id,
      createdBy: context.user.id,
      idempotencyKey: `quick-content:${contentId}:shot:${shot.id}:attempt:${attempt}`,
      preferredProviderId: requiredProvider,
      requirePreferredProvider: requiredProvider !== null,
      allowMockFallback: false,
    });
    if (outcome.status === "started") jobsStarted += 1;
    else if (outcome.status === "refused") errors.push(outcome.reason);
  }

  const audioRequests = [
    plan.assets.voiceovers > 0 && !presentKinds.has("voiceover") && script?.fullText
      ? { capability: "audio" as const, prompt: script.fullText, key: "voice" }
      : null,
    plan.assets.musicTracks > 0 && !presentKinds.has("music")
      ? { capability: "music" as const, prompt: `Instrumental background music for: ${item.title}`, key: "music" }
      : null,
  ].filter((request): request is NonNullable<typeof request> => request !== null);

  for (const request of audioRequests) {
    const previous = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, context.workspaceId),
          sql`${jobs.payload}->>'contentItemId' = ${contentId}`,
          sql`${jobs.payload}->>'capability' = ${request.capability}`,
        ),
      );
    const attempt = previous.length + 1;
    const outcome = await startGeneration(scope, {
      capability: request.capability,
      prompt: request.prompt,
      mode,
      quality: QUICK_QUALITY,
      durationSeconds: plan.durationSeconds ?? 20,
      contentItemId: contentId,
      createdBy: context.user.id,
      idempotencyKey: `quick-content:${contentId}:${request.key}:attempt:${attempt}`,
      preferredProviderId: requiredProvider,
      requirePreferredProvider: requiredProvider !== null,
      allowMockFallback: false,
    });
    if (outcome.status === "started") jobsStarted += 1;
    else if (outcome.status === "refused") errors.push(outcome.reason);
  }

  if (jobsStarted === 0) {
    return { ok: false, error: errors[0] ?? "There is no failed step available to retry." };
  }

  await Promise.all([
    db
      .update(contentItems)
      .set({ origin: "provider", updatedAt: new Date() })
      .where(and(eq(contentItems.id, contentId), eq(contentItems.workspaceId, context.workspaceId))),
    db
      .update(contentVariants)
      .set({ origin: "provider", updatedAt: new Date() })
      .where(eq(contentVariants.contentItemId, contentId)),
  ]);
  await setContentQueued(contentId, context.workspaceId);
  revalidatePath(`/app/content/${contentId}`);
  return { ok: true, data: { contentId, jobsStarted } };
}

async function setContentQueued(contentId: string, workspaceId: string): Promise<void> {
  await db
    .update(contentItems)
    .set({
      generationStatus: "queued",
      generationErrorCode: null,
      generationErrorMessage: null,
      generationErrorStage: null,
      generationCompletedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(contentItems.id, contentId), eq(contentItems.workspaceId, workspaceId)));
}
