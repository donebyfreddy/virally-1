import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  contentItems,
  contentVariants,
  mediaAssets,
  scriptSegments,
  scripts,
  shots,
  storyboards,
} from "@/lib/db/schema.fragment";
import { buildComposition, type BuildInput, type TemplateShot } from "@/remotion/templates";
import type { AssetKind } from "@/types/database";
import type { BrandStyle, Composition } from "./composition";
import { assertScope, type TenantScope } from "./scope";

/**
 * Turning a content item's storyboard into the Remotion `Composition`
 * `renderComposition` (render.ts) needs — the missing link between the
 * generation pipeline (which produces `media_assets` rows) and the renderer
 * (which is pure and knows nothing about the database).
 */

const DEFAULT_FPS = 30;

/**
 * Placeholder until brand styling is a real, workspace-configurable thing —
 * there is no `brands` table column for colour, font or logo today (checked
 * schema.ts's `brands` table: name, industry, language, nothing visual).
 * Matches Virally's own accent colour rather than an arbitrary one.
 */
const PLACEHOLDER_BRAND: BrandStyle = {
  primaryColor: "#7c5cff",
  textColor: "#f5f5f7",
  fontFamily: "sans-serif",
  logoAssetId: null,
};

/** Loosely reads a Quick Content plan snapshot for the two counts this module needs. */
function requiredAudioKindsFrom(generationPlan: unknown): readonly AssetKind[] {
  if (typeof generationPlan !== "object" || generationPlan === null) return [];
  const assets = (generationPlan as { assets?: unknown }).assets;
  if (typeof assets !== "object" || assets === null) return [];
  const { voiceovers, musicTracks } = assets as { voiceovers?: unknown; musicTracks?: unknown };
  const kinds: AssetKind[] = [];
  if (typeof voiceovers === "number" && voiceovers > 0) kinds.push("voiceover");
  if (typeof musicTracks === "number" && musicTracks > 0) kinds.push("music");
  return kinds;
}

/**
 * True once a content item has everything a render needs: every shot in its
 * current storyboard carries a generated asset, and any voiceover/music the
 * plan called for has landed as a `media_assets` row.
 *
 * Read straight from the tables the generation pipeline actually writes to,
 * not from job status — a job that completed before a worker restart still
 * counts, and a job stuck retrying does not block a render of what already
 * arrived only if every shot already has its asset.
 */
export async function isContentReadyToRender(
  scope: TenantScope,
  contentItemId: string,
): Promise<boolean> {
  assertScope(scope);

  const [item] = await db
    .select({ generationPlan: contentItems.generationPlan })
    .from(contentItems)
    .where(and(eq(contentItems.id, contentItemId), eq(contentItems.workspaceId, scope.workspaceId)))
    .limit(1);
  if (!item) return false;

  const [storyboard] = await db
    .select({ id: storyboards.id })
    .from(storyboards)
    .where(and(eq(storyboards.contentItemId, contentItemId), eq(storyboards.isCurrent, true)))
    .limit(1);
  if (!storyboard) return false;

  const shotRows = await db
    .select({
      assetId: shots.assetId,
      mimeType: mediaAssets.mimeType,
      uploadState: mediaAssets.uploadState,
    })
    .from(shots)
    .leftJoin(mediaAssets, eq(mediaAssets.id, shots.assetId))
    .where(eq(shots.storyboardId, storyboard.id));
  if (
    shotRows.length === 0 ||
    shotRows.some(
      (shot) =>
        shot.assetId === null ||
        (shot.uploadState !== "uploaded" && shot.uploadState !== "ready") ||
        !shot.mimeType ||
        (!shot.mimeType.startsWith("image/") && !shot.mimeType.startsWith("video/")),
    )
  ) {
    return false;
  }

  const [script] = await db
    .select({ id: scripts.id, fullText: scripts.fullText })
    .from(scripts)
    .where(and(eq(scripts.contentItemId, contentItemId), eq(scripts.isCurrent, true)))
    .limit(1);
  if (!script || !script.fullText?.trim()) return false;

  const segments = await db
    .select({ text: scriptSegments.text, startMs: scriptSegments.startMs, endMs: scriptSegments.endMs })
    .from(scriptSegments)
    .where(eq(scriptSegments.scriptId, script.id));
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment.text.trim() ||
        (segment.startMs !== null && segment.endMs !== null && segment.endMs <= segment.startMs),
    )
  ) {
    return false;
  }

  const requiredAudioKinds = requiredAudioKindsFrom(item.generationPlan);
  if (requiredAudioKinds.length === 0) return true;

  const audioRows = await db
    .select({
      kind: mediaAssets.kind,
      mimeType: mediaAssets.mimeType,
      uploadState: mediaAssets.uploadState,
    })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.contentItemId, contentItemId), isNull(mediaAssets.deletedAt)));
  const presentKinds = new Set(
    audioRows
      .filter(
        (row) =>
          (row.uploadState === "uploaded" || row.uploadState === "ready") &&
          row.mimeType?.startsWith("audio/"),
      )
      .map((row) => row.kind),
  );
  return requiredAudioKinds.every((kind) => presentKinds.has(kind));
}

