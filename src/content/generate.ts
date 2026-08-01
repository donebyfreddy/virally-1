import type { GenerationCapability } from "@/lib/creative/capabilities";
import type { ProviderRunState } from "@/lib/creative/types";

/**
 * Copy and taxonomy for the generation studios.
 *
 * Kept out of the components for the reason every other `src/content` module
 * exists: a sentence a user reads is product copy, and product copy that lives
 * inside JSX gets edited by whoever is nearest rather than reviewed.
 *
 * The studio definitions below are also the routing table. Four surfaces, each
 * owning a set of capabilities and exactly one output kind — the kind is what
 * `readGenerationHistory` filters on, the capabilities are what the router and
 * the model picker filter on, and conflating the two is the mistake
 * `lib/creative/capabilities.ts` was written to prevent.
 */

export type StudioId = "image" | "video" | "audio" | "lip-sync";

export type StudioDefinition = {
  id: StudioId;
  /** Nav label. Sentence case. */
  label: string;
  href: string;
  /** The page `<h1>`. */
  title: string;
  /** One line under the title. */
  description: string;
  /** What comes out. The only dimension history can be filtered on. */
  generationType: "image" | "video" | "audio";
  /** Ordered. The first is the default, and the form only offers these. */
  capabilities: readonly GenerationCapability[];
  /** Placeholder for the prompt field. Never the only place an instruction lives. */
  promptPlaceholder: string;
  /** What the prompt field is asking for, rendered as visible help text. */
  promptHint: string;
  emptyTitle: string;
  emptyBody: string;
  /**
   * A stated limitation of the surface, rendered above the composer.
   *
   * Present only where the UI can offer less than the studio implies. Saying so
   * is the honest option: the alternative is a form that looks complete and
   * produces a result the user cannot explain.
   */
  caveat?: string;
};

export const STUDIOS: readonly StudioDefinition[] = [
  {
    id: "image",
    label: "Image",
    href: "/app/generate/image",
    title: "Image studio",
    description:
      "Generate stills from a prompt, or restyle an image already in the library.",
    generationType: "image",
    capabilities: ["text-to-image", "image-to-image"],
    promptPlaceholder: "A slow pan across a matte-black espresso machine, morning light",
    promptHint:
      "Describe the subject, the framing and the light. Reference images set the structure and the style.",
    emptyTitle: "No images generated yet",
    emptyBody: "Stills you generate here appear below, newest first, with the model that made them.",
  },
  {
    id: "video",
    label: "Video",
    href: "/app/generate/video",
    title: "Video studio",
    description: "Generate a clip from a prompt, or animate a still from the library.",
    generationType: "video",
    capabilities: ["text-to-video", "image-to-video"],
    promptPlaceholder: "Handheld shot following a courier through a night market, neon reflections",
    promptHint:
      "Describe the action and the camera. Clip length is quantised to what the chosen model produces.",
    emptyTitle: "No clips generated yet",
    emptyBody: "Clips you generate here appear below, newest first, with the model that made them.",
  },
  {
    id: "audio",
    label: "Audio",
    href: "/app/generate/audio",
    title: "Audio studio",
    description: "Generate a voiceover, a music bed or a sound effect.",
    generationType: "audio",
    capabilities: ["audio", "music", "sound-effect"],
    promptPlaceholder: "Warm, unhurried voiceover reading a two-line product line",
    promptHint: "Describe the delivery, the instrumentation or the effect you need.",
    emptyTitle: "No audio generated yet",
    emptyBody: "Tracks you generate here appear below, newest first, with the model that made them.",
  },
  {
    id: "lip-sync",
    label: "Lip sync",
    href: "/app/generate/lip-sync",
    title: "Lip sync studio",
    description: "Animate a face in an existing clip against a recorded voice track.",
    generationType: "video",
    capabilities: ["lip-sync"],
    promptPlaceholder: "Optional direction for the performance",
    promptHint:
      "Lip sync takes a portrait and an audio track. A prompt is optional — the model discards it.",
    emptyTitle: "No lip-sync runs yet",
    emptyBody: "Runs you start here appear below, newest first, with the model that made them.",
    caveat:
      "A voice track cannot be attached from this screen yet. The generation action takes a prompt, a format and reference images, and has no field for an audio input, so a run started here reaches the provider without one.",
  },
] as const;

export function studioById(id: StudioId): StudioDefinition {
  const studio = STUDIOS.find((entry) => entry.id === id);
  if (!studio) throw new Error(`Unknown studio "${id}".`);
  return studio;
}

/** Human names for the routing dimension. Sentence case, like everything else. */
export const CAPABILITY_LABELS: Readonly<Record<GenerationCapability, string>> = {
  "text-to-image": "Text to image",
  "image-to-image": "Image to image",
  "text-to-video": "Text to video",
  "image-to-video": "Image to video",
  audio: "Voiceover",
  music: "Music",
  "sound-effect": "Sound effect",
  "lip-sync": "Lip sync",
  upscale: "Upscale",
};

/**
 * Machine state, in the user's words.
 *
 * `waiting_external` is the one worth naming precisely: it means the request is
 * sitting with the provider, which is a different situation from our own queue
 * and the difference decides whether waiting longer will help.
 */
