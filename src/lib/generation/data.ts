import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  jobs,
  mediaAssets,
  providerRunOutputs,
  providerRuns,
} from "@/lib/db/schema";
import {
  isGenerationCapability,
  type GenerationCapability,
  type GenerationModel,
} from "@/lib/creative/capabilities";
import { getProviderRouter } from "@/lib/creative/router";
import type { TenantScope } from "@/lib/creative/scope";
import { assertScope } from "@/lib/creative/scope";
import type { ProviderRunState } from "@/lib/creative/types";
import { getStorageAdapter } from "@/lib/storage";

/**
 * Read queries for the generation surfaces.
 *
 * Every function takes a `TenantScope` and filters on BOTH organisation and
 * workspace. There is no row-level security on this database, so these filters
 * are the isolation — not a performance hint, not defence in depth, the whole
 * mechanism. A query here that forgets one is a cross-tenant data leak.
 *
 * Kept separate from `service.ts` because reads and writes have different
 * risks and different review needs: a bug here shows the wrong data, a bug
 * there spends money.
 */

/** How long a preview URL stays valid. Matches the library's own TTL. */
const PREVIEW_TTL_SECONDS = 900;

export type GenerationStatus = {
  runId: string;
  jobId: string | null;
  state: ProviderRunState;
  /** 0-100, or null when the provider does not report it. Never synthesised. */
  progress: number | null;
  capability: GenerationCapability | null;
  generationType: "image" | "video" | "audio";
  providerId: string;
  model: string;
  prompt: string;
  estimatedCents: number;
  actualCents: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  /** True when the run produced demo output rather than a real generation. */
  isMock: boolean;
  createdAt: Date;
  completedAt: Date | null;
  assets: readonly GeneratedAsset[];
};

export type GeneratedAsset = {
  id: string;
  kind: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  byteSize: number | null;
  /** Signed, short-lived. Never a provider URL. */
  previewUrl: string | null;
};

/**
 * The state of one generation, for the progress UI.
 *
 * Reads the run rather than the job because the run is what the user cares
 * about — the job is the machinery that drives it, and a job can be retried
 * while the run it serves stays the same generation.
 */
export async function readGenerationStatus(
  scope: TenantScope,
  runId: string,
): Promise<GenerationStatus | null> {
  assertScope(scope);

  const [run] = await db
    .select()
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.id, runId),
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  if (!run) return null;
  const [withAssets] = await attachAssets(scope, [run]);
  return withAssets ?? null;
}

export type HistoryPage = {
  items: readonly GenerationStatus[];
  /** Cursor for the next page. Null when there are no more. */
  nextCursor: string | null;
};

/**
 * Recent generations, newest first.
 *
 * Keyset pagination on `created_at` rather than OFFSET. A studio's history grows
 * without bound and OFFSET scans everything it skips, so page 40 of a busy
 * workspace would be measurably slower than page 1 — and worse, an OFFSET page
 * shifts under the reader whenever a new generation lands, which in a live
 * studio is constantly.
 */
export async function readGenerationHistory(
  scope: TenantScope,
  options: {
    capability?: GenerationCapability;
    generationType?: "image" | "video" | "audio";
    campaignId?: string;
    limit?: number;
    /** ISO timestamp of the last item on the previous page. */
    cursor?: string | null;
  } = {},
): Promise<HistoryPage> {
  assertScope(scope);
  const limit = Math.min(options.limit ?? 24, 100);

  const filters = [
    eq(providerRuns.workspaceId, scope.workspaceId),
    eq(providerRuns.organizationId, scope.organizationId),
  ];
  if (options.generationType) {
    filters.push(eq(providerRuns.generationType, options.generationType));
  }
  // Applied, not merely accepted. Lip-sync and text-to-video are both `video`,
  // so filtering on type alone puts a talking head in the same list as b-roll.
  if (options.capability) {
    filters.push(eq(providerRuns.capability, options.capability));
  }
  if (options.cursor) {
    filters.push(lt(providerRuns.createdAt, new Date(options.cursor)));
  }

  // One extra row, to learn whether another page exists without a count query.
  const rows = await db
    .select()
    .from(providerRuns)
    .where(and(...filters))
    .orderBy(desc(providerRuns.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = await attachAssets(scope, page);

  return {
    items,
    nextCursor: hasMore ? (page[page.length - 1]?.createdAt.toISOString() ?? null) : null,
  };
}

/**
 * Generations still in flight, for the live queue.
 *
 * Bounded and index-backed: the partial index on `provider_runs` covers exactly
 * this predicate. The studio polls this, so it must stay cheap even when a
 * workspace has thousands of historic runs.
 */
export async function readActiveGenerations(
  scope: TenantScope,
  limit = 20,
): Promise<readonly GenerationStatus[]> {
  assertScope(scope);

  const rows = await db
    .select()
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
        sql`${providerRuns.state} in ('planned', 'queued', 'submitted', 'waiting_external', 'generating', 'downloading', 'validating')`,
      ),
    )
    .orderBy(desc(providerRuns.createdAt))
    .limit(limit);

  return attachAssets(scope, rows);
}