export type RenderableAsset = { id: string; bucket: string; storagePath: string };

/**
 * Assembles the in-memory Composition `renderComposition` needs, plus the
 * storage location of every asset it references (for signing URLs).
 *
 * Call only after `isContentReadyToRender` returns true — this throws on
 * anything missing rather than degrading, because a render silently missing a
 * shot is a corrupt video delivered to the user, not a smaller one.
 */
export async function buildCompositionForContentItem(
  scope: TenantScope,
  contentItemId: string,
): Promise<{ composition: Composition; assets: readonly RenderableAsset[] }> {
  assertScope(scope);

  const [item] = await db
    .select({ id: contentItems.id })
    .from(contentItems)
    .where(and(eq(contentItems.id, contentItemId), eq(contentItems.workspaceId, scope.workspaceId)))
    .limit(1);
  if (!item) throw new Error(`Content item ${contentItemId} is not available in this workspace.`);

  const [storyboard] = await db
    .select({ id: storyboards.id })
    .from(storyboards)
    .where(and(eq(storyboards.contentItemId, contentItemId), eq(storyboards.isCurrent, true)))
    .limit(1);
  if (!storyboard) throw new Error(`No storyboard for content item ${contentItemId}.`);

  const shotRows = await db
    .select({
      id: shots.id,
      position: shots.position,
      durationMs: shots.durationMs,
      assetId: shots.assetId,
      assetKind: mediaAssets.kind,
      bucket: mediaAssets.bucket,
      storagePath: mediaAssets.storagePath,
    })
    .from(shots)
    .leftJoin(mediaAssets, eq(mediaAssets.id, shots.assetId))
    .where(eq(shots.storyboardId, storyboard.id))
    .orderBy(asc(shots.position));

  const assets: RenderableAsset[] = [];
  let cursorMs = 0;
  const templateShots: TemplateShot[] = shotRows.map((shot) => {
    if (!shot.assetId || !shot.bucket || !shot.storagePath) {
      throw new Error(`Shot ${shot.id} has no generated asset — call isContentReadyToRender first.`);
    }
    const startMs = cursorMs;
    const durationMs = shot.durationMs ?? 4000;
    cursorMs += durationMs;
    assets.push({ id: shot.assetId, bucket: shot.bucket, storagePath: shot.storagePath });
    return {
      id: shot.id,
      startMs,
      endMs: cursorMs,
      mediaAssetId: shot.assetId,
      mediaKind: shot.assetKind === "generated_video" ? "video" : "image",
      onScreenText: null,
    };
  });

  const [variant] = await db
    .select({ platform: contentVariants.platform, aspectRatio: contentVariants.aspectRatio })
    .from(contentVariants)
    .where(eq(contentVariants.contentItemId, contentItemId))
    .limit(1);

  const [script] = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.contentItemId, contentItemId), eq(scripts.isCurrent, true)))
    .limit(1);

  let hookText: string | null = null;
  let ctaText: string | null = null;
  if (script) {
    const segments = await db
      .select({ role: scriptSegments.role, text: scriptSegments.text })
      .from(scriptSegments)
      .where(eq(scriptSegments.scriptId, script.id));
    hookText = segments.find((segment) => segment.role === "hook")?.text ?? null;
    ctaText = segments.find((segment) => segment.role === "cta")?.text ?? null;
  }

  const audioRows = await db
    .select({ id: mediaAssets.id, kind: mediaAssets.kind, bucket: mediaAssets.bucket, storagePath: mediaAssets.storagePath })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.contentItemId, contentItemId), isNull(mediaAssets.deletedAt)));
  const voice = audioRows.find((row) => row.kind === "voiceover") ?? null;
  const music = audioRows.find((row) => row.kind === "music") ?? null;
  if (voice) assets.push({ id: voice.id, bucket: voice.bucket, storagePath: voice.storagePath });
  if (music) assets.push({ id: music.id, bucket: music.bucket, storagePath: music.storagePath });

  const buildInput: BuildInput = {
    templateId: "faceless-documentary",
    ratio: variant?.aspectRatio ?? "9:16",
    platform: variant?.platform ?? "tiktok",
    fps: DEFAULT_FPS,
    shots: templateShots,
    voiceAssetId: voice?.id ?? null,
    musicAssetId: music?.id ?? null,
    hookText,
    ctaText,
    brand: PLACEHOLDER_BRAND,
  };

  return { composition: buildComposition(buildInput), assets };
}
