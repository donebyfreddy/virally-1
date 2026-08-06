import {
  isRoutable,
  type GenerationCapability,
  type GenerationModel,
} from "../capabilities";
import { CREATIVE_ENV, isMagnificConfigured } from "../env";
import { centsToCredits } from "../modes";
import type {
  AudioGenerationInput,
  CostEstimate,
  CreativeGenerationProvider,
  GenerationKind,
  GenerationTask,
  GenerationTaskState,
  GenerationTaskStatus,
  ImageGenerationInput,
  SupportDecision,
  SupportsQuery,
  VideoGenerationInput,
} from "../types";
import { ProviderNotConfiguredError, ProviderUnsupportedError } from "../types";
import type { MagnificModel, MagnificTaskStatus } from "./catalog";
import {
  MAGNIFIC_MODELS_NORMALISED,
  findModel,
  quantiseDuration,
  selectModel,
  toMagnificImageRatio,
  toMagnificVideoRatio,
} from "./catalog";
import { MagnificClient } from "./client";
import type { MagnificTaskEnvelope } from "./client";

/**
 * Magnific adapter.
 *
 * Implements the async workflow Magnific actually publishes: POST returns a
 * `task_id` with status `CREATED`, and the caller either polls
 * `GET {path}/{task-id}` or receives a webhook.
 *
 * Two limits of the real API shape the code and are worth stating, because both
 * look like omissions otherwise:
 *
 * Magnific's task response carries no progress field. `progress` is therefore
 * derived from the coarse status only — 0 at CREATED, null while IN_PROGRESS —
 * and never interpolated against elapsed time. A moving bar that is not backed
 * by provider data is a lie about how much work is left.
 *
 * Magnific's task response carries no cost field either. `providerCredits`
 * stays null on every status read; the real figure comes from the
 * `/v1/analytics/team-credit-usage` endpoint during reconciliation, not from
 * the generation call.
 */

/** Terminal task id used to record a submit that never got one. */
const NO_TASK_ID = "";

export class MagnificProvider implements CreativeGenerationProvider {
  readonly id = "magnific";
  readonly label = "Magnific";
  readonly credentialEnvVar = CREATIVE_ENV.magnificApiKey;

  private readonly client: MagnificClient;
  /** Overrides model selection; used by the router and by tests. */
  private readonly modelOverride: string | null;
  private readonly catalog: readonly GenerationModel[];

  constructor(
    options: {
      client?: MagnificClient;
      modelId?: string;
      catalog?: readonly GenerationModel[];
    } = {},
  ) {
    this.client = options.client ?? new MagnificClient();
    this.modelOverride = options.modelId ?? null;
    this.catalog = options.catalog ?? MAGNIFIC_MODELS_NORMALISED;
  }

  isConfigured(): boolean {
    return isMagnificConfigured();
  }

  /**
   * The catalogue in its normalized, cross-provider shape.
   *
   * Derived from `MAGNIFIC_MODELS` rather than maintained as a second list, so
   * the two cannot drift. Injectable via the constructor for the same reason
   * the fal adapter's is: the authoritative catalogue at runtime is
   * `generation_models` in Neon, and the shipped array is the seed.
   */
  async listModels(capability?: GenerationCapability): Promise<readonly GenerationModel[]> {
    const routable = this.catalog.filter(isRoutable);
    if (capability === undefined) return routable;
    return routable.filter((model) => model.capabilities.includes(capability));
  }

  supports(query: SupportsQuery): SupportDecision {
    const model = this.resolveModel(query.kind, query.mode, "standard");
    if (!model) {
      return {
        supported: false,
        reason: `Magnific has no ${query.kind} model configured for ${query.mode} production.`,
      };
    }

    if (query.ratio) {
      const mapped = mapRatio(query.kind, query.ratio);
      if (mapped === null) {
        return {
          supported: false,
          // Says what to pick, not just what failed — video really is limited to
          // three ratios and the user needs to know which.
          reason:
            query.kind === "video"
              ? `Magnific video models produce 9:16, 1:1 or 16:9 only. ${query.ratio} is not available; generate 9:16 and adapt it in the editor.`
              : `Magnific cannot generate ${query.ratio} images.`,
        };
      }
    }

    if (query.kind === "video" && query.durationSeconds !== undefined) {
      const longest = Math.max(...model.allowedDurations);
      if (Number.isFinite(longest) && query.durationSeconds > longest) {
        return {
          supported: false,
          reason: `${model.label} produces clips of ${model.allowedDurations.join(" or ")} seconds. A ${query.durationSeconds}s shot must be split across several clips.`,
        };
      }
    }

    return { supported: true };
  }

