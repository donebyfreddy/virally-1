"use server";

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/auth/session";
import { isAnyProviderConfigured } from "@/lib/creative/env";
import { tenantScope } from "@/lib/creative/scope";
import { isGenerationCapability, type GenerationCapability } from "@/lib/creative/capabilities";
import type { ProductionMode } from "@/lib/creative/types";
import { ForbiddenError, assertWorkspacePermission } from "@/lib/db/authorization";
import { resolveTenantContext } from "@/lib/tenant/context";
import type { AspectRatio } from "@/types/database";
import { readActiveGenerations, readGenerationStatus, type GenerationStatus } from "./data";
import {
  AUDIO_REFERENCE_KINDS,
  IMAGE_REFERENCE_KINDS,
  resolveReferences,
} from "./references";
import { startGeneration, type StartOutcome } from "./service";
import type { LikenessConsent } from "./safety";

/**
 * Server actions for the generation studios.
 *
 * This is a trust boundary. Everything arriving here came from a browser and is
 * hostile until proven otherwise, so each action re-establishes three things
 * from the server's own state rather than from its arguments:
 *
 *   who   — `readSession()`, never a user id in the payload
 *   where — `resolveTenantContext()`, never a workspace id in the payload
 *   may   — `assertWorkspacePermission()`, never a role in the payload
 *
 * The brief's rule that cost values must not be trusted from the browser is a
 * special case of the same principle, and it is enforced by omission: there is
 * no cost field in any input type below. The estimate the user saw is
 * recomputed server-side from the model that will actually run, and if the two
 * disagree the server's figure is the one charged.
 */

export type StartGenerationInput = {
  capability: string;
  prompt: string;
  negativePrompt?: string;
  mode: ProductionMode;
  ratio?: AspectRatio;
  resolution?: string;
  durationSeconds?: number;
  /**
   * Library asset IDs, NOT URLs.
   *
   * The client never supplies a URL. An id cannot express a host, so there is
   * no string for a caller to shape into an SSRF; resolution happens
   * server-side against rows the workspace demonstrably owns.
   */
  referenceAssetIds?: string[];
  /** Drives a lip-sync generation. Also an asset id. */
  audioAssetId?: string | null;
  modelId?: string | null;
  preferredProviderId?: string | null;
  campaignId?: string | null;
  contentItemId?: string | null;
  shotId?: string | null;
  /** Client-generated, so a double-submit is one generation. */
  idempotencyKey?: string;
  /** Present only for consent-gated capabilities. */
  consentConfirmed?: boolean;
  consentNote?: string;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      kind?: string;
      /** Credits missing, on a `credits` refusal. Sizes the top-up offer. */
      shortfall?: number;
      /**
       * How long to wait, on a `limit` refusal.
       *
       * Carried through rather than dropped: a retry button with no wait time
       * invites an immediate second press that hits the same ceiling, which
       * reads to the user as the button being broken.
       */
      retryAfterMs?: number | null;
    };

/**
 * What a successful start returns.
 *
 * `refused` is deliberately excluded. The action converts a refusal into
 * `{ ok: false }` with the reason and kind lifted out, so a caller that has
 * already checked `ok` should not have to check `status` again — and, more
 * usefully, cannot forget to. Leaving `refused` in the success union made every
 * call site narrow twice and silently permitted reading `estimatedCredits` off
 * an outcome that has none.
 */
export type StartedOutcome = Extract<
  StartOutcome,
  { status: "started" } | { status: "already_started" }
>;

