import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentVariants, mediaAssets } from "@/lib/db/schema.fragment";
import { buildCompositionForContentItem } from "@/lib/creative/contentRender";
import { CompositionInvalidError, renderComposition, RenderNotAvailableError } from "@/lib/creative/render";
import { tenantScope } from "@/lib/creative/scope";
import { getStorageAdapter } from "@/lib/storage";
import type { StorageBucket } from "@/lib/storage/types";
import { completeJob, failJob, type ClaimedJob } from "./queue";

/**
 * The render job handler — enqueued by `enqueueRenderIfReady` in
 * jobs/generation.ts once every asset a content item's plan called for has
 * arrived. This is the step that turns those separate assets into the single
 * playable file the content detail page shows.
 *
 * Unlike `handleGenerationJob`, this never parks and re-polls: Remotion's
 * `renderMedia` runs to completion (or throws) in one call, so one invocation
 * either finishes the render or fails it. A render that outlives the worker's
 * own budget is a job the next `runQueueOnce` picks back up from the start,
 * not from where it left off — there is no partial-render state to resume.
 */

export type RenderJobPayload = { contentItemId?: string };

export type RenderHandlerResult =
  | { outcome: "completed" }
  | { outcome: "failed"; reason: string };

export async function handleRenderJob(job: ClaimedJob): Promise<RenderHandlerResult> {
  const payload = job.payload as RenderJobPayload;
  const scope = tenantScope(job.organizationId, job.workspaceId);

  if (!payload.contentItemId) {
    const reason = "Render job payload has no contentItemId.";
    await failJob(
      job.id,
      { code: "invalid_payload", message: reason, retryable: false },
      { attempts: job.maxAttempts, maxAttempts: job.maxAttempts },
    );
    return { outcome: "failed", reason };
  }
  const contentItemId = payload.contentItemId;

  let tmpDir: string | null = null;
  try {
    const { composition, assets } = await buildCompositionForContentItem(scope, contentItemId);

    const storage = getStorageAdapter();
    const assetUrls: Record<string, string> = {};
    for (const asset of assets) {
      // An hour comfortably outlives any render this codebase produces —
      // short-form reels — with room to spare if the worker is briefly queued
      // behind other jobs before Chromium actually fetches the asset.
      assetUrls[asset.id] = await storage.getSignedUrl(asset.bucket as StorageBucket, asset.storagePath, 3600);
    }

    tmpDir = await mkdtemp(join(tmpdir(), "virally-render-"));
    const outputPath = join(tmpDir, `${randomUUID()}.mp4`);

    const result = await renderComposition({ composition, assetUrls, outputPath });

    const bytes = await readFile(outputPath);
    const key = `${scope.workspaceId}/${contentItemId}/${randomUUID()}.mp4`;
    await storage.putObject({ bucket: "exports", key, body: bytes, contentType: "video/mp4" });

    const [renderedAsset] = await db
      .insert(mediaAssets)
      .values({
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        contentItemId,
        // Distinct from `generated_video` (a per-shot clip): this is the
        // finished, composed output, not an ingredient — the same distinction
        // `assetKindFor` draws for voiceover vs. music applies here too.
        kind: "export",
        bucket: "exports",
        storagePath: key,
        mimeType: "video/mp4",
        byteSize: bytes.byteLength,
        durationMs: Math.round((result.durationFrames / composition.fps) * 1000),
        width: result.width,
        height: result.height,
        origin: "provider",
        uploadState: "uploaded",
        scanState: "skipped",
      })
      .returning({ id: mediaAssets.id });

    if (!renderedAsset) throw new Error("Failed to record the rendered export as a media asset.");

    // Every variant of this content item points at the same finished file —
    // Quick Content creates exactly one variant today, but a future multi-
    // platform variant set should not each need its own render.
    await db
      .update(contentVariants)
      .set({ renderedAssetId: renderedAsset.id, updatedAt: new Date() })
      .where(eq(contentVariants.contentItemId, contentItemId));

    await completeJob(job.id, { mediaAssetId: renderedAsset.id });
    return { outcome: "completed" };
  } catch (error) {
    const retryable = !(error instanceof RenderNotAvailableError || error instanceof CompositionInvalidError);
    const message = error instanceof Error ? error.message : "The render failed for an unknown reason.";
    await failJob(
      job.id,
      { code: "render_failed", message, retryable },
      { attempts: job.attempts, maxAttempts: job.maxAttempts },
    );
    return { outcome: "failed", reason: message };
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
}
