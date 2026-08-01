import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaAssets } from "@/lib/db/schema";
import type { TenantScope } from "@/lib/creative/scope";
import { assertScope } from "@/lib/creative/scope";
import { getStorageAdapter } from "@/lib/storage";

/**
 * Turning asset IDs into URLs a provider can fetch.
 *
 * The client sends ASSET IDS, never URLs. That is the whole point of this
 * module and it replaces an earlier design that accepted a URL and tried to
 * validate it with a string prefix check.
 *
 * String validation was the wrong shape twice over. It was fragile — the
 * storage adapter returns an ABSOLUTE signed URL, so the relative-path rule it
 * enforced would have rejected every real reference the moment object storage
 * was switched on, and the workaround was for the browser to strip the origin
 * back off. And it was the wrong security boundary: a check that asks "does
 * this string look like one of ours" is one parser bug away from an SSRF, since
 * whatever it lets through is fetched by both the provider and our own
 * ingestion.
 *
 * An ID cannot express a host. Resolution happens here, against rows the
 * workspace demonstrably owns, and the URL the provider sees is one Virally
 * minted seconds earlier. There is no string for an attacker to shape.
 */

/**
 * How long a reference URL must stay valid.
 *
 * Longer than a UI preview, because the consumer is a provider's fetcher rather
 * than a browser: the URL is handed over at submit and may not be read until
 * the vendor's queue reaches the task. Fifteen minutes is short enough that a
 * leaked URL expires quickly and long enough to survive a busy queue.
 */
const REFERENCE_TTL_SECONDS = 900;

export type ResolvedReference = {
  assetId: string;
  url: string;
  mimeType: string | null;
  kind: string;
};

export type ReferenceResolution =
  | { ok: true; references: readonly ResolvedReference[] }
  | { ok: false; reason: string };

/**
 * Resolves reference asset IDs to signed, provider-fetchable URLs.
 *
 * Order is preserved from the input, because it is meaningful: the first
 * reference is the structure or first-frame image and the second is the style
 * reference. Returning them in database order would silently swap the two and
 * produce a plausible-looking image built from the wrong guidance.
 */
export async function resolveReferences(
  scope: TenantScope,
  assetIds: readonly string[],
  options: { expectedKinds?: readonly string[] } = {},
): Promise<ReferenceResolution> {
  assertScope(scope);
  if (assetIds.length === 0) return { ok: true, references: [] };

  const unique = [...new Set(assetIds)];
  if (unique.length !== assetIds.length) {
    return { ok: false, reason: "The same reference was supplied more than once." };
  }

  const rows = await db
    .select({
      id: mediaAssets.id,
      bucket: mediaAssets.bucket,
      storagePath: mediaAssets.storagePath,
      mimeType: mediaAssets.mimeType,
      kind: mediaAssets.kind,
      uploadState: mediaAssets.uploadState,
      scanState: mediaAssets.scanState,
    })
    .from(mediaAssets)
    .where(
      and(
        inArray(mediaAssets.id, unique),
        // Both, always. There is no row-level security on this database, so
        // these two predicates are the entire reason a guessed UUID from another
        // tenant resolves to nothing instead of to their photograph.
        eq(mediaAssets.workspaceId, scope.workspaceId),
        eq(mediaAssets.organizationId, scope.organizationId),
        isNull(mediaAssets.deletedAt),
      ),
    );

  const byId = new Map(rows.map((row) => [row.id, row]));

  // A count mismatch means at least one id named something this workspace
  // cannot see. One message for "does not exist" and "belongs to someone else",
  // so the endpoint is not an existence oracle for another tenant's ids.
  if (byId.size !== unique.length) {
    return { ok: false, reason: "A reference image is not available in this workspace." };
  }

  const storage = getStorageAdapter();
  const references: ResolvedReference[] = [];

  for (const assetId of assetIds) {
    const row = byId.get(assetId)!;

    if (row.scanState === "rejected") {
      return { ok: false, reason: "A reference image failed a content check and cannot be used." };
    }
    if (row.uploadState !== "uploaded" && row.uploadState !== "ready") {
      return { ok: false, reason: "A reference image is still being stored. Try again in a moment." };
    }
    if (options.expectedKinds && !options.expectedKinds.includes(row.kind)) {
      return { ok: false, reason: `A reference of the wrong type was supplied (${row.kind}).` };
    }

    let url: string;
    try {
      url = await storage.getSignedUrl(row.bucket, row.storagePath, REFERENCE_TTL_SECONDS);
    } catch {
      // Refused rather than skipped. Dropping an unsignable reference would run
      // the generation without guidance the user asked for and bill them for
      // the result, which is worse than a clear failure.
      return { ok: false, reason: "A reference image could not be prepared. Try again." };
    }

    references.push({ assetId, url, mimeType: row.mimeType, kind: row.kind });
  }

  return { ok: true, references };
}

/** Asset kinds that may be used as an image reference. */
export const IMAGE_REFERENCE_KINDS: readonly string[] = [
  "image",
  "generated_image",
  "thumbnail",
  "brand_asset",
];

/** Asset kinds that may drive a lip-sync generation. */
export const AUDIO_REFERENCE_KINDS: readonly string[] = ["audio", "voiceover", "music"];
