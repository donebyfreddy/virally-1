import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaAssets, providerRunOutputs, providerRuns } from "@/lib/db/schema";
import { getStorageAdapter } from "@/lib/storage";
import { assetKindFor, extensionFor } from "./assetKind";
import type { TenantScope } from "./scope";
import { assertScope } from "./scope";
import type { GenerationKind } from "./types";

/**
 * Ingestion: copying provider output into Virally-owned storage.
 *
 * This is the step that makes a generation real. Until it runs, all Virally has
 * is a URL on someone else's CDN that expires — Magnific's generated URLs are
 * explicitly temporary. A product that stored those URLs as asset locations
 * would look fine for an hour and then serve broken media forever, with the
 * original bytes unrecoverable because the provider task is long gone.
 *
 * So the rule enforced here and in runs.ts: a run reaches `completed` only when
 * every one of its outputs has a `media_asset_id`, and only ingestion sets that.
 *
 * Ordering, which matters on every failure path:
 *
 *   1. Download bytes into memory.
 *   2. Hash them.
 *   3. Write to storage.
 *   4. Insert the asset row.
 *   5. Link the output row.
 *
 * Storage is written BEFORE the database row exists, so a crash between them
 * leaves an orphaned object — wasted bytes, cheap to sweep. The reverse order
 * would leave a database row pointing at an object that was never written,
 * which is indistinguishable from working until someone requests it.
 */

/** Refuses a file larger than this. Bounds memory and blast radius. */
export const MAX_ASSET_BYTES = 512 * 1024 * 1024;

/** How long to wait for a provider download before giving up. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type IngestResult = {
  mediaAssetId: string;
  byteSize: number;
  checksum: string;
  /** False when the output was already ingested — a retry is a no-op. */
  ingested: boolean;
};

export class IngestError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "IngestError";
    this.retryable = retryable;
  }
}

/**
 * Ingests every un-ingested output of a run.
 *
 * Returns once all outputs carry an asset. The caller then calls
 * `completeRun`, which re-checks the same invariant against the database
 * rather than trusting this return value.
 */
export async function ingestRunOutputs(
  scope: TenantScope,
  runId: string,
): Promise<readonly IngestResult[]> {
  assertScope(scope);

  const run = await db
    .select({
      id: providerRuns.id,
      generationType: providerRuns.generationType,
      capability: providerRuns.capability,
      providerId: providerRuns.providerId,
      model: providerRuns.model,
      estimatedInternalCents: providerRuns.estimatedInternalCents,
    })
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.id, runId),
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
      ),
    )
    .limit(1);

  const found = run[0];
  if (!found) throw new IngestError(`No provider run ${runId} in this workspace.`, false);

  const pending = await db
    .select({
      id: providerRunOutputs.id,
      sourceUrl: providerRunOutputs.sourceUrl,
      mimeType: providerRunOutputs.mimeType,
      position: providerRunOutputs.position,
    })
    .from(providerRunOutputs)
    .where(
      and(
        eq(providerRunOutputs.providerRunId, runId),
        eq(providerRunOutputs.workspaceId, scope.workspaceId),
        isNull(providerRunOutputs.mediaAssetId),
      ),
    );

  const results: IngestResult[] = [];
  for (const output of pending) {
    results.push(
      await ingestOne({
        scope,
        outputId: output.id,
        sourceUrl: output.sourceUrl,
        declaredMimeType: output.mimeType,
        position: output.position,
        generationType: found.generationType,
        capability: found.capability,
        providerId: found.providerId,
        model: found.model,
        costCents: found.estimatedInternalCents,
      }),
    );
  }
  return results;
}

