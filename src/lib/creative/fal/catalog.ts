import type { AspectRatio } from "@/types/database";
import { isRoutable, type GenerationCapability, type GenerationModel } from "../capabilities";
import type { GenerationQuality, ProductionMode } from "../types";

/**
 * fal.ai's model surface, curated down to what Virally routes to.
 *
 * Endpoint ids and input/output schemas below were verified against
 * https://fal.ai/models/{id}/api at integration time, not inferred from a
 * pattern — fal's endpoint slugs are not derivable from a model's display name
 * (`fal-ai/flux/dev` vs `fal-ai/flux-pro/kontext` vs
 * `fal-ai/kling-video/v1.6/standard/text-to-video`), so only endpoints that were
 * individually confirmed are catalogued.
 *
 * Deliberately small: one model per core capability (image, image edit,
 * text-to-video, image-to-video, voiceover, music). fal hosts thousands;
 * cataloguing more without a per-model schema check would be a
 * plausible-looking submission that 404s or 422s the first time it runs.
 */

export const FAL_BASE_URL = "https://queue.fal.run";

/** Header fal authenticates with. The value is `Key ${apiKey}`, not a bearer token. */
export const FAL_AUTH_HEADER = "Authorization";

// --- Aspect ratios ----------------------------------------------------------

/**
 * fal names ratios the same way Virally does for every model that accepts a
 * ratio enum at all (Kling, Flux Kontext) — "16:9", not a synthetic label — so
 * this table is a restriction, not a translation.
 *
 * `4:5` and `custom` have no fal spelling on either catalogued model and map to
 * null rather than the nearest neighbour: a 4:5 request quietly served as 4:3
 * passes every technical check and is cropped wrong wherever it is published.
 */
const TO_FAL_RATIO: Readonly<Partial<Record<AspectRatio, string>>> = {
  "1:1": "1:1",
  "16:9": "16:9",
  "9:16": "9:16",
  "4:3": "4:3",
  "3:2": "3:2",
};

export function toFalAspectRatio(ratio: AspectRatio): string | null {
  return TO_FAL_RATIO[ratio] ?? null;
}

/**
 * `fal-ai/flux/dev` takes no ratio enum at all — it takes either a named
 * `image_size` preset or a literal `{width, height}`. The literal form is used
 * here because it is exact for every Virally ratio rather than only the six
 * fal happened to name, which is also why `flux-dev`'s catalogue entry declares
 * `supportedAspectRatios: []` — unconstrained, not unknown.
 *
 * 1440px on the long edge at each ratio's exact proportion, rounded to a
 * multiple of 8 (Flux's own latent-size requirement).
 */
const FLUX_DEV_LONG_EDGE = 1440;

export function falImageSize(ratio: AspectRatio): { width: number; height: number } {
  const [wRatio, hRatio] = RATIO_PARTS[ratio] ?? [1, 1];
  const longEdge = FLUX_DEV_LONG_EDGE;
  const shortEdge = Math.round((longEdge * Math.min(wRatio, hRatio)) / Math.max(wRatio, hRatio) / 8) * 8;
  const width = wRatio >= hRatio ? longEdge : shortEdge;
  const height = wRatio >= hRatio ? shortEdge : longEdge;
  return { width, height };
}

const RATIO_PARTS: Readonly<Partial<Record<AspectRatio, readonly [number, number]>>> = {
  "9:16": [9, 16],
  "4:5": [4, 5],
  "1:1": [1, 1],
  "16:9": [16, 9],
  "4:3": [4, 3],
  "3:2": [3, 2],
};

// --- Model metadata ----------------------------------------------------------