/**
 * The models a workspace may pick from, grouped for the picker.
 *
 * Unconfigured providers are excluded rather than shown disabled: a model the
 * user cannot run is not a choice, and offering it moves the failure from
 * selection time to submit time, after they have written a prompt.
 */
export async function readAvailableModels(options: {
  capability?: GenerationCapability;
  mode?: Parameters<ReturnType<typeof getProviderRouter>["availableModels"]>[1];
} = {}): Promise<readonly GenerationModel[]> {
  return getProviderRouter().availableModels(options.capability, options.mode);
}

/** Configuration state per provider, for the "Provider configuration required" banner. */
export function readProviderStatus(): readonly {
  id: string;
  label: string;
  configured: boolean;
}[] {
  return getProviderRouter().describeProviders();
}

// --- Internals ------------------------------------------------------------------

type RunRow = typeof providerRuns.$inferSelect;

/**
 * Attaches ingested assets and signs their preview URLs.
 *
 * Batched across the whole page — one query for outputs, one for assets, one
 * signing pass — because the obvious per-run version is three queries per row
 * and a 24-item history page would issue seventy-two.
 *
 * Only ingested outputs are returned. An output whose `media_asset_id` is null
 * is a provider URL that has not been copied into Virally storage yet, and the
 * brief forbids serving those: they expire, and a UI that renders one shows a
 * broken image an hour later.
 */
async function attachAssets(
  scope: TenantScope,
  runs: readonly RunRow[],
): Promise<readonly GenerationStatus[]> {
  if (runs.length === 0) return [];

  const runIds = runs.map((run) => run.id);

  const outputs = await db
    .select({
      providerRunId: providerRunOutputs.providerRunId,
      mediaAssetId: providerRunOutputs.mediaAssetId,
      position: providerRunOutputs.position,
    })
    .from(providerRunOutputs)
    .where(
      and(
        inArray(providerRunOutputs.providerRunId, runIds),
        eq(providerRunOutputs.workspaceId, scope.workspaceId),
        sql`${providerRunOutputs.mediaAssetId} is not null`,
      ),
    )
    .orderBy(providerRunOutputs.position);

  const assetIds = outputs
    .map((output) => output.mediaAssetId)
    .filter((id): id is string => id !== null);

  const assets = assetIds.length
    ? await db
        .select()
        .from(mediaAssets)
        .where(
          and(
            inArray(mediaAssets.id, assetIds),
            eq(mediaAssets.workspaceId, scope.workspaceId),
            eq(mediaAssets.organizationId, scope.organizationId),
            isNull(mediaAssets.deletedAt),
          ),
        )
    : [];

  const storage = getStorageAdapter();
  const assetById = new Map<string, GeneratedAsset>();
  await Promise.all(
    assets.map(async (asset) => {
      let previewUrl: string | null = null;
      try {
        previewUrl = await storage.getSignedUrl(
          asset.bucket,
          asset.storagePath,
          PREVIEW_TTL_SECONDS,
        );
      } catch {
        // A signing failure is a broken thumbnail, not a broken page. The rest
        // of the generation's metadata is still worth rendering.
        previewUrl = null;
      }
      assetById.set(asset.id, {
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        byteSize: asset.byteSize,
        previewUrl,
      });
    }),
  );

  const byRun = new Map<string, GeneratedAsset[]>();
  for (const output of outputs) {
    if (!output.mediaAssetId) continue;
    const asset = assetById.get(output.mediaAssetId);
    if (!asset) continue;
    const list = byRun.get(output.providerRunId) ?? [];
    list.push(asset);
    byRun.set(output.providerRunId, list);
  }

  // Job ids in one query rather than per run, for the same reason as above.
  const jobRows = await db
    .select({ id: jobs.id, workspaceId: jobs.workspaceId })
    .from(jobs)
    .where(
      and(
        eq(jobs.workspaceId, scope.workspaceId),
        inArray(
          jobs.id,
          runs.map((run) => run.jobId).filter((id): id is string => id !== null),
        ),
      ),
    );
  const knownJobs = new Set(jobRows.map((row) => row.id));

  return runs.map((run) => ({
    runId: run.id,
    jobId: run.jobId && knownJobs.has(run.jobId) ? run.jobId : null,
    state: run.state,
    progress: run.progress,
    capability: isGenerationCapability(run.capability) ? run.capability : null,
    generationType: run.generationType,
    providerId: run.providerId,
    model: run.model,
    prompt: run.inputPrompt,
    estimatedCents: run.estimatedInternalCents,
    actualCents: run.actualInternalCents,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    // Read from the provider id rather than a stored flag, so a demo asset can
    // never lose its label through a column nobody remembered to set.
    isMock: run.providerId === "mock",
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    assets: byRun.get(run.id) ?? [],
  }));
}
