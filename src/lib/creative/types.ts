import type { GenerationCapability, GenerationModel } from "./capabilities";
import type { AspectRatio, OutputOrigin } from "@/types/database";

/**
 * The creative generation provider contract.
 *
 * Scope is media only — image, video, audio. Language generation (briefs,
 * concepts, scripts, storyboards) stays behind `LanguageProvider` in
 * src/lib/ai/, which is a different problem: it is synchronous, cheap, and its
 * output is text the user edits rather than a binary the system must download,
 * store and bill for.
 *
 * Three properties of this interface carry weight and should survive refactors:
 *
 * `estimate*` is separate from `generate*` because the user must see and accept
 * a cost before anything is submitted, and because credits are reserved against
 * the estimate. A provider that could only quote by generating would make the
 * reservation step impossible.
 *
 * Everything is submit-then-poll. Every real provider is asynchronous; a
 * synchronous signature would force implementations to block a request handler
 * for minutes and lie about what they are doing.
 *
 * `isConfigured()` is a method rather than a constructor-time check so a
 * deployment can add a key without a restart, and so the router can ask the
 * question cheaply on every call.
 */

// --- Shared -----------------------------------------------------------------

export type ProductionMode = "fast" | "hybrid" | "cinematic";

export type GenerationQuality = "draft" | "standard" | "high";

/**
 * What a provider will charge, in the provider's own units, plus what Virally
 * will charge the user.
 *
 * Both numbers are kept because they answer different questions. `providerCredits`
 * is what reconciles against the Magnific invoice. `internalCredits` is what the
 * user sees and what the ledger reserves. Deriving one from the other at read
 * time would silently rewrite history whenever pricing changed.
 */
export type CostEstimate = {
  /** Provider-side cost in the provider's credit unit. Null when it does not say. */
  providerCredits: number | null;
  /** Our own cost basis in integer cents, for margin reporting. */
  internalCents: number;
  /** Virally Production Credits to reserve. Always an integer, always >= 0. */
  internalCredits: number;
  /**
   * Whether these figures came from the provider's published pricing or from
   * our own configured table. The estimator UI must not present a locally
   * configured guess as a provider quote.
   */
  basis: "provider_quote" | "configured_table";
};

/**
 * Lifecycle of one generation, mirroring the brief's required states.
 *
 * `downloading` is a distinct state and not an implementation detail: the brief
 * forbids showing "completed" until the bytes are in Virally-owned storage, and
 * a state machine with no term for "provider is done, we are not" makes that
 * rule unenforceable.
 */
export type GenerationTaskState =
  | "planned"
  | "queued"
  | "submitted"
  | "generating"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