  // --- Estimates ------------------------------------------------------------
  //
  // All three are `configured_table`: Magnific does not quote a price at submit
  // time, so presenting these as a provider quote would misrepresent where the
  // number came from.

  async estimateImage(input: ImageGenerationInput): Promise<CostEstimate> {
    const model = this.requireModel("image", input.mode, input.quality);
    return estimateFor(model, 1);
  }

  async estimateVideo(input: VideoGenerationInput): Promise<CostEstimate> {
    const model = this.requireModel("video", input.mode, input.quality);
    // Priced per clip, and a long shot needs several clips. Charging one clip's
    // price for a 30s shot would under-quote by a factor of three.
    const seconds = quantiseDuration(model, input.durationSeconds);
    const clips = Math.max(1, Math.ceil(input.durationSeconds / seconds));
    return estimateFor(model, clips);
  }

  async estimateAudio(input: AudioGenerationInput): Promise<CostEstimate> {
    const model = this.requireModel("audio", input.mode, input.quality);
    return estimateFor(model, 1);
  }

  // --- Generation -----------------------------------------------------------

  async generateImage(input: ImageGenerationInput): Promise<GenerationTask> {
    const model = this.requireModel("image", input.mode, input.quality);
    const ratio = toMagnificImageRatio(input.ratio);
    if (ratio === null) {
      throw new ProviderUnsupportedError(this.id, `Magnific cannot generate ${input.ratio} images.`);
    }

    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      aspect_ratio: ratio,
      resolution: input.resolution ?? (input.quality === "high" ? "4k" : "2k"),
      // Never disabled. Magnific documents this as non-disableable for standard
      // usage, and Virally has no reason to attempt it.
      filter_nsfw: true,
    };
    if (input.fixedGeneration) payload.fixed_generation = true;
    if (input.styleReferenceUrl) payload.style_reference = input.styleReferenceUrl;
    if (input.structureReferenceUrl) payload.structure_reference = input.structureReferenceUrl;
    if (input.webhookUrl) payload.webhook_url = input.webhookUrl;

    return this.submit(model, payload);
  }

  async generateVideo(input: VideoGenerationInput): Promise<GenerationTask> {
    const model = this.requireModel("video", input.mode, input.quality);
    const ratio = toMagnificVideoRatio(input.ratio);
    if (ratio === null) {
      throw new ProviderUnsupportedError(
        this.id,
        `Magnific video models produce 9:16, 1:1 or 16:9 only, not ${input.ratio}.`,
      );
    }

    const duration = quantiseDuration(model, input.durationSeconds);

    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      aspect_ratio: ratio,
      // Kling's schema types duration as a STRING enum, not a number. Sending 5
      // instead of "5" is a 400.
      duration: String(duration),
    };
    if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
    if (input.generateAudio !== undefined) payload.generate_audio = input.generateAudio;
    // Presence of an image is what selects image-to-video over text-to-video on
    // Magnific's anyOf request schema.
    if (input.referenceImageUrl) payload.image = input.referenceImageUrl;
    if (input.webhookUrl) payload.webhook_url = input.webhookUrl;

    return this.submit(model, payload);
  }

  async generateAudio(input: AudioGenerationInput): Promise<GenerationTask> {
    const wanted = input.kind === "music" ? "magnific.music-generation" : "magnific.sound-effects";
    const model = findModel(wanted);
    if (!model) throw new ProviderUnsupportedError(this.id, `No Magnific model for ${input.kind}.`);
    this.assertConfigured();

    const payload: Record<string, unknown> = { prompt: input.prompt };
    if (input.kind === "music") {
      payload.music_length_seconds = Math.max(1, Math.round(input.durationSeconds));
    } else {
      payload.duration_seconds = Math.max(1, Math.round(input.durationSeconds));
    }
    if (input.webhookUrl) payload.webhook_url = input.webhookUrl;

    return this.submit(model, payload);
  }

  async getTaskStatus(taskId: string, kind: GenerationKind): Promise<GenerationTaskStatus> {
    this.assertConfigured();
    // The status path is the submit path, so the model must be recoverable. The
    // caller passes the kind; the persisted run row carries the exact model id,
    // which `resolveModel` honours via the override.
    const model = this.requireModel(kind, "hybrid", "standard");
    const envelope = await this.client.status(model.path, taskId);
    return toStatus(envelope);
  }

  // --- Internals ------------------------------------------------------------

  private async submit(
    model: MagnificModel,
    payload: Record<string, unknown>,
  ): Promise<GenerationTask> {
    this.assertConfigured();
    const envelope = await this.client.submit(model.path, payload);
    return {
      externalTaskId: envelope.data.task_id,
      providerId: this.id,
      model: model.id,
      state: toState(envelope.data.status),
      // Magnific publishes no Retry-After on task creation, so this is our own
      // pacing choice rather than a provider instruction. Video is slower than
      // image by roughly an order of magnitude, so they poll differently.
      suggestedPollMs: model.kind === "video" ? 10_000 : 3_000,
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError(this.id, CREATIVE_ENV.magnificApiKey);
    }
  }

  private resolveModel(
    kind: GenerationKind,
    mode: SupportsQuery["mode"],
    quality: ImageGenerationInput["quality"],
  ): MagnificModel | null {
    if (this.modelOverride) {
      const pinned = findModel(this.modelOverride);
      // An override for the wrong kind is a programming error, not a fallback
      // condition — silently ignoring it would generate the wrong media type.
      if (pinned?.kind === kind) return pinned;
      if (pinned) return null;
    }
    return selectModel(kind, mode, quality);
  }

  private requireModel(
    kind: GenerationKind,
    mode: SupportsQuery["mode"],
    quality: ImageGenerationInput["quality"],
  ): MagnificModel {
    const model = this.resolveModel(kind, mode, quality);
    if (!model) {
      throw new ProviderUnsupportedError(
        this.id,
        `Magnific has no ${kind} model available for ${mode} production.`,
      );
    }
    return model;
  }
}

