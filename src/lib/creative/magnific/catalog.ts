import type { AspectRatio } from "@/types/database";
import type { GenerationQuality, ProductionMode } from "../types";

/**
 * Magnific's model surface, as published at https://docs.magnific.com/llms.txt.
 *
 * Kept as data in one file rather than scattered through the adapter so that
 * adding a model is a data change, and so the mapping from Virally's vocabulary
 * to Magnific's can be unit-tested without an HTTP client.
 *
 * Every endpoint path here is copied from the API reference, not inferred from a
 * pattern. Magnific's paths are not uniform — images sit at `/v1/ai/mystic`,
 * video at `/v1/ai/image-to-video/{model}`, audio at `/v1/ai/music-generation` —
 * so a constructed path would be wrong for most of them.
 */

export const MAGNIFIC_BASE_URL = "https://api.magnific.com";

/** Header Magnific authenticates with. Not `Authorization`, not a bearer token. */
export const MAGNIFIC_AUTH_HEADER = "x-magnific-api-key";

// --- Aspect ratios ----------------------------------------------------------

/**
 * Magnific names ratios rather than expressing them numerically.
 *
 * The image and video enums are different sets — video models accept only three
 * — so they are mapped separately. Collapsing them into one table would let a
 * 4:5 video request compile and then fail at the API with a validation error.
 */
export type MagnificImageRatio =
  | "square_1_1"
  | "classic_4_3"
  | "traditional_3_4"
  | "widescreen_16_9"
  | "social_story_9_16"
  | "smartphone_horizontal_20_9"
  | "smartphone_vertical_9_20"
  | "standard_3_2"
  | "portrait_2_3"
  | "horizontal_2_1"
  | "vertical_1_2"
  | "social_5_4"
  | "social_post_4_5";

export type MagnificVideoRatio = "widescreen_16_9" | "social_story_9_16" | "square_1_1";

const IMAGE_RATIO: Readonly<Partial<Record<AspectRatio, MagnificImageRatio>>> = {
  "9:16": "social_story_9_16",
  "4:5": "social_post_4_5",
  "1:1": "square_1_1",
  "16:9": "widescreen_16_9",
  "4:3": "classic_4_3",
  "3:2": "standard_3_2",
};

const VIDEO_RATIO: Readonly<Partial<Record<AspectRatio, MagnificVideoRatio>>> = {
  "9:16": "social_story_9_16",
  "1:1": "square_1_1",
  "16:9": "widescreen_16_9",
};

/**
 * Maps a Virally ratio to Magnific's image enum, or null when there is none.
 *
 * Null rather than a nearest-match fallback. Silently generating 16:9 for a 4:3
 * request produces a file that passes every technical check and is wrong in a
 * way nobody notices until it is published.
 */
export function toMagnificImageRatio(ratio: AspectRatio): MagnificImageRatio | null {
  return IMAGE_RATIO[ratio] ?? null;
}

export function toMagnificVideoRatio(ratio: AspectRatio): MagnificVideoRatio | null {
  return VIDEO_RATIO[ratio] ?? null;
}

// --- Models -----------------------------------------------------------------

export type MagnificModelKind = "image" | "video" | "audio";

export type MagnificModel = {
  /** Stable id recorded on every run. Ours, not Magnific's. */
  id: string;
  kind: MagnificModelKind;
  /** Exact POST path. GET status is this path plus `/{task-id}`. */
  path: string;
  label: string;
  /**
   * Fixed durations the model accepts, in seconds. Empty for models where
   * duration is continuous or not applicable.
   */
  allowedDurations: readonly number[];
  /**
   * Our cost basis in integer cents per unit generated.
   *
   * These are CONFIGURED ESTIMATES, not quotes from Magnific — the API does not
   * return a price at submit time. They seed `cost_configuration` and are
   * overridden by that table at runtime; anything reading these directly is
   * reading a default, which is why every estimate built from them is tagged
   * `basis: "configured_table"`.
   */
  estimatedCentsPerUnit: number;
  /** Production modes this model is offered for. */
  modes: readonly ProductionMode[];
};

/**
 * The subset of Magnific's catalogue Virally routes to.
 *
 * Deliberately small. Magnific publishes dozens of models; exposing all of them
 * would make the production-mode abstraction meaningless and give the cost
 * estimator a surface it cannot price honestly.
 */