/** Terminal states. A task in one of these will never change again. */
export const TERMINAL_TASK_STATES: readonly GenerationTaskState[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalState(state: GenerationTaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

/**
 * The state vocabulary of a persisted run, which is wider than what a provider
 * can report.
 *
 * Three states are Virally's own and exist only here:
 *
 * `waiting_external` — submitted, and the provider has acknowledged but not
 *   started. Distinguished from `submitted` so the poller can back off harder
 *   on a queue that has not moved than on one actively working.
 *
 * `validating` — bytes are downloaded and the MIME, signature, checksum and
 *   probe checks have not yet passed. Between `downloading` and `completed`
 *   because a file that arrived and a file that is known good are different
 *   things, and only the latter may be attached to a campaign.
 *
 * `dead_letter` — retries exhausted. Terminal, and deliberately not `failed`:
 *   a failed run may be retried by a user, a dead-lettered one needs an
 *   operator to look at it, and collapsing them hides a systemic fault behind
 *   a pile of individually-plausible failures.
 *
 * No adapter may return these. They describe where the orchestrator is, which
 * is information no provider has — keeping them out of `GenerationTaskState`
 * is what makes that unrepresentable rather than merely discouraged.
 */
export type ProviderRunState =
  | GenerationTaskState
  | "waiting_external"
  | "validating"
  | "dead_letter";

export const TERMINAL_RUN_STATES: readonly ProviderRunState[] = [
  "completed",
  "failed",
  "cancelled",
  "dead_letter",
];

export function isTerminalRunState(state: ProviderRunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export type GenerationFailure = {
  code: string;
  /** Safe to show a user. Never contains a credential or a raw provider body. */
  message: string;
  /** Whether re-submitting could plausibly succeed. A 400 cannot; a 503 can. */
  retryable: boolean;
  /**
   * Whether the provider billed for the failed attempt.
   *
   * Not optional and not inferred. The refund path reads this to decide whether
   * a reservation is released in full, and guessing it wrong either overcharges
   * the user or eats a real provider cost silently.
   */
  costIncurred: boolean;
};

/**
 * A media file the provider produced.
 *
 * `url` is the provider's temporary URL and is explicitly NOT authoritative —
 * Magnific's generated URLs expire. Nothing may persist it as an asset location;
 * the download step copies the bytes into Virally storage and records the
 * storage key. The field name is deliberately not `assetUrl` to keep that
 * distinction visible at call sites.
 */
export type ProviderMediaRef = {
  /** Temporary, expiring, provider-owned. Read once, then download. */
  url: string;
  mimeType: string | null;
  widthPx: number | null;
  heightPx: number | null;
  durationMs: number | null;
};

/** Handle returned by a submit call. */
export type GenerationTask = {
  /** The provider's own task id, persisted so a retry can adopt it. */
  externalTaskId: string;
  providerId: string;
  /** Provider model actually used, which may differ from the one requested. */
  model: string;
  state: GenerationTaskState;
  /** Hint from the provider on when to poll next. Null when it gives none. */
  suggestedPollMs: number | null;
};

export type GenerationTaskStatus = {
  externalTaskId: string;
  state: GenerationTaskState;
  /** 0-100 when the provider reports it, null when it does not. Never faked. */
  progress: number | null;
  /** Populated only in `completed`. */
  media: readonly ProviderMediaRef[];
  failure: GenerationFailure | null;
  /** What the provider actually billed, once known. */
  providerCredits: number | null;
};

// --- Inputs -----------------------------------------------------------------

/**
 * Fields common to every generation request.
 *
 * `idempotencyKey` is required, not optional. It is what makes "the user
 * double-clicked Generate" cost one provider task instead of two, and an
 * optional field would be omitted exactly where it matters most — inside a
 * retrying worker.
 */
export type GenerationInputBase = {
  idempotencyKey: string;
  prompt: string;
  negativePrompt?: string;
  mode: ProductionMode;
  quality: GenerationQuality;
  /** Absolute URL Magnific should call on completion. Omitted when unverifiable. */
  webhookUrl?: string;
};

export type ImageGenerationInput = GenerationInputBase & {
  ratio: AspectRatio;
  /** Longest-edge target. The provider maps it onto its own resolution tiers. */
  resolution?: "1k" | "2k" | "4k";
  /** Publicly reachable URLs used as style or structure guidance. */
  styleReferenceUrl?: string;
  structureReferenceUrl?: string;
  /** Fixes the seed so a regeneration is reproducible. */
  fixedGeneration?: boolean;
};

export type VideoGenerationInput = GenerationInputBase & {
  ratio: AspectRatio;
  /**
   * Requested duration. Providers quantise this — Kling accepts only 5s or 10s —
   * so the adapter must report what it actually asked for rather than echoing
   * this value back.
   */
  durationSeconds: number;
  /** First frame. Its presence is what selects image-to-video over text-to-video. */
  referenceImageUrl?: string;
  /** Whether the model should produce its own audio track. */
  generateAudio?: boolean;
};

export type AudioKind = "music" | "sound_effect";

export type AudioGenerationInput = GenerationInputBase & {
  kind: AudioKind;
  durationSeconds: number;
};

// --- The interface ----------------------------------------------------------

export interface CreativeGenerationProvider {
  readonly id: string;
  readonly label: string;
  /**
   * NAME of the environment variable that configures this provider — never its
   * value.
   *
   * Exists so an "unconfigured" message can tell an operator which variable to
   * set instead of saying only that something is missing. Safe to render in the
   * dashboard and to write to a log, which is precisely why it is the name.
   */
  readonly credentialEnvVar: string;

  /** Whether this provider has the credentials to run right now. */
  isConfigured(): boolean;

  /**
   * The models this provider offers, optionally filtered by capability.
   *
   * Asynchronous because the authoritative catalogue is the `generation_models`
   * table, not the in-code array — that indirection is what lets a model be
   * added, retired, renamed, repriced or switched off without a deploy, which
   * a synchronous getter over a module constant could never support.
   *
   * The in-code catalogues remain the seed and the fallback for an unseeded
   * deployment, so this resolves to something useful before the first migration
   * has run.
   */
  listModels(capability?: GenerationCapability): Promise<readonly GenerationModel[]>;

  /**
   * Whether the provider can serve this request at all.
   *
   * Separate from `isConfigured` so the router can distinguish "not set up" from
   * "set up but cannot do 4:3 video", which are different messages to the user
   * and different fallback decisions.
   */
  supports(input: SupportsQuery): SupportDecision;

  estimateImage(input: ImageGenerationInput): Promise<CostEstimate>;
  estimateVideo(input: VideoGenerationInput): Promise<CostEstimate>;
  estimateAudio(input: AudioGenerationInput): Promise<CostEstimate>;

  generateImage(input: ImageGenerationInput): Promise<GenerationTask>;
  generateVideo(input: VideoGenerationInput): Promise<GenerationTask>;
  generateAudio(input: AudioGenerationInput): Promise<GenerationTask>;

  getTaskStatus(taskId: string, kind: GenerationKind): Promise<GenerationTaskStatus>;

  /** Optional: not every provider can cancel an in-flight task. */
  cancelTask?(taskId: string, kind: GenerationKind): Promise<void>;
}

export type GenerationKind = "image" | "video" | "audio";

export type SupportsQuery = {
  kind: GenerationKind;
  /**
   * The finer-grained routing dimension, where `kind` is the output dimension.
   *
   * Optional so every existing kind-shaped call site keeps working. When it is
   * absent the provider answers about the kind as a whole, which is the older
   * and looser question: a provider that can do text-to-image but not
   * image-to-image will say yes to `kind: "image"` and no to
   * `capability: "image-to-image"`. New call sites should pass it.
   */
  capability?: GenerationCapability;
  ratio?: AspectRatio;
  durationSeconds?: number;
  resolution?: string;
  /** How many reference images the caller intends to send. */
  referenceImageCount?: number;
  mode: ProductionMode;
};

export type SupportDecision =
  | { supported: true }
  /**
   * `reason` is shown to the user, so it says what to change rather than what
   * went wrong: "Kling produces 5s or 10s clips" beats "unsupported duration".
   */
  | { supported: false; reason: string };

/**
 * Thrown when a provider is asked to generate without credentials.
 *
 * A distinct type because the router treats it as a routing failure to fall
 * back from, not as a generation failure to charge for and surface as an error.
 */
export class ProviderNotConfiguredError extends Error {
  readonly providerId: string;
  constructor(providerId: string, envVar: string) {
    super(
      `Provider configuration required: ${providerId} cannot generate because ${envVar} is not set.`,
    );
    this.name = "ProviderNotConfiguredError";
    this.providerId = providerId;
  }
}

/** Thrown when a provider is asked for something `supports()` already refused. */
export class ProviderUnsupportedError extends Error {
  readonly providerId: string;
  constructor(providerId: string, reason: string) {
    super(reason);
    this.name = "ProviderUnsupportedError";
    this.providerId = providerId;
  }
}

/**
 * Origin recorded on every asset a provider yields.
 *
 * Exists so the mock can never be mistaken for a real generation: the value
 * flows into `media_assets.origin` and every surface reads it to decide whether
 * the "Demo output" label is mandatory.
 */
export function originFor(providerId: string): OutputOrigin {
  return providerId === "mock" ? "mock" : "provider";
}