/**
 * Maps a ratio for the given kind, or "n/a" for kinds that have no ratio.
 *
 * Audio returns a non-null sentinel rather than null because null here means
 * "this provider cannot do that ratio", and audio having no ratio at all is a
 * different thing entirely.
 */
function mapRatio(kind: GenerationKind, ratio: SupportsQuery["ratio"]): string | null {
  if (ratio === undefined) return "n/a";
  if (kind === "video") return toMagnificVideoRatio(ratio);
  if (kind === "image") return toMagnificImageRatio(ratio);
  return "n/a";
}

/** Builds an estimate from the configured cost table. */
function estimateFor(model: MagnificModel, units: number): CostEstimate {
  const cents = model.estimatedCentsPerUnit * Math.max(1, Math.trunc(units));
  return {
    // Magnific does not return a credit figure at submit time. Null is the
    // honest value; a computed stand-in would be indistinguishable from a real
    // quote in the usage dashboard.
    providerCredits: null,
    internalCents: cents,
    internalCredits: centsToCredits(cents),
    basis: "configured_table",
  };
}

/**
 * Maps Magnific's four states onto ours.
 *
 * `COMPLETED` maps to `downloading`, NOT `completed`. Magnific being finished
 * means the bytes exist at an expiring URL, not that Virally owns them — and
 * the brief forbids reporting completion before ingestion. Only the download
 * step may advance a run to `completed`.
 */
export function toState(status: MagnificTaskStatus): GenerationTaskState {
  switch (status) {
    case "CREATED":
      return "submitted";
    case "IN_PROGRESS":
      return "generating";
    case "COMPLETED":
      return "downloading";
    case "FAILED":
      return "failed";
  }
}

/**
 * Progress from Magnific's coarse status.
 *
 * Only the two endpoints of the range are knowable. Magnific's task response
 * carries no percentage field, so anything in between stays null and the UI
 * renders an indeterminate indicator — a bar interpolated against elapsed time
 * is a claim about remaining work that nothing supports.
 */
function progressFor(status: MagnificTaskStatus): number | null {
  if (status === "CREATED") return 0;
  if (status === "COMPLETED") return 100;
  return null;
}

export function toStatus(envelope: MagnificTaskEnvelope): GenerationTaskStatus {
  const { task_id: taskId, status, generated } = envelope.data;
  const state = toState(status);

  return {
    externalTaskId: taskId || NO_TASK_ID,
    state,
    progress: progressFor(status),
    media: generated.map((url) => ({
      url,
      // Magnific returns bare URLs with no metadata. Dimensions, duration and
      // MIME type are measured by FFmpeg after download (Phase 5) rather than
      // guessed from the file extension.
      mimeType: null,
      widthPx: null,
      heightPx: null,
      durationMs: null,
    })),
    failure:
      status === "FAILED"
        ? {
            code: "provider_failed",
            message: "Magnific could not complete this generation.",
            // A failed generation may still be retried with the same prompt;
            // whether it is worth doing is the worker's attempt-count decision.
            retryable: true,
            // Magnific does not bill failed tasks, per its credit documentation.
            costIncurred: false,
          }
        : null,
    providerCredits: null,
  };
}
