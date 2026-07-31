import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
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

  const [variants, scriptRows, assets] = await Promise.all([
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
  ]);

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
        variants={variants}
        segments={segments}
        assets={assets}
      />
    </AppPage>
  );
}
