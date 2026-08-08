import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import {
  campaigns,
  contentItems,
  contentVariants,
  mediaAssets,
  scripts,
  scriptSegments,
} from "@/lib/db/schema.fragment";
import { AppPage } from "@/components/app-ui/AppPage";
import { EditorShell } from "@/components/editor/EditorShell";
import { CONTENT_TYPE_LABELS } from "@/content/content-library";
import { cn } from "@/lib/cn";
import { getStorageAdapter } from "@/lib/storage";
import type { StorageBucket } from "@/lib/storage/types";

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
  searchParams,
}: {
  params: Promise<{ contentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { contentId } = await params;
  const rawPartialErrors = (await searchParams).partialErrors;
  const partialErrorCount = Number(
    Array.isArray(rawPartialErrors) ? rawPartialErrors[0] : rawPartialErrors,
  );

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
      {/* From Quick Content's generate step: some assets started (and reserved
          real credits) before one was refused. Shown here, not as a blocking
          error on the form, because the content this page is for already
          exists and already has assets in flight — the notice is a status,
          not something the user needs to resolve to proceed. */}
      {Number.isFinite(partialErrorCount) && partialErrorCount > 0 && (
        <div
          className={cn(
            "mb-[var(--app-panel-gap)] flex items-start gap-[var(--space-3)] rounded-[var(--radius-card)]",
            "border border-[var(--warning-mark)] bg-[var(--warning-soft)]",
            "px-[var(--app-panel-pad)] py-[var(--space-4)]",
          )}
        >
          <TriangleAlert
            aria-hidden="true"
            size={16}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-[color:var(--warning)]"
          />
          <div className="min-w-0">
            <p className="text-[length:var(--text-app-cell)] font-[var(--weight-heading)] text-[color:var(--warning)]">
              Some assets could not be generated
            </p>
            <p className="mt-1 max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
              {partialErrorCount} of the assets this plan called for did not start. The rest
              did, and reserved credits as usual — see what came through below.
            </p>
          </div>
        </div>
      )}

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
