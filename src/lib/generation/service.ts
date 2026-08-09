import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, auditLogs, creditReservations, providerRuns } from "@/lib/db/schema";
import {
  audioKindForCapability,
  kindForCapability,
  type GenerationCapability,
  type GenerationModel,
} from "@/lib/creative/capabilities";
import { InsufficientCreditsError, reserveCredits } from "@/lib/creative/credits";
import { attachRunToReservation } from "@/lib/creative/pipeline";
import { getProviderRouter } from "@/lib/creative/router";
import type { TenantScope } from "@/lib/creative/scope";
import { assertScope } from "@/lib/creative/scope";
import type {
  AudioGenerationInput,
  CreativeGenerationProvider,
  GenerationQuality,
  ImageGenerationInput,
  ProductionMode,
  VideoGenerationInput,
} from "@/lib/creative/types";
import { enqueueJob, type JobType } from "@/lib/jobs/queue";
import { checkGenerationLimits } from "./limits";
import { checkGenerationSafety, type LikenessConsent } from "./safety";

/**
 * The single entry point for starting a generation.
 *
 * Everything that wants to generate — the studios, a campaign shot regenerate,
 * a workflow step — comes through here, and the ordering below is the whole
 * reason it exists as one function rather than as guidance:
 *
 *   1. safety      — refuse before spending anything
 *   2. route       — pick a provider and model, so a cost can be quoted
 *   3. limits      — refuse before reserving, so a throttled request costs nothing
 *   4. estimate    — a real figure from the chosen model
 *   5. reserve     — credits withheld BEFORE any provider is called
 *   6. enqueue     — durable job; the worker submits and polls
 *   7. attach      — link run to reservation once the run row exists
 *
 * Each step is cheap-before-expensive and refusable-before-committed. Reversing
 * any adjacent pair breaks something specific: reserving before checking limits
 * charges a user for a request that will be rejected; estimating before routing
 * quotes a model that will not run it; submitting before reserving means a
 * provider bill with no credits behind it.
 *
 * The provider is NOT called here. Submission happens in the worker, so a slow
 * vendor cannot hold a request handler open and a user closing the tab cannot
 * abandon work they have been charged for.
 */

export type GenerationRequest = {
  capability: GenerationCapability;
  prompt: string;
  negativePrompt?: string | null;
  mode: ProductionMode;
  quality?: GenerationQuality;

  /** Format. Ignored for capabilities that do not take one. */
  ratio?: ImageGenerationInput["ratio"];
  resolution?: string;
  durationSeconds?: number;

  /** Publicly reachable URLs. Validated by the caller before they reach here. */
  referenceImageUrls?: readonly string[];
  audioUrl?: string;

  /** Pin a model. Absent means the router picks on capability and price. */
  modelId?: string | null;
  /** Pin a provider. Absent means automatic. */
  preferredProviderId?: string | null;
  /** Refuse instead of falling through when the pinned provider cannot serve the request. */
  requirePreferredProvider?: boolean;

  /** Required for consent-gated capabilities. */
  consent?: LikenessConsent | null;

  /** Attachment. Every one optional, per the brief. */
  campaignId?: string | null;
  contentItemId?: string | null;
  shotId?: string | null;

  /**
   * Supplied by the caller so a double-clicked button is one generation.
   *
   * Optional here and derived from the request when absent, because a caller
   * that forgets one should still get idempotency — a required field that is
   * easy to fill with `randomUUID()` provides none.
   */
  idempotencyKey?: string;

  createdBy?: string | null;
  /** True only in development and tests. Never for a paid generation. */
  allowMockFallback?: boolean;
  /**
   * Existing batch hold created by a trusted server-side orchestrator.
   * When present this step must not create another per-asset hold.
   */
  reservationId?: string;
};

export type StartOutcome =
  | {
      status: "started";
      jobId: string;
      reservationId: string;
      estimatedCredits: number;
      model: GenerationModel | null;
      providerId: string;
      isMock: boolean;
      /** Why this provider and model. Shown in the generation summary. */
      routingReason: string;
    }
  /** The same idempotency key was already accepted. Nothing new was started. */
  | { status: "already_started"; jobId: string }
  | {
      status: "refused";
      /** Distinguishes the four reasons so the UI can respond differently. */
      kind: "policy" | "consent" | "limit" | "credits" | "unavailable";
      reason: string;
      /** Populated for `credits`, so the UI can offer a top-up of the right size. */
      shortfall?: number;
      retryAfterMs?: number | null;
    };

