import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerRunOutputs, providerRuns } from "@/lib/db/schema";
import type { TenantScope } from "./scope";
import { assertScope } from "./scope";
import type {
  GenerationKind,
  GenerationTask,
  ProviderRunState,
  GenerationTaskStatus,
} from "./types";
import { isTerminalState } from "./types";

/**
 * Persistence for provider runs.
 *
 * Every function here takes an explicit `TenantScope` and filters on BOTH
 * organisation and workspace. That is the whole isolation mechanism — there is
 * no RLS on this database (see schema.fragment.ts) — so a query written without
 * the scope is a cross-tenant read, not a style problem.
 *
 * The ordering rules the rest of the system depends on:
 *
 *   reserve -> submit -> poll -> ingest -> complete
 *
 * A run is created in `planned`/`queued` BEFORE the provider is called, so a
 * crash between "we charged them" and "we submitted" leaves a row to reconcile
 * rather than a silent loss. And a run only reaches `completed` through
 * `completeRun`, which requires every output to carry a media asset id.
 */

export type CreateRunInput = {
  scope: TenantScope;
  idempotencyKey: string;
  providerId: string;
  model: string;
  generationType: GenerationKind;
  /** The capability served, e.g. "image-to-video". Null when unspecified. */
  capability?: string | null;
  prompt: string;
  negativePrompt?: string | null;
  inputAssetIds?: readonly string[];
  requestedDurationSeconds?: number | null;
  requestedResolution?: string | null;
  requestedAspectRatio?: string | null;
  estimatedInternalCents: number;
  generationRunId?: string | null;
  jobId?: string | null;
};

export type ProviderRunRow = {
  id: string;
  state: ProviderRunState;
  externalTaskId: string | null;
  attemptCount: number;
  model: string;
  providerId: string;
  generationType: GenerationKind;
  estimatedInternalCents: number;
  actualInternalCents: number | null;
};

/**
 * Creates a run, or returns the existing one for this idempotency key.
 *
 * The insert is `ON CONFLICT DO NOTHING` followed by a read rather than
 * check-then-insert. Two concurrent submits of the same key would both pass a
 * prior existence check and both insert; the unique constraint is what actually
 * decides, so the code lets the database decide and reads back the winner.
 *
 * Returns `created: false` when the row already existed — the caller MUST NOT
 * submit to the provider in that case, because a task is already in flight.
 */
export async function createOrGetRun(
  input: CreateRunInput,
): Promise<{ run: ProviderRunRow; created: boolean }> {
  assertScope(input.scope);

  const inserted = await db
    .insert(providerRuns)
    .values({
      organizationId: input.scope.organizationId,
      workspaceId: input.scope.workspaceId,
      idempotencyKey: input.idempotencyKey,
      providerId: input.providerId,
      model: input.model,
      generationType: input.generationType,
      capability: input.capability ?? null,
      inputPrompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      inputAssetIds: [...(input.inputAssetIds ?? [])],
      requestedDurationSeconds: input.requestedDurationSeconds ?? null,
      requestedResolution: input.requestedResolution ?? null,
      requestedAspectRatio: input.requestedAspectRatio ?? null,
      estimatedInternalCents: Math.max(0, Math.trunc(input.estimatedInternalCents)),
      generationRunId: input.generationRunId ?? null,
      jobId: input.jobId ?? null,
      state: "queued",
    })
    .onConflictDoNothing({
      target: [providerRuns.workspaceId, providerRuns.idempotencyKey],
    })
    .returning(RUN_COLUMNS);

  const created = inserted[0];
  if (created) return { run: toRow(created), created: true };

  const existing = await db
    .select(RUN_COLUMNS)
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.workspaceId, input.scope.workspaceId),
        eq(providerRuns.organizationId, input.scope.organizationId),
        eq(providerRuns.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (!row) {
    // The insert conflicted, so a row with this key exists — but not in this
    // tenant. Two workspaces chose the same key, which the composite unique
    // permits; reaching here means the scope was wrong, not that the row
    // vanished.
    throw new Error(
      "Idempotency key conflicted but no run is visible in this workspace. The tenant scope does not match the run that owns the key.",
    );
  }
  return { run: toRow(row), created: false };
}

/**
 * Records that the provider accepted a submission.
 *
 * Guarded on `external_task_id IS NULL`: a second writer that already submitted
 * must not overwrite the first task id, or the original provider task becomes
 * unreachable and bills without anything ever collecting its output.
 */
