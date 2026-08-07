"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  activityEvents,
  contentItems,
  contentVariants,
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
import type { AspectRatio, Platform } from "@/types/database";

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
   * Reasons any individual asset was refused. Non-fatal by design: the shots
   * before a refused one already started and reserved real credits, so an
   * early `ok: false` would hide successful work behind an error that reads
   * as "nothing happened." The caller always has a `contentId` to show
   * whatever did start; this is what it shows alongside it.
   */
  errors: readonly string[];
};

/**
 * The paid step. Re-reads the plan `planQuickContent` persisted — never the
 * client's copy of it — and submits one real generation per shot, plus
 * voiceover and music if requested, through `startGeneration`. Each call
 * reserves its own credits and enqueues its own job; this function does not
 * reserve anything itself; there is nothing durable to reserve beyond what
 * each generation already withholds.
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

  // The mode-typical video count decides how many of the REAL shots become a
  // video generation rather than a still — the same split the estimate was
  // built from, applied to the storyboard that actually exists rather than to
  // a formula. Every shot still gets exactly one asset; nothing here
  // multiplies a shot into several.
  const videoCount = isVideoContentType ? Math.min(plan.assets.aiVideoClips, shotRows.length) : 0;

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
      campaignId: null,
      createdBy: context.user.id,
      allowMockFallback: false,
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
    });
    if (outcome.status === "started") {
      jobsStarted += 1;
      if (outcome.isMock) sawMock = true;
    } else if (outcome.status === "refused") {
      errors.push(outcome.reason);
    }
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