export async function startGeneration(
  scope: TenantScope,
  request: GenerationRequest,
): Promise<StartOutcome> {
  assertScope(scope);

  // 1 — Safety. First, and before anything is spent or reserved.
  const safety = checkGenerationSafety({
    capability: request.capability,
    prompt: request.prompt,
    negativePrompt: request.negativePrompt,
    consent: request.consent,
  });
  if (!safety.ok) {
    // Recorded even though nothing happened. A refusal is exactly the event an
    // abuse investigation needs, and one that leaves no trace is invisible
    // precisely when it matters.
    await recordRefusal(scope, request, safety);
    return { status: "refused", kind: safety.kind, reason: safety.message };
  }

  // 2 — Route. Async so the Neon catalogue decides, not the shipped array:
  // a model an operator disabled an hour ago must not be selected.
  const router = getProviderRouter();
  const decision = await router.routeAsync({
    kind: kindForCapability(request.capability),
    capability: request.capability,
    mode: request.mode,
    ratio: request.ratio,
    durationSeconds: request.durationSeconds,
    resolution: request.resolution,
    referenceImageCount: request.referenceImageUrls?.length ?? 0,
    preferredProviderId: request.preferredProviderId ?? null,
    allowMockFallback: request.allowMockFallback ?? false,
  });

  if (!decision.ok) {
    return { status: "refused", kind: "unavailable", reason: decision.reason };
  }

  if (
    request.requirePreferredProvider &&
    request.preferredProviderId &&
    decision.provider.id !== request.preferredProviderId
  ) {
    return {
      status: "refused",
      kind: "unavailable",
      reason: `${request.preferredProviderId} is required for this generation but cannot serve the request.`,
    };
  }

  const provider = decision.provider;
  const candidates = await router.availableModels(request.capability, request.mode);
  const model = resolveModel(candidates, decision.model ?? null, request.modelId ?? null);

  // 3 — Limits. Before the reservation, so a throttled request costs nothing.
  const limit = await checkGenerationLimits(scope, provider.id, request.capability);
  if (!limit.allowed) {
    return {
      status: "refused",
      kind: "limit",
      reason: limit.reason,
      retryAfterMs: limit.retryAfterMs,
    };
  }

  // 4 — Estimate, from the provider that will actually run it.
  const providerInput = buildProviderInput(request, model);
  const estimate = await estimateFor(provider, request.capability, providerInput);

  // 5 — Reserve. The user's credits are withheld before a provider is called,
  // which is what makes "charged for a generation that never ran" impossible
  // rather than merely unlikely.
  const idempotencyKey = request.idempotencyKey ?? deriveIdempotencyKey(scope, request);

  let reservationId = request.reservationId;
  if (reservationId) {
    const [hold] = await db
      .select({ id: creditReservations.id })
      .from(creditReservations)
      .where(
        and(
          eq(creditReservations.id, reservationId),
          eq(creditReservations.organizationId, scope.organizationId),
          eq(creditReservations.workspaceId, scope.workspaceId),
          eq(creditReservations.state, "held"),
        ),
      )
      .limit(1);
    if (!hold) {
      return {
        status: "refused",
        kind: "credits",
        reason: "The Production Credit reservation is no longer active.",
      };
    }
  }
  if (!reservationId) {
    try {
      const reservation = await reserveCredits({
        scope,
        idempotencyKey: `gen:${idempotencyKey}`,
        // At least one credit even for a free mock run, because `reserveCredits`
        // refuses a zero reservation and a generation with no hold has nothing to
        // settle against.
        credits: Math.max(1, estimate.internalCredits),
        purpose: request.shotId ? "regeneration" : "single_generation",
        campaignId: request.campaignId ?? null,
        createdBy: request.createdBy ?? null,
      });
      reservationId = reservation.id;
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        return {
          status: "refused",
          kind: "credits",
          reason: `This generation needs ${estimate.internalCredits} Production Credits and the workspace has ${error.available}.`,
          shortfall: error.required - error.available,
        };
      }
      throw error;
    }
  }

  // 6 — Enqueue. The worker submits and polls; nothing long-running happens in
  // this request.
  const { jobId, created } = await enqueueJob({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    userId: request.createdBy ?? null,
    type: jobTypeFor(request.capability),
    idempotencyKey: `gen:${idempotencyKey}`,
    payload: {
      kind: kindForCapability(request.capability),
      capability: request.capability,
      input: { ...providerInput, idempotencyKey },
      reservationId,
      modelId: model?.id ?? null,
      preferredProviderId: provider.id,
      campaignId: request.campaignId ?? null,
      contentItemId: request.contentItemId ?? null,
      shotId: request.shotId ?? null,
      allowMockFallback: request.allowMockFallback ?? false,
    },
    // Regenerating one shot is interactive and should not queue behind a
    // hundred-clip campaign batch.
    priority: request.shotId ? 3 : 5,
  });

  if (!created) return { status: "already_started", jobId };

  await recordStarted(scope, request, {
    jobId,
    providerId: provider.id,
    modelId: model?.id ?? null,
    credits: estimate.internalCredits,
  });

  return {
    status: "started",
    jobId,
    reservationId,
    estimatedCredits: estimate.internalCredits,
    model,
    providerId: provider.id,
    isMock: decision.isMock,
    routingReason: decision.reason,
  };
}