export async function recordSubmission(
  scope: TenantScope,
  runId: string,
  task: GenerationTask,
): Promise<boolean> {
  assertScope(scope);
  const updated = await db
    .update(providerRuns)
    .set({
      externalTaskId: task.externalTaskId,
      state: task.state,
      model: task.model,
      startedAt: sql`coalesce(${providerRuns.startedAt}, now())`,
      attemptCount: sql`${providerRuns.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(providerRuns.id, runId),
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
        sql`${providerRuns.externalTaskId} is null`,
      ),
    )
    .returning({ id: providerRuns.id });

  return updated.length > 0;
}

/**
 * Applies a polled or webhook-delivered status.
 *
 * Never writes `completed`. A provider reporting COMPLETED means the bytes
 * exist at an expiring URL, which the adapter maps to `downloading`; only
 * `completeRun` may declare a run finished, and only once every output has an
 * ingested asset. Terminal runs are also not reopened — a late webhook arriving
 * after a failure must not resurrect the run.
 */
export async function applyStatus(
  scope: TenantScope,
  runId: string,
  status: GenerationTaskStatus,
): Promise<void> {
  assertScope(scope);

  if (status.state === "completed") {
    throw new Error(
      "applyStatus cannot write `completed`. A run is only complete once its media is in Virally storage — use completeRun().",
    );
  }

  const terminal = isTerminalState(status.state);

  await db.transaction(async (tx) => {
    await tx
      .update(providerRuns)
      .set({
        state: status.state,
        progress: status.progress,
        providerCredits: status.providerCredits,
        failureCode: status.failure?.code ?? null,
        failureMessage: status.failure?.message ?? null,
        // A failed run costs nothing internally unless the provider billed it.
        // Writing 0 for a billed failure would silently absorb a real cost.
        actualInternalCents: terminal
          ? status.failure?.costIncurred
            ? sql`${providerRuns.estimatedInternalCents}`
            : 0
          : null,
        completedAt: terminal ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(providerRuns.id, runId),
          eq(providerRuns.workspaceId, scope.workspaceId),
          eq(providerRuns.organizationId, scope.organizationId),
          // Terminal runs are immutable.
          sql`${providerRuns.state} not in ('completed', 'failed', 'cancelled')`,
        ),
      );

    if (status.media.length === 0) return;

    // Recorded on arrival so a run whose provider URLs expire before ingestion
    // has evidence of what it was supposed to fetch.
    await tx
      .insert(providerRunOutputs)
      .values(
        status.media.map((media, index) => ({
          providerRunId: runId,
          workspaceId: scope.workspaceId,
          position: index,
          sourceUrl: media.url,
          mimeType: media.mimeType,
        })),
      )
      // A repeated poll delivers the same URLs. The (run, position) unique makes
      // that a no-op instead of a duplicate row per poll.
      .onConflictDoNothing({
        target: [providerRunOutputs.providerRunId, providerRunOutputs.position],
      });
  });
}

/**
 * Marks a run complete. The only path to `completed`.
 *
 * Refuses when any output is still un-ingested, which is what makes "never show
 * completed until the asset is in Virally storage" an invariant rather than a
 * convention someone has to remember at each call site.
 */
export async function completeRun(
  scope: TenantScope,
  runId: string,
  actualInternalCents: number,
): Promise<void> {
  assertScope(scope);

  await db.transaction(async (tx) => {
    const outputs = await tx
      .select({
        id: providerRunOutputs.id,
        mediaAssetId: providerRunOutputs.mediaAssetId,
      })
      .from(providerRunOutputs)
      .where(
        and(
          eq(providerRunOutputs.providerRunId, runId),
          eq(providerRunOutputs.workspaceId, scope.workspaceId),
        ),
      );

    if (outputs.length === 0) {
      throw new Error(`Run ${runId} has no outputs and cannot be completed.`);
    }
    const pending = outputs.filter((output) => output.mediaAssetId === null);
    if (pending.length > 0) {
      throw new Error(
        `Run ${runId} has ${pending.length} output(s) not yet copied into Virally storage. A run is not complete until every asset is ingested.`,
      );
    }

    await tx
      .update(providerRuns)
      .set({
        state: "completed",
        progress: 100,
        actualInternalCents: Math.max(0, Math.trunc(actualInternalCents)),
        outputAssetIds: outputs.map((output) => output.mediaAssetId),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(providerRuns.id, runId),
          eq(providerRuns.workspaceId, scope.workspaceId),
          eq(providerRuns.organizationId, scope.organizationId),
          sql`${providerRuns.state} = 'downloading'`,
        ),
      );
  });
}

/** Runs still awaiting a provider result, for the poller. */
export async function listPendingRuns(
  scope: TenantScope,
  limit = 50,
): Promise<readonly ProviderRunRow[]> {
  assertScope(scope);
  const rows = await db
    .select(RUN_COLUMNS)
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.workspaceId, scope.workspaceId),
        eq(providerRuns.organizationId, scope.organizationId),
        sql`${providerRuns.state} in ('queued', 'submitted', 'generating', 'downloading')`,
      ),
    )
    .limit(limit);
  return rows.map(toRow);
}

const RUN_COLUMNS = {
  id: providerRuns.id,
  state: providerRuns.state,
  externalTaskId: providerRuns.externalTaskId,
  attemptCount: providerRuns.attemptCount,
  model: providerRuns.model,
  providerId: providerRuns.providerId,
  generationType: providerRuns.generationType,
  estimatedInternalCents: providerRuns.estimatedInternalCents,
  actualInternalCents: providerRuns.actualInternalCents,
} as const;

function toRow(row: {
  id: string;
  state: ProviderRunState;
  externalTaskId: string | null;
  attemptCount: number;
  model: string;
  providerId: string;
  generationType: GenerationKind;
  estimatedInternalCents: number;
  actualInternalCents: number | null;
}): ProviderRunRow {
  return row;
}
