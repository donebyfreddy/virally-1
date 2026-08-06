import type { AspectRatio } from "@/types/database";
import type { GenerationKind, ProductionMode } from "./types";

/**
 * What a model can be asked to do, and what Virally knows about it.
 *
 * This module exists because `GenerationKind` — image | video | audio — turned
 * out to be too coarse the moment a second provider arrived. It answers "what
 * sort of file comes out", which is what the storage and Remotion layers need,
 * and says nothing about what goes in. But "generate an image from a prompt"
 * and "restyle this image using three reference photos" are the same kind and
 * completely different requests: different models serve them, different inputs
 * are mandatory, and a router that cannot tell them apart will happily send a
 * text-to-image model a reference image it will ignore, then bill for it.
 *
 * So capability is the routing dimension and kind is the output dimension.
 * Neither replaces the other and both are recorded on every run.
 */

// --- Capability -------------------------------------------------------------

export type GenerationCapability =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "image-to-video"
  | "audio"
  | "music"
  | "sound-effect"
  | "lip-sync"
  | "upscale";

export const GENERATION_CAPABILITIES: readonly GenerationCapability[] = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "image-to-video",
  "audio",
  "music",
  "sound-effect",
  "lip-sync",
  "upscale",
] as const;

export function isGenerationCapability(value: unknown): value is GenerationCapability {
  return (
    typeof value === "string" &&
    GENERATION_CAPABILITIES.includes(value as GenerationCapability)
  );
}

/**
 * The output kind each capability produces.
 *
 * Total rather than a lookup that can miss: adding a capability without deciding
 * what kind of file it yields would leave `ingest` guessing at a MIME type and
 * `media_assets.kind` unset, so the compiler is made to ask the question.
 */
const CAPABILITY_KIND: Readonly<Record<GenerationCapability, GenerationKind>> = {
  "text-to-image": "image",
  "image-to-image": "image",
  "text-to-video": "video",
  "image-to-video": "video",
  audio: "audio",
  music: "audio",
  "sound-effect": "audio",
  // Lip-sync consumes audio and emits video. Classifying it by its input is the
  // obvious mistake here and would route its output into the audio bucket.
  "lip-sync": "video",
  // Upscale is image-only today. When a video upscaler is catalogued this stops
  // being a constant and becomes a per-model field.
  upscale: "image",
};

export function kindForCapability(capability: GenerationCapability): GenerationKind {
  return CAPABILITY_KIND[capability];
}

/** Capabilities that produce a given output kind. For kind-shaped call sites. */
export function capabilitiesForKind(kind: GenerationKind): readonly GenerationCapability[] {
  return GENERATION_CAPABILITIES.filter((capability) => CAPABILITY_KIND[capability] === kind);
}

// --- Inputs -----------------------------------------------------------------

export type GenerationInputType = "text" | "image" | "video" | "audio";

/**
 * Inputs a capability cannot run without.
 *
 * Checked before a provider is called, so a missing portrait fails as a
 * validation error the user can act on rather than as a provider 400 three
 * layers away with the vendor's own wording.
 *
 * `text` is absent from several entries on purpose: a lip-sync or upscale
 * request has no meaningful prompt, and demanding one would make the UI ask for
 * something the model discards.
 */
const CAPABILITY_REQUIRED_INPUTS: Readonly<
  Record<GenerationCapability, readonly GenerationInputType[]>
> = {
  "text-to-image": ["text"],
  "image-to-image": ["image"],
  "text-to-video": ["text"],
  "image-to-video": ["image"],
  audio: ["text"],
  music: ["text"],
  "sound-effect": ["text"],
  "lip-sync": ["audio"],
  upscale: ["image"],
};

export function requiredInputsFor(
  capability: GenerationCapability,
): readonly GenerationInputType[] {
  return CAPABILITY_REQUIRED_INPUTS[capability];
}

/**
 * Capabilities that may not be run against a real person without confirmed
 * authorization.
 *
 * The brief forbids cloning a likeness or voice without the user confirming
 * they hold the rights. That gate is enforced at submit time; this is the list
 * it consults, kept next to the taxonomy so adding a capability forces the
 * question rather than defaulting to "no consent needed".
 */
export const CONSENT_GATED_CAPABILITIES: readonly GenerationCapability[] = ["lip-sync"];

export function requiresConsent(capability: GenerationCapability): boolean {
  return CONSENT_GATED_CAPABILITIES.includes(capability);
}

// --- Model --------------------------------------------------------------------

/**
 * A model, normalized across providers.
 *
 * This is the shape the catalogue table stores and the shape the UI renders. It
 * is deliberately data — no model id may appear in JSX, and every constraint the
 * form needs to enforce (which ratios, which durations, whether a seed field
 * should be shown at all) is a field here rather than a conditional keyed on an
 * id somewhere in a component.
 *
 * `externalModelId` is separate from `id` because they change independently:
 * `id` is Virally's stable handle, recorded on historic runs forever, while the
 * provider's own identifier can be renamed under us. Collapsing them would make
 * a vendor rename rewrite history.
 */
