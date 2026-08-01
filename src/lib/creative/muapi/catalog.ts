import type { AspectRatio } from "@/types/database";
import { isRoutable, type GenerationCapability, type GenerationModel } from "../capabilities";
import type { GenerationQuality, ProductionMode } from "../types";

/**
 * MuAPI's model surface, curated down to what Virally will actually route to.
 *
 * The endpoint slugs, input enums and payload-shaping quirks below are derived
 * from `packages/studio/src/models.js` in
 * https://github.com/anil-matcha/open-generative-ai — MIT, Copyright (c) 2026
 * Open Generative AI Contributors. No upstream code is reproduced here; this is
 * a transcription of that file's data into Virally's own vocabulary. See
 * THIRD_PARTY_NOTICES.md for the licence text.
 *
 * MuAPI publishes 422 models. Cataloguing all of them would make the production
 * mode abstraction meaningless — the router would be choosing between eleven
 * near-identical Seedance variants — and would give the cost estimator a surface
 * it cannot price honestly. What is here instead is one cheap, one standard and
 * one premium option per capability, drawn from families a user would recognise
 * in a picker.
 *
 * Two upstream facts shape every entry:
 *
 * The endpoint is NOT the model id. `flux-dev` posts to `flux-dev-image` and
 * `ai-image-upscaler` posts to `ai-image-upscale`. Upstream falls back to the id
 * when a record omits `endpoint`, but a guessed slug is a 404 at submit time, so
 * only models carrying an explicit `endpoint` were catalogued. That is why
 * Ideogram v3 and the older Kling/Veo/Hailuo text-to-video records are absent
 * despite being obvious picks — their endpoints are not stated in the source.
 *
 * MuAPI publishes no prices, anywhere. See the note above MUAPI_MODELS.
 */

export const MUAPI_BASE_URL = "https://api.muapi.ai";

/** Header MuAPI authenticates with. Not `Authorization`, not a bearer token. */
export const MUAPI_AUTH_HEADER = "x-api-key";

// --- Aspect ratios ----------------------------------------------------------

/**
 * MuAPI names ratios the same way Virally does — "16:9", not "widescreen_16_9" —
 * so this table looks like an identity function and is not one.
 *
 * It exists to be a total, checked boundary: `custom` has no MuAPI spelling, and
 * MuAPI accepts several ratios (21:9, 3:4, 2:3, 5:4) that Virally has no term
 * for. Both directions return null rather than the nearest neighbour, because a
 * 3:4 request quietly served as 4:5 produces a file that passes every technical
 * check and is cropped wrong wherever it is published.
 */
const TO_MUAPI_RATIO: Readonly<Partial<Record<AspectRatio, string>>> = {
  "9:16": "9:16",
  "4:5": "4:5",
  "1:1": "1:1",
  "16:9": "16:9",
  "4:3": "4:3",
  "3:2": "3:2",
};

const FROM_MUAPI_RATIO: Readonly<Record<string, AspectRatio>> = {
  "9:16": "9:16",
  "4:5": "4:5",
  "1:1": "1:1",
  "16:9": "16:9",
  "4:3": "4:3",
  "3:2": "3:2",
};

export function toMuApiAspectRatio(ratio: AspectRatio): string | null {
  return TO_MUAPI_RATIO[ratio] ?? null;
}

export function fromMuApiAspectRatio(value: string): AspectRatio | null {
  return FROM_MUAPI_RATIO[value] ?? null;
}

// --- Model metadata ---------------------------------------------------------

/** Payload-shaping quirks the adapter needs. Stored in GenerationModel.metadata. */
export type MuApiModelMetadata = {
  /** Payload key that receives reference image(s). */
  imageField?: string;
  /** True when imageField takes an array rather than a single URL. */
  imageFieldIsList?: boolean;
  /** Payload key for an optional end-frame image. */
  lastImageField?: string;
  /** Payload key that receives a source video. */
  videoField?: string;
  /** Whether the endpoint accepts a `prompt` at all. */
  hasPrompt?: boolean;
  /** Endpoint requires a prior request_id (chained generation). */
  requiresRequestId?: boolean;
  /** Upstream provider family, e.g. "kling", "bytedance". For display + grouping. */
  family?: string;
};

// --- Models -----------------------------------------------------------------