async function ingestOne(input: {
  scope: TenantScope;
  outputId: string;
  sourceUrl: string;
  declaredMimeType: string | null;
  position: number;
  generationType: GenerationKind;
  capability: string | null;
  providerId: string;
  model: string;
  costCents: number;
}): Promise<IngestResult> {
  const { bytes, mimeType } = await download(input.sourceUrl, input.declaredMimeType);
  const checksum = createHash("sha256").update(bytes).digest("hex");

  // Content-addressed key. Two identical generations write the same object
  // instead of two copies, and the key cannot collide across workspaces because
  // the workspace id prefixes it.
  const extension = extensionFor(mimeType, input.generationType);
  const key = `${input.scope.workspaceId}/${checksum}${extension}`;

  const storage = getStorageAdapter();
  await storage.putObject({
    bucket: "generated-media",
    key,
    body: bytes,
    contentType: mimeType,
  });

  return db.transaction(async (tx) => {
    // Re-checked inside the transaction. A concurrent poll and webhook can both
    // reach this point for the same output; the second must not create a
    // duplicate asset row.
    const current = await tx
      .select({ mediaAssetId: providerRunOutputs.mediaAssetId })
      .from(providerRunOutputs)
      .where(eq(providerRunOutputs.id, input.outputId))
      .for("update")
      .limit(1);

    const existing = current[0]?.mediaAssetId;
    if (existing) {
      return { mediaAssetId: existing, byteSize: bytes.byteLength, checksum, ingested: false };
    }

    const [asset] = await tx
      .insert(mediaAssets)
      .values({
        organizationId: input.scope.organizationId,
        workspaceId: input.scope.workspaceId,
        kind: assetKindFor(input.generationType, input.capability),
        bucket: "generated-media",
        storagePath: key,
        mimeType,
        byteSize: bytes.byteLength,
        // Dimensions, duration and codec stay null until FFmpeg measures them
        // (Phase 5). Guessing them from the URL or the MIME type would put
        // fabricated numbers into the quality checks that later read them.
        origin: "provider",
        provider: input.providerId,
        providerModel: input.model,
        generationCostCents: input.costCents,
        checksum,
        uploadState: "uploaded",
        // No malware scanner is wired up. `skipped` is the honest value —
        // `clean` would assert a scan that never ran.
        scanState: "skipped",
      })
      .returning({ id: mediaAssets.id });

    if (!asset) throw new IngestError("Failed to record the ingested asset.", true);

    await tx
      .update(providerRunOutputs)
      .set({
        mediaAssetId: asset.id,
        byteSize: bytes.byteLength,
        checksumSha256: checksum,
        mimeType,
        ingestedAt: new Date(),
      })
      .where(eq(providerRunOutputs.id, input.outputId));

    return { mediaAssetId: asset.id, byteSize: bytes.byteLength, checksum, ingested: true };
  });
}

/**
 * Fetches provider media.
 *
 * Enforces the size cap while streaming rather than after, so a hostile or
 * broken response cannot exhaust memory before the check runs.
 */
async function download(
  url: string,
  declaredMimeType: string | null,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });

    if (!response.ok) {
      // 404 and 410 mean the provider URL expired before ingestion ran. Not
      // retryable: the bytes are gone and re-fetching cannot bring them back.
      // The generation must be re-run, which is a different decision.
      const gone = response.status === 404 || response.status === 410;
      throw new IngestError(
        gone
          ? "The provider's media URL expired before it could be copied into storage. The generation must be run again."
          : `Could not download the generated media (HTTP ${response.status}).`,
        !gone,
      );
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_ASSET_BYTES) {
      throw new IngestError(
        `The generated file is ${declaredLength} bytes, above the ${MAX_ASSET_BYTES} limit.`,
        false,
      );
    }

    const bytes = await readCapped(response);
    if (bytes.byteLength === 0) {
      throw new IngestError("The provider returned an empty file.", true);
    }

    return {
      bytes,
      // The response header wins over the declared type: it describes what was
      // actually received, and the declared value was our own guess.
      mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || declaredMimeType || "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof IngestError) throw error;
    if (controller.signal.aborted) {
      throw new IngestError("Timed out downloading the generated media.", true);
    }
    throw new IngestError("Could not reach the provider to download the generated media.", true);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a response body, aborting if it exceeds the cap mid-stream. */
async function readCapped(response: Response): Promise<Buffer> {
  const body = response.body;
  if (!body) return Buffer.from(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_ASSET_BYTES) {
      await reader.cancel();
      throw new IngestError(
        `The generated file exceeded the ${MAX_ASSET_BYTES} byte limit while downloading.`,
        false,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