/**
 * Links a run to its reservation once the worker has created it.
 *
 * Called from the job handler rather than here, because the run row does not
 * exist until submission — and the reservation must exist before it. This is
 * the second half of that ordering.
 */
export async function linkRunToReservation(
  scope: TenantScope,
  reservationId: string,
  runId: string,
): Promise<void> {
  await attachRunToReservation(scope, reservationId, runId);
  await db
    .update(providerRuns)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(providerRuns.id, runId),
        eq(providerRuns.workspaceId, scope.workspaceId),
      ),
    );
}

// --- Helpers --------------------------------------------------------------------

/**
 * The model the request will run on.
 *
 * A pinned id is honoured only if it names a model the router already
 * considered routable for this capability, mode and provider. Only the ID is
 * accepted from the caller — never metadata. A browser that could supply a
 * model's price would be deciding what a generation costs, which the brief
 * forbids in as many words, and a browser that could name any model by id would
 * reach the ones an operator disabled.
 *
 * Falling back to the router's choice rather than refusing an unknown pin is
 * deliberate: the usual cause is a model retired between the page rendering and
 * the user pressing Generate, and failing that request would be a worse
 * experience than quietly running the equivalent current model. The response
 * reports which model actually ran, so the substitution is visible.
 */
function resolveModel(
  candidates: readonly GenerationModel[],
  routed: GenerationModel | null,
  pinnedId: string | null,
): GenerationModel | null {
  if (!pinnedId) return routed;
  return candidates.find((model) => model.id === pinnedId) ?? routed;
}

type ProviderInput = ImageGenerationInput | VideoGenerationInput | AudioGenerationInput;

/**
 * Shapes the capability-neutral request into the provider input type.
 *
 * Reference images are positional: the first is the structure or first-frame
 * reference and the second is the style reference. That convention is fixed
 * here rather than at each call site so the studios and the workflow engine
 * cannot disagree about which slot means what.
 */
function buildProviderInput(
  request: GenerationRequest,
  model: GenerationModel | null,
): ProviderInput {
  const base = {
    idempotencyKey: request.idempotencyKey ?? "",
    prompt: request.prompt,
    negativePrompt: request.negativePrompt ?? undefined,
    mode: request.mode,
    quality: request.quality ?? "standard",
  } as const;

  const kind = kindForCapability(request.capability);
  const references = request.referenceImageUrls ?? [];

  if (kind === "image") {
    return {
      ...base,
      ratio: request.ratio ?? "1:1",
      resolution: normaliseImageResolution(request.resolution),
      structureReferenceUrl: references[0],
      styleReferenceUrl: references[1],
    } satisfies ImageGenerationInput;
  }

  if (kind === "video") {
    return {
      ...base,
      ratio: request.ratio ?? "9:16",
      durationSeconds: request.durationSeconds ?? 5,
      referenceImageUrl: references[0],
      generateAudio: model?.supportsAudio ? true : undefined,
    } satisfies VideoGenerationInput;
  }

  return {
    ...base,
    kind: audioKindForCapability(request.capability),
    durationSeconds: request.durationSeconds ?? 10,
  } satisfies AudioGenerationInput;
}

