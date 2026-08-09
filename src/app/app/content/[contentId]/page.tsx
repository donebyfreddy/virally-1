import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import {
  campaigns,
  contentItems,
  contentVariants,
  jobs,
  mediaAssets,
  scripts,
  scriptSegments,
  shots,
  storyboards,
} from "@/lib/db/schema.fragment";
import { providerRuns } from "@/lib/db/schema.creative";
import { AppPage } from "@/components/app-ui/AppPage";
import { EditorShell } from "@/components/editor/EditorShell";
import { CONTENT_TYPE_LABELS } from "@/content/content-library";
import { getStorageAdapter } from "@/lib/storage";
import type { StorageBucket } from "@/lib/storage/types";
import {
  ContentGenerationState,
  type ContentGenerationStatus,
} from "@/components/content/ContentGenerationState";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contentId: string }>;
}): Promise<Metadata> {
  const { contentId } = await params;
  const session = await readSession();
  if (session.status !== "authenticated") return { title: "Content" };

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") return { title: "Content" };

  const [row] = await db
    .select({ title: contentItems.title })
    .from(contentItems)
    .where(
      and(
        eq(contentItems.id, contentId),
        eq(contentItems.workspaceId, resolution.context.workspaceId),
      ),
    )
    .limit(1);

  return {
    title: row?.title ?? "Content",
    robots: { index: false, follow: false },
  };
}

/**
 * Content detail — the editing suite.
 *
 * The page is a server component that loads the item, its variants, its script
 * and its assets; `EditorShell` is the client boundary that owns panel and
 * variant selection. Splitting it that way keeps the queries on the server and
 * ships only the interaction code, rather than making the whole editor a client
 * component and pulling the data-fetching into it.
 *
 * No `PageHeader` and no breadcrumb of its own: the editor's command strip owns
 * both, because on this surface the title, the review state and the campaign it
 * belongs to are one control row rather than a page heading and a footer link.
 */