export const MAGNIFIC_MODELS: readonly MagnificModel[] = [
  // --- Image ---
  {
    id: "magnific.mystic",
    kind: "image",
    path: "/v1/ai/mystic",
    label: "Mystic",
    allowedDurations: [],
    estimatedCentsPerUnit: 5,
    modes: ["fast", "hybrid", "cinematic"],
  },
  {
    id: "magnific.hyperflux",
    kind: "image",
    path: "/v1/ai/text-to-image/hyperflux",
    label: "Hyperflux",
    allowedDurations: [],
    estimatedCentsPerUnit: 2,
    modes: ["fast"],
  },
  {
    id: "magnific.flux-2-pro",
    kind: "image",
    path: "/v1/ai/text-to-image/flux-2-pro",
    label: "Flux 2 Pro",
    allowedDurations: [],
    estimatedCentsPerUnit: 9,
    modes: ["cinematic"],
  },

  // --- Video ---
  // Kling accepts ONLY "5" or "10" as a duration string. Anything else is a 400,
  // so the adapter quantises and reports the value it actually sent.
  {
    id: "magnific.kling-v2-6-pro",
    kind: "video",
    path: "/v1/ai/image-to-video/kling-v2-6-pro",
    label: "Kling 2.6 Pro",
    allowedDurations: [5, 10],
    estimatedCentsPerUnit: 140,
    modes: ["hybrid", "cinematic"],
  },
  {
    id: "magnific.minimax-hailuo-2-3",
    kind: "video",
    path: "/v1/ai/image-to-video/minimax-hailuo-2-3-1080p",
    label: "MiniMax Hailuo 2.3",
    allowedDurations: [6, 10],
    estimatedCentsPerUnit: 95,
    modes: ["hybrid"],
  },

  // --- Audio ---
  {
    id: "magnific.music-generation",
    kind: "audio",
    path: "/v1/ai/music-generation",
    label: "Music generation",
    allowedDurations: [],
    estimatedCentsPerUnit: 8,
    modes: ["fast", "hybrid", "cinematic"],
  },
  {
    id: "magnific.sound-effects",
    kind: "audio",
    path: "/v1/ai/sound-effects",
    label: "Sound effects",
    allowedDurations: [],
    estimatedCentsPerUnit: 3,
    modes: ["hybrid", "cinematic"],
  },
] as const;

export function findModel(id: string): MagnificModel | null {
  return MAGNIFIC_MODELS.find((model) => model.id === id) ?? null;
}

/**
 * Picks a model for a request.
 *
 * Quality breaks ties within a mode rather than selecting across modes: a user
 * who paid for Cinematic and asked for draft quality still gets cinematic-tier
 * models, because the mode is what they were charged for.
 */
export function selectModel(
  kind: MagnificModelKind,
  mode: ProductionMode,
  quality: GenerationQuality,
): MagnificModel | null {
  const candidates = MAGNIFIC_MODELS.filter(
    (model) => model.kind === kind && model.modes.includes(mode),
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => a.estimatedCentsPerUnit - b.estimatedCentsPerUnit);
  if (quality === "draft") return sorted[0] ?? null;
  if (quality === "high") return sorted[sorted.length - 1] ?? null;
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

/**
 * Snaps a requested duration onto one the model accepts.
 *
 * Rounds UP to the nearest allowed value, and clamps to the maximum. Rounding
 * down would silently truncate a shot the storyboard timed, which desynchronises
 * the Remotion composition against its own script.
 */
export function quantiseDuration(model: MagnificModel, requestedSeconds: number): number {
  if (model.allowedDurations.length === 0) return Math.max(1, Math.round(requestedSeconds));
  const ascending = [...model.allowedDurations].sort((a, b) => a - b);
  const fallback = ascending[ascending.length - 1] ?? 1;
  return ascending.find((allowed) => allowed >= requestedSeconds) ?? fallback;
}

/**
 * Magnific's task states, verbatim from the OpenAPI spec.
 *
 * Note there is no distinct "cancelled" and no progress field — the API reports
 * four states and nothing else. The adapter must therefore report `progress:
 * null` rather than synthesising a percentage, which is why `GenerationTaskStatus.progress`
 * is nullable.
 */
export type MagnificTaskStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export const MAGNIFIC_TASK_STATUSES: readonly MagnificTaskStatus[] = [
  "CREATED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
];

export function isMagnificTaskStatus(value: unknown): value is MagnificTaskStatus {
  return typeof value === "string" && MAGNIFIC_TASK_STATUSES.includes(value as MagnificTaskStatus);
}
