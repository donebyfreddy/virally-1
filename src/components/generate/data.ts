import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaAssets } from "@/lib/db/schema";
import type { GenerationModel } from "@/lib/creative/capabilities";
import type { TenantScope } from "@/lib/creative/scope";
import { readBalance, type CreditBalance } from "@/lib/creative/credits";
import {
  readActiveGenerations,
  readAvailableModels,
  readGenerationHistory,
  readProviderStatus,
  type GenerationStatus,
} from "@/lib/generation/data";
import { getStorageAdapter } from "@/lib/storage";
import type { StudioDefinition } from "@/content/generate";
import type { ReferenceAsset } from "./ReferenceUploader";
import type { ProviderStatus } from "./ProviderBanner";

/**
 * Everything one studio page needs, in a single round trip.
 *
 * Lives here rather than in `src/lib/generation` because it is a view model:
 * it exists to serve four pages that render the same shape, and putting it in
 * the data layer would make the backend own a decision about how the UI is
 * composed. The reads it batches are all the backend's own.
 *
 * One `Promise.all`, deliberately. Awaited in sequence this is five network
 * latencies before the page renders anything, and none of the five depends on
 * another.
 */

/** History rows per studio. One screen's worth; the page states that it is capped. */
const HISTORY_LIMIT = 12;
/** Library images offered as references. */
const REFERENCE_LIMIT = 24;
/** Preview lifetime. Matches the library's, for the same force-dynamic reason. */
const PREVIEW_TTL_SECONDS = 900;

export type StudioData = {
  models: readonly GenerationModel[];
  history: readonly GenerationStatus[];
  /** True when there are older generations than the page shows. */
  historyTruncated: boolean;
  activeRuns: readonly GenerationStatus[];
  balance: CreditBalance;
  references: readonly ReferenceAsset[];
  providers: readonly ProviderStatus[];
};

export async function loadStudioData(
  scope: TenantScope,
  studio: StudioDefinition,
): Promise<StudioData> {
  const [catalogue, history, activeRuns, balance, referenceRows] = await Promise.all([
    // The whole available catalogue, narrowed below. `readAvailableModels`
    // takes ONE capability and a studio owns several, so filtering here is what
    // keeps the picker's own capability filter meaningful rather than issuing
    // three catalogue reads and stitching them together.
    readAvailableModels({}),
    readGenerationHistory(scope, {
      generationType: studio.generationType,
      limit: HISTORY_LIMIT,
    }),
    readActiveGenerations(scope),
    readBalance(scope),
    db
      .select({
        id: mediaAssets.id,
        filename: mediaAssets.filename,
        kind: mediaAssets.kind,
        bucket: mediaAssets.bucket,
        storagePath: mediaAssets.storagePath,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.workspaceId, scope.workspaceId),
          eq(mediaAssets.organizationId, scope.organizationId),
          isNull(mediaAssets.deletedAt),
          // Only objects whose bytes exist and passed moderation. A row exists
          // before its bytes do, and signing a pending asset produces a URL
          // that 404s the moment a provider fetches it.
          sql`${mediaAssets.uploadState} = 'ready'`,
          sql`${mediaAssets.scanState} <> 'rejected'`,
          sql`(${mediaAssets.mimeType} like 'image/%' or ${mediaAssets.kind}::text in ('image', 'generated_image', 'thumbnail'))`,
        ),
      )
      .orderBy(desc(mediaAssets.createdAt))
      .limit(REFERENCE_LIMIT),
  ]);

  const models = catalogue.filter((model) =>
    model.capabilities.some((capability) => studio.capabilities.includes(capability)),
  );

  const storage = getStorageAdapter();
  const references = await Promise.all(
    referenceRows.map(async (row): Promise<ReferenceAsset> => {
      let previewUrl: string | null = null;
      try {
        previewUrl = await storage.getSignedUrl(row.bucket, row.storagePath, PREVIEW_TTL_SECONDS);
      } catch {
        // A signing failure is a missing thumbnail, not a missing page.
        previewUrl = null;
      }
      return {
        id: row.id,
        title: row.filename ?? row.kind,
        previewUrl,
      };
    }),
  );

  return {
    models,
    history: history.items,
    historyTruncated: history.nextCursor !== null,
    activeRuns,
    balance,
    references,
    providers: readProviderStatus(),
  };
}