export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;

  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor(`/app/content/${contentId}`));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;

  // Workspace-scoped, so a valid uuid from another tenant does not load.
  const [item] = await db
    .select({
      id: contentItems.id,
      title: contentItems.title,
      contentType: contentItems.contentType,
      language: contentItems.language,
      status: contentItems.status,
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
      caption: contentItems.caption,
      callToAction: contentItems.callToAction,
      durationMs: contentItems.durationMs,
      origin: contentItems.origin,
      revision: contentItems.revision,
      updatedAt: contentItems.updatedAt,
      campaignId: contentItems.campaignId,
      campaignName: campaigns.name,
    })
    .from(contentItems)
    .leftJoin(campaigns, eq(contentItems.campaignId, campaigns.id))
    .where(
      and(
        eq(contentItems.id, contentId),
        eq(contentItems.workspaceId, context.workspaceId),
        isNull(contentItems.deletedAt),
      ),
    )
    .limit(1);

  if (!item) notFound();

  const [variants, scriptRows, assets, availableCampaigns] = await Promise.all([
    db
      .select({
        id: contentVariants.id,
        platform: contentVariants.platform,
        aspectRatio: contentVariants.aspectRatio,
        width: contentVariants.width,
        height: contentVariants.height,
        language: contentVariants.language,
        status: contentVariants.status,
        captionOverride: contentVariants.captionOverride,
        renderedAssetId: contentVariants.renderedAssetId,
        thumbnailAssetId: contentVariants.thumbnailAssetId,
      })
      .from(contentVariants)
      .where(eq(contentVariants.contentItemId, contentId))
      .orderBy(asc(contentVariants.platform)),

    db
      .select({
        id: scripts.id,
        segmentIndex: scriptSegments.position,
        text: scriptSegments.text,
        startMs: scriptSegments.startMs,
        endMs: scriptSegments.endMs,
        role: scriptSegments.role,
      })
      .from(scripts)
      .leftJoin(scriptSegments, eq(scriptSegments.scriptId, scripts.id))
      // Only the current version. Without this a re-scripted item shows every
      // historical segment interleaved by position.
      .where(and(eq(scripts.contentItemId, contentId), eq(scripts.isCurrent, true)))
      .orderBy(asc(scriptSegments.position)),

    db
      .select({
        id: mediaAssets.id,
        kind: mediaAssets.kind,
        filename: mediaAssets.filename,
        durationMs: mediaAssets.durationMs,
        width: mediaAssets.width,
        height: mediaAssets.height,
        byteSize: mediaAssets.byteSize,
        origin: mediaAssets.origin,
        uploadState: mediaAssets.uploadState,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.contentItemId, contentId),
          isNull(mediaAssets.deletedAt),
        ),
      )
      .orderBy(asc(mediaAssets.createdAt)),

    // Only fetched for standalone content — an item that already belongs to a
    // campaign has nowhere to put "Add to campaign", so there is nothing for
    // this list to feed.
    item.campaignId
      ? Promise.resolve([])
      : db
          .select({ id: campaigns.id, name: campaigns.name })
          .from(campaigns)
          .where(and(eq(campaigns.workspaceId, context.workspaceId), isNull(campaigns.deletedAt)))
          .orderBy(desc(campaigns.updatedAt))
          .limit(50),
  ]);

  const [jobRows, runRows, storyboardRow] = await Promise.all([
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
      .where(
        and(
          eq(jobs.workspaceId, context.workspaceId),
          sql`${jobs.payload}->>'contentItemId' = ${contentId}`,
        ),
      )
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
          eq(providerRuns.workspaceId, context.workspaceId),
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
    (job) =>
      job.type === "content.render" &&
      ["pending", "queued", "running", "waiting_external"].includes(job.status),
  );
  const hasActiveGeneration = jobRows.some((job) =>
    ["pending", "queued", "running", "waiting_external"].includes(job.status),
  );
  const hasFailedGeneration = jobRows.some((job) =>
    ["failed", "dead_letter", "cancelled"].includes(job.status),
  );
  const generationStatus: ContentGenerationStatus =
    item.generationStatus ??
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

  if (generationStatus !== "ready") {
    return (
      <AppPage width="full">
        <ContentGenerationState
          contentId={contentId}
          title={item.title ?? "Untitled item"}
          status={generationStatus}
          startedAt={item.generationStartedAt?.toISOString() ?? null}
          initialElapsedSeconds={item.generationElapsedSeconds}
          estimatedCredits={item.estimatedCredits}
          completedVisuals={shotRows.filter((shot) => shot.assetId !== null).length}
          totalVisuals={shotRows.length}
          voiceRequired={required.voice}
          voiceComplete={assetKinds.has("voiceover")}
          musicRequired={required.music}
          musicComplete={assetKinds.has("music")}
          jobs={jobRows.map((job) => {
            const run = runByJob.get(job.id);
            return {
              id: job.id,
              type: job.type,
              status: job.status,
              progress: job.progress,
              provider:
                run?.provider ?? job.provider ?? readPayloadString(job.payload, "preferredProviderId"),
              model:
                run?.model === "pending"
                  ? null
                  : (run?.model ?? readPayloadString(job.payload, "modelId")),
              capability:
                run?.capability ??
                readPayloadString(job.payload, "capability"),
              failureCode: run?.failureCode ?? job.failureCode,
              failureMessage: run?.failureMessage ?? job.failureMessage,
            };
          })}
          error={{
            code: item.generationErrorCode,
            message: item.generationErrorMessage,
            stage: item.generationErrorStage,
          }}
        />
      </AppPage>
    );
  }

  // Signed per variant, not once for the item: a render is a `media_assets`
  // row like any other, and reaching it always goes through a short-lived
  // signed URL rather than a public one (see src/lib/storage/types.ts).
  const renderedAssetIds = [
    ...new Set(variants.map((variant) => variant.renderedAssetId).filter((id) => id !== null)),
  ];
  const renderedAssetUrls = new Map<string, string>();
  if (renderedAssetIds.length > 0) {
    const storage = getStorageAdapter();
    const renderedAssets = await db
      .select({ id: mediaAssets.id, bucket: mediaAssets.bucket, storagePath: mediaAssets.storagePath })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, renderedAssetIds));
    await Promise.all(
      renderedAssets.map(async (asset) => {
        const url = await storage.getSignedUrl(asset.bucket as StorageBucket, asset.storagePath, 3600);
        renderedAssetUrls.set(asset.id, url);
      }),
    );
  }

  // Segments arrive as a left join, so a script with no segments yields one row
  // of nulls. Filtered here rather than in the component, which should not have
  // to know about the join's shape.
  const segments = scriptRows
    .filter((row): row is typeof row & { text: string } => row.text !== null)
    .map((row) => ({
      position: row.segmentIndex ?? 0,
      text: row.text,
      startMs: row.startMs,
      endMs: row.endMs,
      role: row.role,
    }));

  return (
    <AppPage width="full">
      <EditorShell
        item={{
          id: item.id,
          title: item.title ?? "Untitled item",
          typeLabel: CONTENT_TYPE_LABELS[item.contentType] ?? item.contentType,
          language: item.language,
          status: item.status,
          caption: item.caption,
          callToAction: item.callToAction,
          durationMs: item.durationMs,
          isMock: item.origin === "mock",
          revision: item.revision,
          updatedAt: item.updatedAt.toISOString(),
          campaignId: item.campaignId,
          campaignName: item.campaignName,
        }}
        variants={variants.map((variant) => ({
          ...variant,
          renderedAssetUrl: variant.renderedAssetId
            ? (renderedAssetUrls.get(variant.renderedAssetId) ?? null)
            : null,
        }))}
        segments={segments}
        assets={assets}
        availableCampaigns={availableCampaigns}
      />
    </AppPage>
  );
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