export const RUN_STATE_LABELS: Readonly<Record<ProviderRunState, string>> = {
  planned: "Planned",
  queued: "Queued",
  submitted: "Submitted",
  waiting_external: "Waiting on provider",
  generating: "Generating",
  downloading: "Downloading",
  validating: "Validating",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  dead_letter: "Stopped",
};

export const generateCopy = {
  overviewTitle: "Generate",
  overviewDescription:
    "Four studios over one queue. Every run reserves Production Credits before it starts and releases what it does not use.",

  /** The prompt composer. */
  composerTitle: "Compose",
  promptLabel: "Prompt",
  negativeLabel: "What to avoid",
  negativeHint: "Optional. Elements the model should keep out of the result.",
  capabilityLabel: "What you are making",
  modeLabel: "Production mode",
  modeHint: "The tier a model must be offered in. Higher tiers cost more per run.",
  ratioLabel: "Format",
  resolutionLabel: "Resolution",
  durationLabel: "Length",
  durationUnit: "seconds",
  modelLabel: "Model",

  /** The summary rail. */
  summaryTitle: "Before you generate",
  summaryProvider: "Provider",
  summaryModel: "Model",
  summaryFormat: "Format",
  summaryCost: "Estimated cost",
  summaryBalance: "Available",
  summaryAfter: "Left after this run",
  costUnit: "Production Credits",
  costUnknown: "Not quotable",
  costUnknownHint:
    "No configured model can serve this request yet, so there is no figure to quote.",
  automaticCostHint:
    "Automatic runs the cheapest model that fits, so this is the floor rather than a fixed price.",
  costReleaseHint: "Credits are reserved before the run and the unused part is returned.",
  generateLabel: "Generate",
  generatingLabel: "Starting",

  /** The model picker. */
  automaticLabel: "Automatic",
  automaticDetail: "Cheapest model that fits, chosen at submit time",
  modelSearchLabel: "Search models",
  modelSearchPlaceholder: "Model or provider",
  modelCapabilityFilter: "Capability",
  modelProviderFilter: "Provider",
  modelSortFilter: "Sort",
  modelRecentHeading: "Recently used",
  modelAllHeading: "All models",
  modelNoMatches: "No model matches those filters.",
  modelNoneAvailable:
    "No provider is configured, so there is no model catalogue to choose from.",
  modelCountLabel: (shown: number, total: number) =>
    shown === total ? `${total} models` : `${shown} of ${total} models`,

  /** References. */
  referencesLabel: "Reference images",
  referencesHint:
    "Picked from this workspace's library. The first slot sets structure, the second sets style.",
  referenceEmpty: "Empty slot",
  referenceChoose: "Choose from library",
  referenceReplace: "Replace",
  referenceRemove: "Remove reference",
  referenceNoneAvailable:
    "This workspace has no stored image a provider can read yet. Upload or generate one first.",
  referenceUnreachable:
    "This workspace's images are signed on an external host, and a generation request can only reference Virally's own storage paths.",

  /** Consent. */
  consentTitle: "Likeness and voice",
  consentLabel:
    "I have permission from the person shown to use their likeness and voice for this generation.",
  consentNoteLabel: "Where that permission comes from",
  consentNoteHint: "Optional. Recorded with the confirmation.",

  /** The queue. */
  queueTitle: "In flight",
  queueEmptyTitle: "Nothing generating",
  queueEmptyBody: "Runs you start appear here with live state until they finish.",
  queueIndeterminate: "The provider does not report progress for this run.",
  queuePausedNote: "Live updates pause while this tab is in the background.",

  /** Output. */
  outputsTitle: "Recent generations",
  assetOpen: "Open",
  assetDownload: "Download",
  noPreview: "No stored preview",
  demoExplanation: "Produced by the deterministic mock, not by a generation provider.",

  /** Costs table. */
  costsTitle: "What each model costs",
  costsHint:
    "Per unit generated, in Production Credits. A video model is priced per clip, so a long shot costs several.",
  costsEmptyTitle: "No priced models",
  costsEmptyBody:
    "A model is only offered once a provider is configured and a price is recorded for it.",

  /** Provider banner. */
  bannerTitle: "Provider configuration required",
  bannerBody:
    "No generation provider is configured, so nothing new can be generated. Anything already in this workspace's history that ran against the mock is labelled as demo output.",

  /** Errors, by refusal kind. */
  errorTitles: {
    policy: "This request was refused",
    consent: "Confirmation needed",
    limit: "Throttled",
    credits: "Not enough credits",
    unavailable: "Provider configuration required",
    unknown: "The generation did not start",
  },
  errorReassurance: "No credits were used and nothing was generated.",
  retryLabel: "Try again",
  topUpLabel: "See usage and credits",
  shortfallLabel: (shortfall: number) =>
    `You need ${shortfall.toLocaleString("en-US")} more Production Credits.`,

  startedTitle: "Generation started",
  startedBody: "It is in the queue below. You can start another while it runs.",
  alreadyStartedTitle: "Already running",
  alreadyStartedBody:
    "That exact request was already accepted, so nothing new was started and nothing extra was charged.",
} as const;