/**
 * Narrows a free-text resolution onto the image input's tier union.
 *
 * Anything unrecognised becomes undefined rather than being passed through, so
 * a model-specific string like "1080p" arriving on an image request does not
 * reach a provider that only understands tiers.
 */
function normaliseImageResolution(value: string | undefined): "1k" | "2k" | "4k" | undefined {
  if (value === "1k" || value === "2k" || value === "4k") return value;
  return undefined;
}

async function estimateFor(
  provider: CreativeGenerationProvider,
  capability: GenerationCapability,
  input: ProviderInput,
) {
  const kind = kindForCapability(capability);
  if (kind === "image") return provider.estimateImage(input as ImageGenerationInput);
  if (kind === "video") return provider.estimateVideo(input as VideoGenerationInput);
  return provider.estimateAudio(input as AudioGenerationInput);
}

function jobTypeFor(capability: GenerationCapability): JobType {
  const kind = kindForCapability(capability);
  if (kind === "image") return "asset.image.generate";
  if (kind === "video") return "asset.video.generate";
  return "asset.voice.generate";
}

/**
 * Derives a stable key from the request when the caller supplied none.
 *
 * Hashed over the fields that determine the OUTPUT, so two identical submits
 * collapse into one and a submit that differs in any meaningful way does not.
 * `createdBy` is included: two users in a workspace independently asking for
 * the same thing are two generations, and silently giving the second user the
 * first's result would be surprising in a way that saves nobody anything.
 */
function deriveIdempotencyKey(scope: TenantScope, request: GenerationRequest): string {
  const material = JSON.stringify([
    scope.workspaceId,
    request.createdBy ?? "",
    request.capability,
    request.prompt,
    request.negativePrompt ?? "",
    request.mode,
    request.quality ?? "standard",
    request.ratio ?? "",
    request.resolution ?? "",
    request.durationSeconds ?? 0,
    request.referenceImageUrls ?? [],
    request.modelId ?? "",
    request.shotId ?? "",
  ]);
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/**
 * Records a policy or consent refusal.
 *
 * Written to `audit_logs` rather than `activity_events`: the activity feed is a
 * teammate-facing record of what the workspace did, and surfacing "someone
 * tried to generate prohibited content" there would be an accusation rendered
 * in a shared UI. The audit log is the right home — retained, queryable, and
 * not on anyone's dashboard.
 *
 * Best-effort. A logging failure must not turn a refusal into an allow.
 */
async function recordRefusal(
  scope: TenantScope,
  request: GenerationRequest,
  safety: Extract<ReturnType<typeof checkGenerationSafety>, { ok: false }>,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      actorId: request.createdBy ?? null,
      action: `generation.refused.${safety.kind}`,
      subjectType: "generation",
      subjectId: null,
      afterState: {
        capability: request.capability,
        category: safety.category,
        matched: safety.matched,
        // The prompt is recorded because an abuse review is meaningless without
        // it. Truncated because an audit row is not a place to store an essay.
        prompt: request.prompt.slice(0, 500),
      },
    });
  } catch (error) {
    console.error("[generation] Could not record a refusal.", error);
  }
}

async function recordStarted(
  scope: TenantScope,
  request: GenerationRequest,
  detail: { jobId: string; providerId: string; modelId: string | null; credits: number },
): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      actorId: request.createdBy ?? null,
      kind: "generation.started",
      subjectType: "job",
      subjectId: detail.jobId,
      summary: `Started a ${request.capability} generation`,
      metadata: {
        capability: request.capability,
        providerId: detail.providerId,
        modelId: detail.modelId,
        credits: detail.credits,
        campaignId: request.campaignId ?? null,
        shotId: request.shotId ?? null,
      },
    });
  } catch (error) {
    // Non-fatal. A missing feed entry is cosmetic; failing the generation over
    // it would not be.
    console.error("[generation] Could not record the activity event.", error);
  }
}

/** Exposed for the studios, which need a key before the user presses Generate. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