export async function startGenerationAction(
  input: StartGenerationInput,
): Promise<ActionResult<StartedOutcome>> {
  const gate = await authorise("content.create");
  if (!gate.ok) return gate;

  if (!isGenerationCapability(input.capability)) {
    return { ok: false, error: "That is not a capability Virally can generate." };
  }
  const capability: GenerationCapability = input.capability;

  const prompt = (input.prompt ?? "").trim();
  // Bounded before anything else touches it. An unbounded prompt is a cheap way
  // to push a megabyte through the safety scanner and into a provider payload.
  if (prompt.length > 5_000) {
    return { ok: false, error: "The prompt is too long. Keep it under 5,000 characters." };
  }
  if (prompt.length === 0 && requiresPrompt(capability)) {
    return { ok: false, error: "Describe what you want to generate." };
  }

  const referenceIds = (input.referenceAssetIds ?? []).slice(0, 8);
  const resolved = await resolveReferences(gate.scope, referenceIds, {
    expectedKinds: IMAGE_REFERENCE_KINDS,
  });
  if (!resolved.ok) return { ok: false, error: resolved.reason };

  let audioUrl: string | undefined;
  if (input.audioAssetId) {
    const audio = await resolveReferences(gate.scope, [input.audioAssetId], {
      expectedKinds: AUDIO_REFERENCE_KINDS,
    });
    if (!audio.ok) return { ok: false, error: audio.reason };
    audioUrl = audio.references[0]?.url;
  }

  // Consent is reconstructed here rather than accepted as an object, so the
  // browser cannot supply an `acknowledgedBy` naming someone else.
  const consent: LikenessConsent | null = input.consentConfirmed
    ? {
        confirmed: true,
        acknowledgedBy: gate.context.user.id,
        acknowledgedAt: new Date(),
        note: input.consentNote?.slice(0, 500),
      }
    : null;

  const outcome = await startGeneration(gate.scope, {
    capability,
    prompt,
    negativePrompt: input.negativePrompt?.trim().slice(0, 2_000) ?? null,
    mode: input.mode,
    ratio: input.ratio,
    resolution: input.resolution,
    durationSeconds: clampDuration(input.durationSeconds),
    referenceImageUrls: resolved.references.map((reference) => reference.url),
    audioUrl,
    modelId: input.modelId ?? null,
    preferredProviderId: input.preferredProviderId ?? null,
    consent,
    campaignId: input.campaignId ?? null,
    contentItemId: input.contentItemId ?? null,
    shotId: input.shotId ?? null,
    idempotencyKey: input.idempotencyKey,
    createdBy: gate.context.user.id,
    /**
     * The mock runs only when NO real provider is configured.
     *
     * Two failure modes to avoid, in opposite directions. Hard `false` means a
     * deployment with no keys refuses every generation, which breaks the
     * brief's requirement that the whole product stay exercisable without
     * credentials — and makes the first-run experience a wall. Hard `true`
     * means a configured deployment whose provider is briefly down silently
     * hands a paying user a demo asset, which is worse than failing.
     *
     * Keyed on configuration rather than on outcome, so the mock is a property
     * of the environment and never a degradation path for a request that was
     * supposed to cost money. Everything it produces still carries the demo
     * label all the way to the asset row.
     */
    allowMockFallback: !isAnyProviderConfigured(),
  });

  if (outcome.status === "refused") {
    return {
      ok: false,
      error: outcome.reason,
      kind: outcome.kind,
      shortfall: outcome.shortfall,
      retryAfterMs: outcome.retryAfterMs,
    };
  }

  revalidatePath("/app/generate");
  if (input.campaignId) revalidatePath(`/app/campaigns/${input.campaignId}`);
  if (input.contentItemId) revalidatePath(`/app/content/${input.contentItemId}`);

  return { ok: true, data: outcome };
}

/**
 * Polls one generation.
 *
 * Called from the client on an interval. The interval itself is the client's
 * business, but two rules are enforced here rather than there: a terminal run
 * returns immediately so a stuck client cannot keep the query hot, and the
 * result is scoped, so a run id guessed from another workspace returns null
 * rather than someone else's prompt.
 */
export async function readGenerationAction(
  runId: string,
): Promise<ActionResult<GenerationStatus | null>> {
  const gate = await authorise("analytics.view");
  if (!gate.ok) return gate;
  return { ok: true, data: await readGenerationStatus(gate.scope, runId) };
}

export async function readActiveGenerationsAction(): Promise<
  ActionResult<readonly GenerationStatus[]>
> {
  const gate = await authorise("analytics.view");
  if (!gate.ok) return gate;
  return { ok: true, data: await readActiveGenerations(gate.scope) };
}

/**
 * Regenerates a single shot.
 *
 * A thin wrapper rather than a separate path, so "regenerating one shot must
 * not regenerate the entire campaign" is true by construction: this starts one
 * generation attached to one shot, and there is no code here that could reach
 * the campaign's other shots even by mistake.
 */
export async function regenerateShotAction(
  input: StartGenerationInput & { shotId: string },
): Promise<ActionResult<StartedOutcome>> {
  return startGenerationAction({
    ...input,
    // A fresh key on every press, because the user is explicitly asking for a
    // different result. Deriving one from the request would make the second
    // press return the first attempt's output, which is the opposite of what
    // "regenerate" means.
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
  });
}

// --- Authorisation ---------------------------------------------------------------

type Gate =
  | {
      ok: true;
      scope: ReturnType<typeof tenantScope>;
      context: Awaited<ReturnType<typeof resolveTenantContext>> extends infer R
        ? R extends { status: "ok"; context: infer C }
          ? C
          : never
        : never;
    }
  | { ok: false; error: string };

/**
 * Establishes who is calling, where, and whether they may.
 *
 * Returns a refusal rather than throwing or redirecting. A server action's
 * caller is a fetch from a client component, and a redirect there produces a
 * confusing partial navigation instead of a message the user can read.
 */
async function authorise(permission: Parameters<typeof assertWorkspacePermission>[2]): Promise<Gate> {
  const session = await readSession();
  if (session.status !== "authenticated") {
    return { ok: false, error: "Sign in to generate." };
  }

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") {
    return { ok: false, error: "This workspace is not ready yet." };
  }

  try {
    await assertWorkspacePermission(
      session.user.id,
      resolution.context.workspaceId,
      permission,
    );
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You do not have permission to generate in this workspace." };
    }
    throw error;
  }

  return {
    ok: true,
    scope: tenantScope(resolution.context.organizationId, resolution.context.workspaceId),
    context: resolution.context,
  };
}

// --- Input hygiene ---------------------------------------------------------------

/** Capabilities whose model discards a prompt rather than requiring one. */
function requiresPrompt(capability: GenerationCapability): boolean {
  return capability !== "lip-sync" && capability !== "upscale";
}

/**
 * Bounds a requested duration.
 *
 * Clamped rather than rejected: a browser sending 600 seconds is far more
 * likely a slider bug than an attack, and the model's own catalogue entry
 * quantises it properly afterwards. The ceiling exists so a single request
 * cannot quote hundreds of clips.
 */
function clampDuration(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.round(value), 1), 120);
}
