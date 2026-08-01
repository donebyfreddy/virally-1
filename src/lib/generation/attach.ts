import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  compositionClips,
  compositionTracks,
  compositions,
  mediaAssets,
  shots,
  storyboards,
} from "@/lib/db/schema";
import type { TenantScope } from "@/lib/creative/scope";
import { assertScope } from "@/lib/creative/scope";

/**
 * Attaching a generated asset to the rest of the product.
 *
 * A generated clip is an ingredient, not an output. The brief is explicit that
 * a three- or five-second clip is not a finished reel, and this module is where
 * that stops being a slogan: everything here puts an asset INTO something —
 * a storyboard shot, a Remotion composition, a content item — rather than
 * treating the generation as the deliverable.
 *
 * Two rules hold throughout and are enforced by the queries, not by convention:
 *
 * **Ownership is re-verified from the asset's own row.** Every function takes a
 * `TenantScope` and confirms the asset belongs to it before writing anything.
 * An asset id is a UUID a caller supplies; without this check, guessing one
 * would attach another tenant's media into your campaign.
 *
 * **Attaching one thing never disturbs its siblings.** Regenerating a single
 * shot must not regenerate a campaign, and the same applies here: replacing
 * shot 4's asset touches shot 4's row and nothing else.
 */

export type AttachResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Confirms an asset exists, is ready, and belongs to this workspace.
 *
 * `upload_state` is checked as well as ownership. An asset row exists from the
 * moment ingestion begins, and attaching one that is still `pending` would put
 * a shot in front of a user pointing at bytes that are not there yet.
 */