/** Payload-shaping quirks the adapter needs. Stored in GenerationModel.metadata. */
export type FalModelMetadata = {
  /** Payload key that receives the single reference image, when the model takes one. */
  imageField?: string;
  /** Shape of the model's completed result: `images[]`, a single `video`, or a single audio file. */
  outputField?: "images" | "video" | "audio";
  /** Result key holding the audio file, when `outputField` is `"audio"` — varies per model (Kokoro's `audio`, Stable Audio's `audio_file`). */
  audioField?: string;
  /** Payload key that receives the requested clip length in seconds, for models that take one (Stable Audio's `seconds_total`). */
  durationField?: string;
  family?: string;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const OUTPUT_FIELDS = new Set(["images", "video", "audio"]);

export function falMetadata(model: GenerationModel): FalModelMetadata {
  const raw = model.metadata;
  if (raw === undefined) return {};
  const outputField = raw.outputField;
  return {
    imageField: readString(raw.imageField),
    outputField:
      typeof outputField === "string" && OUTPUT_FIELDS.has(outputField)
        ? (outputField as FalModelMetadata["outputField"])
        : undefined,
    audioField: readString(raw.audioField),
    durationField: readString(raw.durationField),
    family: readString(raw.family),
  };
}

// --- Models -------------------------------------------------------------------

/**
 * Virally's curated fal catalogue. Seed data for `generation_models`.
 *
 * EVERY `estimatedCentsPerUnit` BELOW IS A VIRALLY-CONFIGURED ESTIMATE. fal
 * bills per-second or per-megapixel depending on the model and does not return
 * a price in the queue response, so there is nothing to copy and nothing to
 * reconcile against at request time — the same basis Magnific and the removed
 * MuAPI catalogue used. Figures are ordered so the relative tiers are right
 * even where the absolute values drift; see fal's own pricing page to true
 * these up before relying on them for margin reporting.
 */
export const FAL_MODELS: readonly GenerationModel[] = [
  {
    id: "fal.flux-dev",
    providerId: "fal",
    externalModelId: "fal-ai/flux/dev",
    name: "Flux Dev",
    description: "12B-parameter Flux tier — the default for storyboard frames and stills.",
    capabilities: ["text-to-image"],
    inputTypes: ["text"],
    // Unconstrained: sized by an exact {width, height} computed from the
    // requested ratio (see `falImageSize`), not a named preset.
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsAudio: false,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 4,
    enabled: true,
    metadata: { family: "flux", outputField: "images" },
  },
  {
    id: "fal.flux-pro-kontext",
    providerId: "fal",
    externalModelId: "fal-ai/flux-pro/kontext",
    name: "Flux Pro Kontext",
    description: "Targeted single-reference edits that preserve the rest of the frame.",
    capabilities: ["image-to-image"],
    inputTypes: ["text", "image"],
    supportedAspectRatios: ["1:1", "4:3", "9:16", "16:9", "3:2"],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 7,
    enabled: true,
    metadata: { family: "flux-kontext", imageField: "image_url", outputField: "images" },
  },
  {
    id: "fal.kling-v1.6-text-to-video",
    providerId: "fal",
    externalModelId: "fal-ai/kling-video/v1.6/standard/text-to-video",
    name: "Kling 1.6 Standard",
    description: "Kling's standard tier — controlled camera moves at 5s or 10s.",
    capabilities: ["text-to-video"],
    inputTypes: ["text"],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportedDurations: [5, 10],
    supportedResolutions: [],
    supportsNegativePrompt: true,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 100,
    enabled: true,
    metadata: { family: "kling", outputField: "video" },
  },
  {
    id: "fal.kling-v1.6-image-to-video",
    providerId: "fal",
    externalModelId: "fal-ai/kling-video/v1.6/standard/image-to-video",
    name: "Kling 1.6 Standard (Image to Video)",
    description: "Animates a first frame with controlled camera moves at 5s or 10s.",
    capabilities: ["image-to-video"],
    inputTypes: ["text", "image"],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportedDurations: [5, 10],
    supportedResolutions: [],
    supportsNegativePrompt: true,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 130,
    enabled: true,
    metadata: { family: "kling", imageField: "image_url", outputField: "video" },
  },
  {
    id: "fal.kokoro-tts",
    providerId: "fal",
    externalModelId: "fal-ai/kokoro/american-english",
    name: "Kokoro TTS",
    description: "Open-weights text-to-speech — the default for storyboard voiceovers.",
    capabilities: ["audio"],
    inputTypes: ["text"],
    supportedAspectRatios: [],
    // Driven by the length of the script text, not a requested clip length —
    // Kokoro's own API takes no duration parameter at all.
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid", "cinematic"],
    // fal bills Kokoro at $0.02 per 1,000 characters — a typical 20-30s
    // voiceover script runs a few hundred characters, so this is a flat
    // per-run estimate rather than a per-character one, matching how every
    // other model here is priced (see the module doc comment).
    estimatedCentsPerUnit: 3,
    enabled: true,
    metadata: { family: "kokoro", outputField: "audio", audioField: "audio" },
  },
  {
    id: "fal.stable-audio",
    providerId: "fal",
    externalModelId: "fal-ai/stable-audio",
    name: "Stable Audio Open",
    description: "Instrumental background music generated from a text prompt.",
    capabilities: ["music"],
    inputTypes: ["text"],
    supportedAspectRatios: [],
    // fal documents no upper bound on `seconds_total`; an out-of-range request
    // is a 422 from fal itself rather than a limit guessed here.
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid", "cinematic"],
    estimatedCentsPerUnit: 10,
    enabled: true,
    metadata: {
      family: "stable-audio",
      outputField: "audio",
      audioField: "audio_file",
      durationField: "seconds_total",
    },
  },
] as const;

export function findFalModel(id: string): GenerationModel | null {
  return FAL_MODELS.find((model) => model.id === id) ?? null;
}

/**
 * Picks a model for a capability, cheapest-first.
 *
 * Quality breaks ties within a mode rather than selecting across modes, for the
 * same reason the Magnific and former MuAPI selectors do: a user who paid for
 * Cinematic and asked for draft quality still gets cinematic-tier models,
 * because the mode is what they were charged for.
 */
export function selectFalModel(
  capability: GenerationCapability,
  mode: ProductionMode,
  quality: GenerationQuality,
  catalog: readonly GenerationModel[] = FAL_MODELS,
): GenerationModel | null {
  const candidates = catalog.filter(
    (model) =>
      isRoutable(model) && model.capabilities.includes(capability) && model.modes.includes(mode),
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort(
    (a, b) => (a.estimatedCentsPerUnit ?? 0) - (b.estimatedCentsPerUnit ?? 0),
  );
  if (quality === "draft") return sorted[0] ?? null;
  if (quality === "high") return sorted[sorted.length - 1] ?? null;
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}