/**
 * Virally's curated MuAPI catalogue. Seed data for `generation_models`.
 *
 * EVERY `estimatedCentsPerUnit` BELOW IS A VIRALLY-CONFIGURED ESTIMATE. MuAPI
 * publishes no pricing — not in its docs, not in its model listing, and not in
 * the submit response — so there is no figure to copy and nothing to reconcile
 * against at request time. These numbers are our own cost basis, ordered so the
 * relative tiers are right even where the absolute values drift.
 *
 * They seed the `generation_models` table and are overridden by that table at
 * runtime. Anything reading them directly is reading a default, which is why
 * every estimate built from them is tagged `basis: "configured_table"` and never
 * presented to a user as a provider quote.
 *
 * `supportedDurations` is populated only where the upstream record gives a real
 * enum or a stepped range (Kling's 5/10, Hailuo's 6/10). Models that declare
 * duration as a 1-second-step range are left empty — enumerating fifteen values
 * would present a continuous control as a dropdown, and the upstream data does
 * not distinguish "any integer" from "these fifteen".
 */
export const MUAPI_MODELS: readonly GenerationModel[] = [
  // --- Text to image ---
  {
    id: "muapi.flux-schnell",
    providerId: "muapi",
    externalModelId: "flux-schnell-image",
    name: "Flux Schnell",
    description: "Fastest Flux tier, for thumbnails and rapid concept passes.",
    capabilities: ["text-to-image"],
    inputTypes: ["text"],
    // Sized by explicit width/height rather than a ratio enum, so no ratio is
    // out of reach and the constraint list is genuinely empty.
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 2,
    enabled: true,
    metadata: { family: "blackforest", hasPrompt: true },
  },
  {
    id: "muapi.flux-dev",
    providerId: "muapi",
    externalModelId: "flux-dev-image",
    name: "Flux Dev",
    description: "Balanced Flux tier — the default for storyboard frames.",
    capabilities: ["text-to-image"],
    inputTypes: ["text"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 4,
    enabled: true,
    metadata: { family: "blackforest", hasPrompt: true },
  },
  {
    id: "muapi.nano-banana",
    providerId: "muapi",
    externalModelId: "nano-banana",
    name: "Nano Banana",
    description: "Google's Gemini image model — strong at instruction following.",
    capabilities: ["text-to-image"],
    inputTypes: ["text"],
    // Upstream also offers 3:4, 2:3, 5:4 and 21:9. Dropped, not approximated.
    supportedAspectRatios: ["1:1", "4:3", "9:16", "16:9", "3:2", "4:5"],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["hybrid"],
    estimatedCentsPerUnit: 5,
    enabled: true,
    metadata: { family: "nano", hasPrompt: true },
  },
  {
    id: "muapi.seedream-5.0",
    providerId: "muapi",
    externalModelId: "seedream-5.0",
    name: "Seedream 5.0",
    description: "ByteDance Seedream — photoreal stills with dependable composition.",
    capabilities: ["text-to-image"],
    inputTypes: ["text"],
    supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:2"],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 7,
    enabled: true,
    metadata: { family: "seedream", hasPrompt: true },
  },
  {
    id: "muapi.nano-banana-pro",
    providerId: "muapi",
    externalModelId: "nano-banana-pro",
    name: "Nano Banana Pro",
    description: "Highest-fidelity Gemini image tier, up to 4K.",
    capabilities: ["text-to-image"],
    inputTypes: ["text"],
    supportedAspectRatios: ["1:1", "4:3", "9:16", "16:9", "3:2", "4:5"],
    supportedDurations: [],
    // Lowercase here and uppercase on Seedream Edit below. That inconsistency is
    // MuAPI's; normalising it would send a value the endpoint rejects.
    supportedResolutions: ["1k", "2k", "4k"],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["cinematic"],
    estimatedCentsPerUnit: 12,
    enabled: true,
    metadata: { family: "nano", hasPrompt: true },
  },

  // --- Image to image ---
  {
    id: "muapi.nano-banana-edit",
    providerId: "muapi",
    externalModelId: "nano-banana-edit",
    name: "Nano Banana Edit",
    description: "Conversational edits across up to ten reference images.",
    capabilities: ["image-to-image"],
    inputTypes: ["text", "image"],
    // Upstream's enum leads with "Auto", which is a mode rather than a ratio and
    // has no Virally equivalent, so it is dropped along with 3:4, 2:3, 5:4, 21:9.
    supportedAspectRatios: ["1:1", "4:3", "9:16", "16:9", "3:2", "4:5"],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 10,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 6,
    enabled: true,
    metadata: {
      family: "nano",
      imageField: "images_list",
      imageFieldIsList: true,
      hasPrompt: true,
    },
  },
  {
    id: "muapi.flux-kontext-pro-i2i",
    providerId: "muapi",
    externalModelId: "flux-kontext-pro-i2i",
    name: "Flux Kontext Pro",
    description: "Targeted edits that preserve the rest of the frame.",
    capabilities: ["image-to-image"],
    inputTypes: ["text", "image"],
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3"],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 2,
    modes: ["hybrid"],
    estimatedCentsPerUnit: 7,
    enabled: true,
    metadata: {
      family: "kontext",
      imageField: "images_list",
      imageFieldIsList: true,
      hasPrompt: true,
    },
  },
  {
    id: "muapi.bytedance-seedream-edit-v4",
    providerId: "muapi",
    externalModelId: "bytedance-seedream-edit-v4",
    name: "Seedream Edit v4",
    description: "Multi-reference product and character edits at up to 4K.",
    capabilities: ["image-to-image"],
    inputTypes: ["text", "image"],
    supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:2"],
    supportedDurations: [],
    supportedResolutions: ["1K", "2K", "4K"],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 10,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 9,
    enabled: true,
    metadata: {
      family: "seedream",
      imageField: "images_list",
      imageFieldIsList: true,
      hasPrompt: true,
    },
  },

  // --- Upscale ---
  // Both are prompt-less: sending a `prompt` is not merely ignored, it is a field
  // the endpoint does not declare, so the adapter must omit it.
  {
    id: "muapi.ai-image-upscaler",
    providerId: "muapi",
    externalModelId: "ai-image-upscale",
    name: "AI Image Upscaler",
    description: "Cheap general-purpose upscale for review copies.",
    capabilities: ["upscale"],
    inputTypes: ["image"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 3,
    enabled: true,
    metadata: { family: "tools", imageField: "image_url", hasPrompt: false },
  },
  {
    id: "muapi.topaz-image-upscale",
    providerId: "muapi",
    externalModelId: "topaz-image-upscale",
    name: "Topaz Image Upscale",
    description: "Delivery-grade upscale at 2x, 4x or 8x.",
    capabilities: ["upscale"],
    inputTypes: ["image"],
    supportedAspectRatios: [],
    supportedDurations: [],
    // Scaled by `upscale_factor`, not a resolution enum, so there is nothing to
    // constrain — the output size depends on what was uploaded.
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 7,
    enabled: true,
    metadata: { family: "topaz", imageField: "image_url", hasPrompt: false },
  },

  // --- Text to video ---
  {
    id: "muapi.pixverse-v6-t2v",
    providerId: "muapi",
    externalModelId: "pixverse-v6-t2v",
    name: "Pixverse v6",
    description: "Quick stylised clips with optional generated audio.",
    capabilities: ["text-to-video"],
    inputTypes: ["text"],
    supportedAspectRatios: ["16:9", "4:3", "1:1", "9:16", "3:2"],
    supportedDurations: [],
    supportedResolutions: ["360p", "540p", "720p", "1080p"],
    supportsNegativePrompt: false,
    supportsSeed: false,
    // `generate_audio_switch`, not `generate_audio` — the adapter keys off
    // metadata and this flag, never off the model id.
    supportsAudio: true,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 70,
    enabled: true,
    metadata: { family: "pixverse", hasPrompt: true },
  },
  {
    id: "muapi.wan2.7-text-to-video",
    providerId: "muapi",
    externalModelId: "wan2.7-text-to-video",
    name: "Wan 2.7",
    description: "Alibaba Wan — the only catalogued model taking a negative prompt.",
    capabilities: ["text-to-video"],
    inputTypes: ["text"],
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3"],
    supportedDurations: [],
    supportedResolutions: ["720p", "1080p"],
    supportsNegativePrompt: true,
    supportsSeed: false,
    // `audio_url` guides generation from an existing track; it does not produce
    // one. Reporting this as audio support would have the UI offer a soundtrack
    // the model never returns.
    supportsAudio: false,
    modes: ["hybrid"],
    estimatedCentsPerUnit: 110,
    enabled: true,
    metadata: { family: "wan2.7", hasPrompt: true },
  },
  {
    id: "muapi.seedance-2-text-to-video-fast",
    providerId: "muapi",
    externalModelId: "seedance-2-text-to-video-fast",
    name: "Seedance 2 Fast",
    description: "ByteDance Seedance 2 — strong motion coherence for narrative shots.",
    capabilities: ["text-to-video"],
    inputTypes: ["text"],
    supportedAspectRatios: ["16:9", "4:3", "1:1", "9:16"],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 120,
    enabled: true,
    metadata: { family: "seedance", hasPrompt: true },
  },
  {
    id: "muapi.veo-4-text-to-video",
    providerId: "muapi",
    externalModelId: "veo-4-text-to-video",
    name: "Veo 4",
    description: "Google Veo 4 — the premium tier for hero shots up to 30s.",
    capabilities: ["text-to-video"],
    inputTypes: ["text"],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    // Veo composes a soundtrack, but the endpoint exposes no switch for it, so
    // there is nothing for the adapter to send and nothing to promise the user.
    supportsAudio: false,
    modes: ["cinematic"],
    estimatedCentsPerUnit: 260,
    enabled: true,
    metadata: { family: "veo", hasPrompt: true },
  },

  // --- Image to video ---
  // `lastImageField` is recorded but does NOT raise `maxReferenceImages`: the end
  // frame is a distinct payload key with its own meaning, not a second entry in a
  // reference set, and conflating them would let the UI drop two style refs into
  // a first/last-frame pair.
  {
    id: "muapi.wan2.2-image-to-video",
    providerId: "muapi",
    externalModelId: "wan2.2-image-to-video",
    name: "Wan 2.2 Image to Video",
    description: "Cheap first-frame animation with an optional end frame.",
    capabilities: ["image-to-video"],
    inputTypes: ["text", "image"],
    supportedAspectRatios: ["16:9", "9:16"],
    // Declared as 5 to 8 in steps of 3, which is a two-value set spelled as a
    // range. Enumerated because the upper bound is a real refusal.
    supportedDurations: [5, 8],
    supportedResolutions: ["480p", "720p"],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 80,
    enabled: true,
    metadata: {
      family: "wan2.2",
      imageField: "image_url",
      lastImageField: "last_image",
      hasPrompt: true,
    },
  },
  {
    id: "muapi.minimax-hailuo-02-standard-i2v",
    providerId: "muapi",
    externalModelId: "minimax-hailuo-02-standard-i2v",
    name: "Hailuo 02 Standard",
    description: "MiniMax Hailuo — natural human motion at 6s or 10s.",
    capabilities: ["image-to-video"],
    inputTypes: ["text", "image"],
    // No ratio input at all: the output follows the source image.
    supportedAspectRatios: [],
    supportedDurations: [6, 10],
    // Capital P, unlike every other model here. MuAPI's spelling, kept verbatim.
    supportedResolutions: ["512P", "768P"],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["hybrid"],
    estimatedCentsPerUnit: 90,
    enabled: true,
    metadata: {
      family: "minimax",
      imageField: "image_url",
      lastImageField: "end_image_url",
      hasPrompt: true,
    },
  },
  {
    id: "muapi.kling-v2.5-turbo-pro-i2v",
    providerId: "muapi",
    externalModelId: "kling-v2.5-turbo-pro-i2v",
    name: "Kling v2.5 Turbo Pro",
    description: "Kling's workhorse — controlled camera moves at 5s or 10s.",
    capabilities: ["image-to-video"],
    inputTypes: ["text", "image"],
    supportedAspectRatios: [],
    supportedDurations: [5, 10],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 150,
    enabled: true,
    metadata: { family: "kling", imageField: "image_url", hasPrompt: true },
  },
  {
    id: "muapi.veo3.1-fast-image-to-video",
    providerId: "muapi",
    externalModelId: "veo3.1-fast-image-to-video",
    name: "Veo 3.1 Fast",
    description: "Google Veo 3.1 — fixed 8s at 1080p, for the money shot.",
    capabilities: ["image-to-video"],
    inputTypes: ["text", "image"],
    supportedAspectRatios: ["16:9", "9:16"],
    // A one-value enum, so a 5s request quantises up to 8s and the composition
    // must be told, rather than assuming it got what it asked for.
    supportedDurations: [8],
    supportedResolutions: ["1080p"],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["cinematic"],
    estimatedCentsPerUnit: 200,
    enabled: true,
    metadata: {
      family: "veo3.1",
      imageField: "image_url",
      lastImageField: "last_image",
      hasPrompt: true,
    },
  },

  // --- Lip sync ---
  // These endpoints declare no image or video field of their own; upstream posts
  // a fixed `image_url` or `video_url` depending on whether the model is driven
  // by a still or by footage. Recorded explicitly so the adapter never has to
  // branch on the model id.
  {
    id: "muapi.sync-lipsync",
    providerId: "muapi",
    externalModelId: "sync-lipsync",
    name: "Sync Lipsync",
    description: "Re-syncs an existing video's mouth to a new audio track.",
    capabilities: ["lip-sync"],
    inputTypes: ["video", "audio"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 45,
    enabled: true,
    metadata: { family: "lipsync", videoField: "video_url", hasPrompt: false },
  },
  {
    id: "muapi.infinitetalk-image-to-video",
    providerId: "muapi",
    externalModelId: "infinitetalk-image-to-video",
    name: "InfiniteTalk",
    description: "Turns one portrait plus audio into a talking-head clip.",
    capabilities: ["lip-sync"],
    inputTypes: ["text", "image", "audio"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: ["480p", "720p"],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["fast", "hybrid"],
    estimatedCentsPerUnit: 60,
    enabled: true,
    metadata: { family: "infinitetalk", imageField: "image_url", hasPrompt: true },
  },
  {
    id: "muapi.kling-v2-avatar-pro",
    providerId: "muapi",
    externalModelId: "kling-v2-avatar-pro",
    name: "Kling v2 Avatar Pro",
    description: "Premium avatar performance from a portrait and a voice track.",
    capabilities: ["lip-sync"],
    inputTypes: ["text", "image", "audio"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    maxReferenceImages: 1,
    modes: ["hybrid", "cinematic"],
    estimatedCentsPerUnit: 110,
    enabled: true,
    metadata: { family: "kling", imageField: "image_url", hasPrompt: true },
  },

  // --- Audio ---
  // Offered in all three modes: a voiceover or a bed of music costs the same to
  // produce whichever mode the video around it was made in, and withholding one
  // would leave Fast mode unable to finish a cut.
  {
    id: "muapi.minimax-speech-2.6-turbo",
    providerId: "muapi",
    externalModelId: "minimax-speech-2.6-turbo",
    name: "MiniMax Speech Turbo",
    description: "Multilingual text to speech across several hundred stock voices.",
    capabilities: ["audio"],
    inputTypes: ["text"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid", "cinematic"],
    estimatedCentsPerUnit: 4,
    enabled: true,
    metadata: { family: "minimax", hasPrompt: true },
  },
  {
    id: "muapi.suno-generate-sounds",
    providerId: "muapi",
    externalModelId: "suno-generate-sounds",
    name: "Suno Sound Effects",
    description: "Short sound effects and stingers, optionally loopable.",
    capabilities: ["sound-effect"],
    inputTypes: ["text"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid", "cinematic"],
    estimatedCentsPerUnit: 5,
    enabled: true,
    metadata: { family: "suno", hasPrompt: true },
  },
  {
    id: "muapi.suno-create-music",
    providerId: "muapi",
    externalModelId: "suno-create-music",
    name: "Suno Create Music",
    description: "Full songs with vocals and instrumentation from a style brief.",
    capabilities: ["music"],
    inputTypes: ["text"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid", "cinematic"],
    estimatedCentsPerUnit: 10,
    enabled: true,
    metadata: { family: "suno", hasPrompt: true },
  },
] as const;

export function findMuApiModel(id: string): GenerationModel | null {
  return MUAPI_MODELS.find((model) => model.id === id) ?? null;
}

// --- Metadata access --------------------------------------------------------

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Reads the typed metadata off a model, with a safe default.
 *
 * Field-by-field rather than a cast, because `metadata` is `Record<string,
 * unknown>` on the way out of the database and a cast would assert a shape that
 * a bad seed row can violate. An unrecognised value degrades to `undefined`,
 * which the adapter already handles, instead of reaching `fetch` as a number
 * where a payload key was expected.
 */
export function muApiMetadata(model: GenerationModel): MuApiModelMetadata {
  const raw = model.metadata;
  if (raw === undefined) return {};
  return {
    imageField: readString(raw.imageField),
    imageFieldIsList: readBoolean(raw.imageFieldIsList),
    lastImageField: readString(raw.lastImageField),
    videoField: readString(raw.videoField),
    hasPrompt: readBoolean(raw.hasPrompt),
    requiresRequestId: readBoolean(raw.requiresRequestId),
    family: readString(raw.family),
  };
}

// --- Selection --------------------------------------------------------------

/**
 * Picks a model for a capability, cheapest-first.
 *
 * Quality breaks ties within a mode rather than selecting across modes: a user
 * who paid for Cinematic and asked for draft quality still gets cinematic-tier
 * models, because the mode is what they were charged for.
 *
 * Unroutable models — switched off, retired, or unpriced — are filtered before
 * the sort rather than after, so an unpriced entry cannot become the "cheapest"
 * option by having no price to compare.
 */
export function selectMuApiModel(
  capability: GenerationCapability,
  mode: ProductionMode,
  quality: GenerationQuality,
  /**
   * The catalogue to select from. Defaults to the shipped array.
   *
   * Injectable because the authoritative catalogue at runtime is
   * `generation_models` in Neon, not this file — the array is the seed and the
   * unseeded fallback. Selecting against the shipped list when the database has
   * disabled or repriced a model is exactly the drift this parameter prevents.
   */
  catalog: readonly GenerationModel[] = MUAPI_MODELS,
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