async function assertAssetUsable(
  scope: TenantScope,
  assetId: string,
): Promise<{ ok: true; kind: string; durationMs: number | null } | { ok: false; reason: string }> {
  const [asset] = await db
    .select({
      id: mediaAssets.id,
      kind: mediaAssets.kind,
      durationMs: mediaAssets.durationMs,
      uploadState: mediaAssets.uploadState,
      scanState: mediaAssets.scanState,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.workspaceId, scope.workspaceId),
        eq(mediaAssets.organizationId, scope.organizationId),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .limit(1);

  // One message for "does not exist" and "belongs to someone else". Telling the
  // two apart would make this an existence oracle for another tenant's ids.
  if (!asset) return { ok: false, reason: "That asset is not available in this workspace." };

  if (asset.scanState === "rejected") {
    return { ok: false, reason: "That asset failed a content check and cannot be used." };
  }
  if (asset.uploadState === "failed") {
    return { ok: false, reason: "That asset failed to upload and cannot be used." };
  }
  if (asset.uploadState === "pending") {
    return { ok: false, reason: "That asset is still being stored. Try again in a moment." };
  }

  return { ok: true, kind: asset.kind, durationMs: asset.durationMs };
}

/**
 * Puts a generated asset into a storyboard shot.
 *
 * The shot's tenancy is reached through its storyboard's content item rather
 * than stored on the shot itself — `shots` carries no `workspace_id`, so the
 * join is the isolation. Writing this as a bare update on `shots.id` would
 * let any authenticated user overwrite any shot in the database.
 */
export async function attachAssetToShot(
  scope: TenantScope,
  shotId: string,
  assetId: string,
): Promise<AttachResult> {
  assertScope(scope);

  const usable = await assertAssetUsable(scope, assetId);
  if (!usable.ok) return usable;

  const [shot] = await db
    .select({ id: shots.id })
    .from(shots)
    .innerJoin(storyboards, eq(storyboards.id, shots.storyboardId))
    .where(and(eq(shots.id, shotId), eq(storyboards.workspaceId, scope.workspaceId)))
    .limit(1);

  if (!shot) return { ok: false, reason: "That shot is not available in this workspace." };

  await db
    .update(shots)
    .set({
      assetId,
      // A shot with an asset is done being generated. Left as-is the storyboard
      // would keep showing it as pending after the user could already see it.
      status: "completed",
      // The asset came from a provider, so the shot's provenance follows it.
      // Leaving `mock` here would mislabel real output as demo.
      origin: "provider",
      updatedAt: new Date(),
    })
    .where(eq(shots.id, shotId));

  return { ok: true };
}

/**
 * Appends a generated asset to a composition as a new clip.
 *
 * Frames, not milliseconds, because that is what Remotion renders against and
 * what `composition_clips` stores. The conversion happens here rather than at
 * the call site so a caller cannot pass milliseconds into a frame column — a
 * mistake that produces a clip 30× too long and looks like a duration bug
 * everywhere except where it was made.
 */
export async function attachAssetToComposition(
  scope: TenantScope,
  compositionId: string,
  assetId: string,
  options: { trackKind?: CompositionTrackKind } = {},
): Promise<AttachResult> {
  assertScope(scope);

  const usable = await assertAssetUsable(scope, assetId);
  if (!usable.ok) return usable;

  const [composition] = await db
    .select({ id: compositions.id, fps: compositions.fps })
    .from(compositions)
    .where(
      and(
        eq(compositions.id, compositionId),
        eq(compositions.workspaceId, scope.workspaceId),
        eq(compositions.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  if (!composition) {
    return { ok: false, reason: "That composition is not available in this workspace." };
  }

  const trackKind = options.trackKind ?? defaultTrackFor(usable.kind);

  return db.transaction(async (tx) => {
    const [track] = await tx
      .select({ id: compositionTracks.id })
      .from(compositionTracks)
      .where(
        and(
          eq(compositionTracks.compositionId, compositionId),
          eq(compositionTracks.kind, trackKind),
        ),
      )
      .orderBy(compositionTracks.position)
      .limit(1);

    let trackId = track?.id;
    if (!trackId) {
      // The composition has no track of this kind yet. Created rather than
      // refused: a user sending their first voiceover to a video-only
      // composition means "put it in", not "this is an error".
      const [position] = await tx
        .select({ next: sql<number>`coalesce(max(${compositionTracks.position}), -1) + 1` })
        .from(compositionTracks)
        .where(eq(compositionTracks.compositionId, compositionId));

      const [created] = await tx
        .insert(compositionTracks)
        .values({
          compositionId,
          kind: trackKind,
          position: position?.next ?? 0,
        })
        .returning({ id: compositionTracks.id });
      trackId = created!.id;
    }

    // Appended after everything already on the track. Computed inside the
    // transaction so two concurrent appends cannot both claim the same frame.
    const [tail] = await tx
      .select({
        nextPosition: sql<number>`coalesce(max(${compositionClips.position}), -1) + 1`,
        nextFrame: sql<number>`coalesce(max(${compositionClips.startFrame} + ${compositionClips.durationFrames}), 0)`,
      })
      .from(compositionClips)
      .where(eq(compositionClips.trackId, trackId));

    // A still image has no intrinsic duration, so it gets a sensible default
    // the user can then trim. Zero would violate the `duration_frames > 0`
    // check and fail the insert.
    const durationFrames = usable.durationMs
      ? Math.max(1, Math.round((usable.durationMs / 1000) * composition.fps))
      : composition.fps * 3;

    await tx.insert(compositionClips).values({
      trackId,
      assetId,
      position: tail?.nextPosition ?? 0,
      startFrame: tail?.nextFrame ?? 0,
      durationFrames,
    });

    await tx
      .update(compositions)
      .set({
        // The composition got longer. Recomputed rather than incremented so a
        // clip added to a shorter track does not inflate the total.
        durationFrames: sql`greatest(${compositions.durationFrames}, ${(tail?.nextFrame ?? 0) + durationFrames})`,
        revision: sql`${compositions.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(compositions.id, compositionId));

    return { ok: true };
  });
}

/**
 * Files a generated asset under a campaign and content item.
 *
 * The library reads these columns to group assets, so an asset generated from
 * a campaign surface but never tagged with it becomes orphaned in a flat list —
 * technically present, practically lost.
 */
export async function attachAssetToCampaign(
  scope: TenantScope,
  assetId: string,
  target: { campaignId?: string | null; contentItemId?: string | null },
): Promise<AttachResult> {
  assertScope(scope);

  const usable = await assertAssetUsable(scope, assetId);
  if (!usable.ok) return usable;

  await db
    .update(mediaAssets)
    .set({
      campaignId: target.campaignId ?? null,
      contentItemId: target.contentItemId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.workspaceId, scope.workspaceId),
        eq(mediaAssets.organizationId, scope.organizationId),
      ),
    );

  return { ok: true };
}

/**
 * The tracks a composition can actually hold.
 *
 * Taken from the `composition_tracks.kind` column rather than from the
 * in-memory `TrackKind` in `creative/composition.ts`, which is a wider set. The
 * two are not interchangeable: the in-memory type has `image` and `sfx`, the
 * column does not, and using the wider one here produced clips the database
 * rejected.
 */
type CompositionTrackKind = typeof compositionTracks.$inferSelect["kind"];

/**
 * The track a generated asset belongs on, from its kind.
 *
 * Voice and music are separated because they mix differently — a voice track is
 * ducked against music, and putting both on one track makes that impossible to
 * express later.
 *
 * Stills go on the video track rather than a track of their own. A reel is a
 * single visual timeline, and a still is a shot that does not move; giving it a
 * separate track would imply it composites over the video rather than taking
 * its turn in the cut.
 */
function defaultTrackFor(kind: string): CompositionTrackKind {
  if (kind === "voiceover") return "voice";
  if (kind === "music") return "music";
  if (kind === "audio") return "audio";
  return "video";
}