export type GenerationModel = {
  /** Virally's stable id, e.g. "fal.flux-dev". Recorded on every run. */
  id: string;
  providerId: string;
  /**
   * The provider's own identifier or endpoint slug.
   *
   * For fal this is the model's queue endpoint id (`fal-ai/flux/dev`), which is
   * NOT derivable from the model name — `fal-ai/flux/dev` and
   * `fal-ai/flux-pro/kontext` share nothing predictable. For Magnific it is the
   * full endpoint path. Stored, never constructed.
   */
  externalModelId: string;
  name: string;
  description?: string;

  capabilities: readonly GenerationCapability[];
  inputTypes: readonly GenerationInputType[];

  /**
   * How many reference images the model accepts. Undefined means none.
   *
   * The multi-reference UI reads this to decide how many upload slots to render,
   * and submission rejects an over-count before it reaches the provider.
   */
  maxReferenceImages?: number;

  /**
   * Constraints, in Virally's vocabulary rather than the provider's.
   *
   * An empty array means unconstrained, not unknown. A model that accepts any
   * duration and one whose durations were never catalogued both render as a free
   * input, which is the right behaviour for the former and a catalogue bug for
   * the latter — caught by the seed test, not by a runtime guess.
   */
  supportedAspectRatios: readonly AspectRatio[];
  supportedDurations: readonly number[];
  supportedResolutions: readonly string[];

  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  /** Whether the model can emit its own audio track alongside video. */
  supportsAudio: boolean;

  /** Production modes this model is offered for. */
  modes: readonly ProductionMode[];

  /**
   * Virally's cost basis, in integer cents per unit generated.
   *
   * Always a configured figure for fal, which publishes no prices at all.
   * Undefined means the model is catalogued but unpriced, and an unpriced model
   * is never routed to — the estimator cannot quote it honestly and the credit
   * reservation would have nothing to reserve against.
   */
  estimatedCentsPerUnit?: number;

  enabled: boolean;
  /**
   * Set when the provider has retired the model.
   *
   * Distinct from `enabled: false`, which is an operator switching something off
   * and can be reversed. A deprecated model stays in the catalogue so historic
   * runs still resolve a name, but nothing new routes to it.
   */
  deprecatedAt?: Date;

  metadata?: Record<string, unknown>;
};

/** A model is routable only if it is switched on, not retired, and priced. */
export function isRoutable(model: GenerationModel): boolean {
  return (
    model.enabled && model.deprecatedAt === undefined && model.estimatedCentsPerUnit !== undefined
  );
}

export function supportsCapability(
  model: GenerationModel,
  capability: GenerationCapability,
): boolean {
  return model.capabilities.includes(capability);
}

/**
 * Whether a model can serve a request, and if not, why.
 *
 * Returns prose aimed at the user rather than a boolean, because the router
 * records the reason on the run row and the UI shows it. "Kling produces 5s or
 * 10s clips" is actionable; "unsupported" is not.
 */
export function checkModelFit(
  model: GenerationModel,
  request: {
    capability: GenerationCapability;
    mode?: ProductionMode;
    ratio?: AspectRatio;
    durationSeconds?: number;
    resolution?: string;
    referenceImageCount?: number;
  },
): { fits: true } | { fits: false; reason: string } {
  if (!model.enabled) {
    return { fits: false, reason: `${model.name} is currently switched off.` };
  }
  if (model.deprecatedAt !== undefined) {
    return { fits: false, reason: `${model.name} has been retired by its provider.` };
  }
  if (model.estimatedCentsPerUnit === undefined) {
    return { fits: false, reason: `${model.name} has no configured price, so it cannot be quoted.` };
  }
  if (!supportsCapability(model, request.capability)) {
    return { fits: false, reason: `${model.name} does not do ${request.capability}.` };
  }
  if (request.mode !== undefined && !model.modes.includes(request.mode)) {
    return { fits: false, reason: `${model.name} is not offered in ${request.mode} mode.` };
  }
  if (
    request.ratio !== undefined &&
    model.supportedAspectRatios.length > 0 &&
    !model.supportedAspectRatios.includes(request.ratio)
  ) {
    return {
      fits: false,
      reason: `${model.name} produces ${model.supportedAspectRatios.join(", ")} — not ${request.ratio}.`,
    };
  }
  if (
    request.durationSeconds !== undefined &&
    model.supportedDurations.length > 0 &&
    // Not an exact-match test: a shorter request is served by rounding up to the
    // next allowed duration, which is a fit. Only exceeding the longest clip the
    // model can produce is a genuine refusal.
    request.durationSeconds > Math.max(...model.supportedDurations)
  ) {
    return {
      fits: false,
      reason: `${model.name} produces clips of ${model.supportedDurations.join("s or ")}s — not ${request.durationSeconds}s.`,
    };
  }
  if (
    request.resolution !== undefined &&
    model.supportedResolutions.length > 0 &&
    !model.supportedResolutions.includes(request.resolution)
  ) {
    return {
      fits: false,
      reason: `${model.name} outputs ${model.supportedResolutions.join(", ")} — not ${request.resolution}.`,
    };
  }
  if (request.referenceImageCount !== undefined && request.referenceImageCount > 0) {
    const allowed = model.maxReferenceImages ?? 0;
    if (allowed === 0) {
      return { fits: false, reason: `${model.name} does not accept reference images.` };
    }
    if (request.referenceImageCount > allowed) {
      const plural = allowed === 1 ? "image" : "images";
      return {
        fits: false,
        reason: `${model.name} accepts up to ${allowed} reference ${plural}, and ${request.referenceImageCount} were supplied.`,
      };
    }
  }
  return { fits: true };
}

/**
 * Snaps a requested duration onto one the model accepts.
 *
 * Rounds UP and clamps to the maximum. Rounding down would silently truncate a
 * shot the storyboard timed, desynchronising the Remotion composition against
 * its own script — a defect that survives every technical check and is only
 * noticed on watching the result.
 */
export function quantiseDuration(model: GenerationModel, requestedSeconds: number): number {
  if (model.supportedDurations.length === 0) return Math.max(1, Math.round(requestedSeconds));
  const ascending = [...model.supportedDurations].sort((a, b) => a - b);
  const longest = ascending[ascending.length - 1] ?? 1;
  return ascending.find((allowed) => allowed >= requestedSeconds) ?? longest;
}
