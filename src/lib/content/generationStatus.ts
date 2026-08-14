import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentItems, contentVariants, jobs, mediaAssets, shots, storyboards } from "@/lib/db/schema.fragment";
import { providerRuns } from "@/lib/db/schema.creative";
import type { TenantScope } from "@/lib/creative/scope";
import type { ContentGenerationStatus, GenerationJobView } from "@/components/content/ContentGenerationState";

/**
 * The generation-progress view for one content item: everything the "not
 * ready yet" screen and its polling endpoint need, computed identically by
 * both.
 *
 * Factored out of `/app/content/[contentId]`'s page component so that page
 * and `GET /api/content/[contentId]/generation-status` (the lightweight
 * endpoint the client polls while generation is active — see
 * `ContentGenerationState`) can never quietly diverge on what "queued" or
 * "generating" means. Divergence there is exactly how a status endpoint ends
 * up telling the user something the full page reload would have contradicted.
 */
export type GenerationStatusView = {
  status: ContentGenerationStatus;
  startedAt: string | null;
  elapsedSeconds: number;
  estimatedCredits: number;
  completedVisuals: number;
  totalVisuals: number;
  voiceRequired: boolean;
  voiceComplete: boolean;
  musicRequired: boolean;
  musicComplete: boolean;
  jobs: readonly GenerationJobView[];
  error: { code: string | null; message: string | null; stage: string | null };
};

export async function loadGenerationStatusView(
  scope: TenantScope,
  contentId: string,
): Promise<GenerationStatusView | null> {
  const [item] = await db
    .select({
      generationStatus: contentItems.generationStatus,
      generationErrorCode: contentItems.generationErrorCode,
      generationErrorMessage: contentItems.generationErrorMessage,
      generationErrorStage: contentItems.generationErrorStage,
      generationStartedAt: contentItems.generationStartedAt,
      generationElapsedSeconds: sql<number>`case
        when ${contentItems.generationStartedAt} is null then 0
        else greatest(0, extract(epoch from (now() - ${contentItems.generationStartedAt}))::int)
      end`,
      estimatedCredits: contentItems.estimatedCredits,
      generationPlan: contentItems.generationPlan,
    })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.id, contentId),
        eq(contentItems.workspaceId, scope.workspaceId),
        isNull(contentItems.deletedAt),
      ),
    )
    .limit(1);
  if (!item) return null;

  const [variants, assets, jobRows, runRows, storyboardRow] = await Promise.all([
    db
      .select({ renderedAssetId: contentVariants.renderedAssetId })
      .from(contentVariants)
      .where(eq(contentVariants.contentItemId, contentId)),
    db
      .select({ kind: mediaAssets.kind })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.contentItemId, contentId), isNull(mediaAssets.deletedAt))),
    db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        progress: jobs.progress,
        provider: jobs.provider,
        failureCode: jobs.failureCode,
        failureMessage: jobs.failureMessage,
        payload: jobs.payload,
      })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, scope.workspaceId), sql`${jobs.payload}->>'contentItemId' = ${contentId}`))
      .orderBy(asc(jobs.createdAt)),
    db
      .select({
        jobId: providerRuns.jobId,
        provider: providerRuns.providerId,
        model: providerRuns.model,
        capability: providerRuns.capability,
        failureCode: providerRuns.failureCode,
        failureMessage: providerRuns.failureMessage,
      })
      .from(providerRuns)
      .innerJoin(jobs, eq(providerRuns.jobId, jobs.id))
      .where(
        and(
          eq(providerRuns.workspaceId, scope.workspaceId),
          sql`${jobs.payload}->>'contentItemId' = ${contentId}`,
        ),
      )
      .orderBy(asc(providerRuns.createdAt)),
    db
      .select({ id: storyboards.id })
      .from(storyboards)
      .where(and(eq(storyboards.contentItemId, contentId), eq(storyboards.isCurrent, true)))
      .limit(1),
  ]);

  const shotRows = storyboardRow[0]
    ? await db
        .select({ assetId: shots.assetId })
        .from(shots)
        .where(eq(shots.storyboardId, storyboardRow[0].id))
    : [];

  const runByJob = new Map(runRows.filter((run) => run.jobId).map((run) => [run.jobId, run]));
  const assetKinds = new Set(assets.map((asset) => asset.kind));
  const required = requiredAssets(item.generationPlan);
  const hasRenderedOutput = variants.some(
    (variant) => variant.renderedAssetId !== null && assetKinds.has("export"),
  );
  const hasActiveRender = jobRows.some(
    (job) => job.type === "content.render" && ["pending", "queued", "running", "waiting_external"].includes(job.status),
  );
  const hasActiveGeneration = jobRows.some((job) =>
    ["pending", "queued", "running", "waiting_external"].includes(job.status),
  );
  const hasFailedGeneration = jobRows.some((job) => ["failed", "dead_letter", "cancelled"].includes(job.status));

  const status: ContentGenerationStatus =
    (item.generationStatus as ContentGenerationStatus | null) ??
    (hasRenderedOutput
      ? "ready"
      : hasActiveRender
        ? "rendering"
        : hasActiveGeneration
          ? "generating"
          : hasFailedGeneration
            ? "failed"
            : item.generationPlan
              ? "planned"
              : "ready");

  return {
    status,
    startedAt: item.generationStartedAt?.toISOString() ?? null,
    elapsedSeconds: item.generationElapsedSeconds,
    estimatedCredits: item.estimatedCredits,
    completedVisuals: shotRows.filter((shot) => shot.assetId !== null).length,
    totalVisuals: shotRows.length,
    voiceRequired: required.voice,
    voiceComplete: assetKinds.has("voiceover"),
    musicRequired: required.music,
    musicComplete: assetKinds.has("music"),
    jobs: jobRows.map((job) => {
      const run = runByJob.get(job.id);
      return {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        provider: run?.provider ?? job.provider ?? readPayloadString(job.payload, "preferredProviderId"),
        model: run?.model === "pending" ? null : (run?.model ?? readPayloadString(job.payload, "modelId")),
        capability: run?.capability ?? readPayloadString(job.payload, "capability"),
        failureCode: run?.failureCode ?? job.failureCode,
        failureMessage: run?.failureMessage ?? job.failureMessage,
      };
    }),
    error: {
      code: item.generationErrorCode,
      message: item.generationErrorMessage,
      stage: item.generationErrorStage,
    },
  };
}

function requiredAssets(plan: unknown): { voice: boolean; music: boolean } {
  if (typeof plan !== "object" || plan === null) return { voice: false, music: false };
  const assets = (plan as { assets?: unknown }).assets;
  if (typeof assets !== "object" || assets === null) return { voice: false, music: false };
  const values = assets as { voiceovers?: unknown; musicTracks?: unknown };
  return {
    voice: typeof values.voiceovers === "number" && values.voiceovers > 0,
    music: typeof values.musicTracks === "number" && values.musicTracks > 0,
  };
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}
