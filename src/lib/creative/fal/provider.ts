import {
  capabilityForAudioKind,
  checkModelFit,
  isRoutable,
  quantiseDuration,
  type GenerationCapability,
  type GenerationModel,
} from "../capabilities";
import { CREATIVE_ENV, isFalConfigured } from "../env";
import { centsToCredits } from "../modes";
import {
  ProviderNotConfiguredError,
  ProviderUnsupportedError,
  type AudioGenerationInput,
  type CostEstimate,
  type CreativeGenerationProvider,
  type GenerationKind,
  type GenerationQuality,
  type GenerationTask,
  type GenerationTaskStatus,
  type ImageGenerationInput,
  type ProductionMode,
  type SupportDecision,
  type SupportsQuery,
  type VideoGenerationInput,
} from "../types";
import {
  FAL_MODELS,
  falImageSize,
  falMetadata,
  selectFalModel,
  toFalAspectRatio,
  type FalModelMetadata,
} from "./catalog";
import { FalClient } from "./client";

/**
 * fal.ai as a Virally generation provider — the primary real provider.
 *
 * Structured like the Magnific and (removed) MuAPI adapters, with one
 * structural difference forced by fal's own API shape: a poll or a result
 * fetch needs the endpoint id AND the request id (`{endpoint}/requests/{id}`),
 * not the request id alone. Rather than re-selecting a model by kind at poll
 * time — which is what the Magnific adapter does, and which silently polls the
 * wrong model's endpoint the moment two models exist for one kind — the
 * endpoint id travels inside the task id this adapter returns
 * (`${externalModelId}::${requestId}`). Polling a fal run therefore never
 * depends on the catalogue having stayed the same shape between submit and
 * poll.
 *
 * Three vendor properties shape the rest of this adapter:
 *
 * **No webhook is wired up.** fal supports a `fal_webhook` submit parameter,
 * but its payload is signed with a scheme this adapter does not implement, so
 * accepting an inbound callback here would mean trusting an unverified write
 * path into billing — the same reasoning that makes the removed MuAPI webhook
 * an untrusted hint rather than a state transition. Polling is the sole
 * completion path until that signature verification exists.
 *
 * **fal quotes no price at submit or poll time.** Every estimate is
 * `basis: "configured_table"` and `providerCredits` stays null throughout,
 * matching Magnific and the removed MuAPI adapter.
 *
 * **fal reports queue position, not a percentage.** `progress` stays null
 * rather than being synthesised from `queue_position` — a bar interpolated
 * from a queue depth is a claim about remaining work that nothing supports.
 */

export class FalProvider implements CreativeGenerationProvider {
  readonly id = "fal";
  readonly label = "fal.ai";
  readonly credentialEnvVar = CREATIVE_ENV.falApiKey;

  private readonly client: FalClient;
  /**
   * The models this instance may route to. Injectable so the router can hand
   * in the Neon-loaded catalogue; defaults to the shipped array so the adapter
   * stays usable in a unit test and in an unseeded deployment.
   */
  private readonly catalog: readonly GenerationModel[];
  /** Pins model selection. Used when re-polling a run that recorded its model. */
  private readonly modelOverride: string | null;

  constructor(
    options: {
      client?: FalClient;
      catalog?: readonly GenerationModel[];
      modelId?: string;
    } = {},
  ) {
    this.client = options.client ?? new FalClient();
    this.catalog = options.catalog ?? FAL_MODELS;
    this.modelOverride = options.modelId ?? null;
  }

  isConfigured(): boolean {
    return isFalConfigured();
  }

  async listModels(capability?: GenerationCapability): Promise<readonly GenerationModel[]> {
    const routable = this.catalog.filter(isRoutable);
    if (capability === undefined) return routable;
    return routable.filter((model) => model.capabilities.includes(capability));
  }

  supports(query: SupportsQuery): SupportDecision {
    const capability = query.capability ?? defaultCapabilityFor(query.kind);
    const model = this.resolveModel(capability, query.mode, "standard");
    if (!model) {
      return {
        supported: false,
        reason: `fal.ai has no ${capability} model configured for ${query.mode} production.`,
      };
    }

    const fit = checkModelFit(model, {
      capability,
      mode: query.mode,
      ratio: query.ratio,
      durationSeconds: query.durationSeconds,
      resolution: query.resolution,
      referenceImageCount: query.referenceImageCount,
    });
    if (!fit.fits) return { supported: false, reason: fit.reason };

    // flux-dev has no ratio constraint at all (sized by literal width/height),
    // so this only bites the ratio-enum models — checked separately from
    // `checkModelFit` because a ratio the model's own catalogue entry lists is
    // still subject to fal's enum, and a mapping gap on Virally's side produces
    // a different message from a model limitation.
    if (
      query.ratio !== undefined &&
      model.supportedAspectRatios.length > 0 &&
      toFalAspectRatio(query.ratio) === null
    ) {
      return {
        supported: false,
        reason: `fal.ai does not accept ${query.ratio} for ${model.name}. Generate a supported ratio and adapt it in the editor.`,
      };
    }

    return { supported: true };
  }

  // --- Estimates --------------------------------------------------------------

  async estimateImage(input: ImageGenerationInput): Promise<CostEstimate> {
    const hasReference = Boolean(input.styleReferenceUrl ?? input.structureReferenceUrl);
    const model = this.requireModel(
      hasReference ? "image-to-image" : "text-to-image",
      input.mode,
      input.quality,
    );
    return estimateFor(model, 1);
  }

  async estimateVideo(input: VideoGenerationInput): Promise<CostEstimate> {
    const capability = input.referenceImageUrl ? "image-to-video" : "text-to-video";
    const model = this.requireModel(capability, input.mode, input.quality);
    const perClipSeconds = quantiseDuration(model, input.durationSeconds);
    const clips = Math.max(1, Math.ceil(input.durationSeconds / perClipSeconds));
    return estimateFor(model, clips);
  }

  async estimateAudio(input: AudioGenerationInput): Promise<CostEstimate> {
    const capability = capabilityForAudioKind(input.kind);
    const model = this.requireModel(capability, input.mode, input.quality);
    return estimateFor(model, 1);
  }

  // --- Generation -------------------------------------------------------------

  async generateImage(input: ImageGenerationInput): Promise<GenerationTask> {
    const reference = input.structureReferenceUrl ?? input.styleReferenceUrl ?? null;
    const capability = reference ? "image-to-image" : "text-to-image";
    const model = this.requireModel(capability, input.mode, input.quality);
    const metadata = falMetadata(model);

    const payload: Record<string, unknown> = { prompt: input.prompt };

    if (model.supportedAspectRatios.length > 0) {
      const ratio = toFalAspectRatio(input.ratio);
      if (ratio === null) {
        throw new ProviderUnsupportedError(this.id, `fal.ai does not accept ${input.ratio}.`);
      }
      payload.aspect_ratio = ratio;
    } else {
      // flux-dev: no ratio enum, an exact {width, height} instead.
      payload.image_size = falImageSize(input.ratio);
    }

    if (reference) {
      if (!metadata.imageField) {
        throw new ProviderUnsupportedError(this.id, `${model.name} does not accept reference images.`);
      }
      payload[metadata.imageField] = reference;
    }

    if (model.supportsSeed && input.fixedGeneration) {
      payload.seed = stableSeed(input.idempotencyKey);
    }

    return this.submit(model, payload);
  }

  async generateVideo(input: VideoGenerationInput): Promise<GenerationTask> {
    const capability = input.referenceImageUrl ? "image-to-video" : "text-to-video";
    const model = this.requireModel(capability, input.mode, input.quality);
    const metadata = falMetadata(model);

    const ratio = toFalAspectRatio(input.ratio);
    if (ratio === null) {
      throw new ProviderUnsupportedError(this.id, `fal.ai does not accept ${input.ratio} for video.`);
    }

    const duration = quantiseDuration(model, input.durationSeconds);
    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      aspect_ratio: ratio,
      // Kling's own schema types duration as a string enum ("5" | "10"), not a
      // number — confirmed on the Magnific adapter's identical Kling models and
      // carried over here for the same vendor model.
      duration: String(duration),
    };
    if (input.negativePrompt && model.supportsNegativePrompt) {
      payload.negative_prompt = input.negativePrompt;
    }
    if (input.referenceImageUrl) {
      if (!metadata.imageField) {
        throw new ProviderUnsupportedError(this.id, `${model.name} does not accept a reference image.`);
      }
      payload[metadata.imageField] = input.referenceImageUrl;
    }

    return this.submit(model, payload);
  }

  async generateAudio(input: AudioGenerationInput): Promise<GenerationTask> {
    const capability = capabilityForAudioKind(input.kind);
    const model = this.requireModel(capability, input.mode, input.quality);
    const metadata = falMetadata(model);

    const payload: Record<string, unknown> = { prompt: input.prompt };
    if (metadata.durationField) {
      payload[metadata.durationField] = Math.max(1, Math.round(input.durationSeconds));
    }

    return this.submit(model, payload);
  }

  async getTaskStatus(taskId: string, _kind: GenerationKind): Promise<GenerationTaskStatus> {
    this.assertConfigured();
    const { endpointId, requestId } = parseTaskId(this.id, taskId);
    const status = await this.client.status(endpointId, requestId);

    if (status.errorMessage !== null) {
      return failedStatus(requestId, status.errorMessage);
    }
    if (status.state !== "COMPLETED") {
      return {
        externalTaskId: requestId,
        state: status.state === "IN_QUEUE" ? "submitted" : "generating",
        progress: null,
        media: [],
        failure: null,
        providerCredits: null,
      };
    }

    const model = this.catalog.find((each) => each.externalModelId === endpointId) ?? null;
    const metadata = model ? falMetadata(model) : {};
    const result = await this.client.result(endpointId, requestId);
    const media = extractMedia(result, metadata);

    if (media.length === 0) {
      return failedStatus(requestId, "fal.ai reported the task complete but returned no output.");
    }

    return {
      externalTaskId: requestId,
      // `downloading`, not `completed` — only ingestion may make that
      // transition. `applyStatus` throws if asked to write `completed` directly.
      state: "downloading",
      progress: 100,
      media,
      failure: null,
      providerCredits: null,
    };
  }

  async cancelTask(taskId: string): Promise<void> {
    this.assertConfigured();
    const { endpointId, requestId } = parseTaskId(this.id, taskId);
    await this.client.cancel(endpointId, requestId);
  }

  // --- Internals --------------------------------------------------------------

  private async submit(
    model: GenerationModel,
    payload: Record<string, unknown>,
  ): Promise<GenerationTask> {
    this.assertConfigured();
    const submission = await this.client.submit(model.externalModelId, payload);

    return {
      // Composite so a poll never has to guess which endpoint a request id
      // belongs to. See the class-level doc comment.
      externalTaskId: `${model.externalModelId}::${submission.requestId}`,
      providerId: this.id,
      model: model.id,
      state: "submitted",
      // fal gives no polling hint in the submit response. Three seconds sits
      // between Magnific's image cadence and its video cadence.
      suggestedPollMs: 3_000,
    };
  }

  private resolveModel(
    capability: GenerationCapability,
    mode: ProductionMode,
    quality: GenerationQuality,
  ): GenerationModel | null {
    if (this.modelOverride) {
      const pinned = this.catalog.find((model) => model.id === this.modelOverride);
      if (pinned) return pinned;
    }
    return selectFalModel(capability, mode, quality, this.catalog);
  }

  private requireModel(
    capability: GenerationCapability,
    mode: ProductionMode,
    quality: GenerationQuality,
  ): GenerationModel {
    const model = this.resolveModel(capability, mode, quality);
    if (!model) {
      throw new ProviderUnsupportedError(
        this.id,
        `fal.ai has no ${capability} model configured for ${mode} production.`,
      );
    }
    return model;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError(this.id, this.credentialEnvVar);
    }
  }
}

// --- Task id encoding ---------------------------------------------------------

function parseTaskId(providerId: string, taskId: string): { endpointId: string; requestId: string } {
  const separator = taskId.lastIndexOf("::");
  if (separator <= 0 || separator === taskId.length - 2) {
    throw new ProviderUnsupportedError(
      providerId,
      "This task id was not issued by the fal.ai adapter and cannot be polled.",
    );
  }
  return { endpointId: taskId.slice(0, separator), requestId: taskId.slice(separator + 2) };
}

// --- Mapping ------------------------------------------------------------------

function failedStatus(requestId: string, message: string): GenerationTaskStatus {
  return {
    externalTaskId: requestId,
    state: "failed",
    progress: null,
    media: [],
    failure: {
      code: "provider_failed",
      message: `fal.ai could not complete the generation: ${message}`,
      // A task that reached the provider and failed there will fail the same
      // way on resubmission unless something changes about the request.
      retryable: false,
      // Conservative: fal does not say whether a failed run was billed, and
      // assuming it was not is how a real cost gets silently absorbed.
      costIncurred: true,
    },
    providerCredits: null,
  };
}

/**
 * Pulls media URLs out of a model's result body.
 *
 * `outputField` comes from the catalogue entry that matched the endpoint id,
 * never guessed from the response shape — fal's image models return
 * `images: [{url}]`, its video models return a single `video: {url}`, and its
 * audio models return a single object under a model-specific key (Kokoro's
 * `audio`, Stable Audio's `audio_file`) — `metadata.audioField` names which,
 * and there is no field that reliably tells any of these apart on its own.
 */
function extractMedia(
  result: unknown,
  metadata: FalModelMetadata,
): GenerationTaskStatus["media"] {
  if (!isRecord(result)) return [];
  const outputField = metadata.outputField;

  if (outputField === "video") return extractSingleFile(result.video);
  if (outputField === "audio") return extractSingleFile(result[metadata.audioField ?? "audio"]);

  if (outputField === "images" || outputField === undefined) {
    const images = result.images;
    if (!Array.isArray(images)) return [];
    return images
      .filter(isRecord)
      .filter((image): image is Record<string, unknown> & { url: string } => typeof image.url === "string" && image.url !== "")
      .map((image) => ({
        url: image.url,
        mimeType: typeof image.content_type === "string" ? image.content_type : null,
        widthPx: typeof image.width === "number" ? image.width : null,
        heightPx: typeof image.height === "number" ? image.height : null,
        durationMs: null,
      }));
  }

  return [];
}

/** Shared shape of a fal video or audio result: one file under one key. */
function extractSingleFile(file: unknown): GenerationTaskStatus["media"] {
  if (isRecord(file) && typeof file.url === "string" && file.url !== "") {
    return [
      {
        url: file.url,
        mimeType: typeof file.content_type === "string" ? file.content_type : null,
        widthPx: null,
        heightPx: null,
        durationMs: null,
      },
    ];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// --- Cost -----------------------------------------------------------------

function estimateFor(model: GenerationModel, units: number): CostEstimate {
  const perUnit = model.estimatedCentsPerUnit ?? 0;
  const internalCents = perUnit * Math.max(1, units);
  return {
    // Always null: fal publishes no price in any queue-API response.
    providerCredits: null,
    internalCents,
    internalCredits: centsToCredits(internalCents),
    basis: "configured_table",
  };
}

/**
 * Derives a stable, fal-acceptable seed from an idempotency key.
 *
 * `ImageGenerationInput.fixedGeneration` promises a reproducible regeneration,
 * but carries no numeric seed of its own — the idempotency key is the only
 * stable input available, so it is hashed into fal's `seed` range rather than
 * left unimplemented. FNV-1a, chosen for the same reason the mock provider
 * uses it: short, dependency-free, and stable across processes.
 */
function stableSeed(idempotencyKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < idempotencyKey.length; i += 1) {
    hash ^= idempotencyKey.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // fal documents no explicit upper bound; kept within a signed 32-bit range,
  // which every model's own generator accepts.
  return hash % 2_147_483_647;
}

/**
 * The capability assumed when a caller asks about a kind without naming one.
 * Text-first, matching the removed MuAPI adapter's default.
 */
function defaultCapabilityFor(kind: GenerationKind): GenerationCapability {
  if (kind === "image") return "text-to-image";
  if (kind === "video") return "text-to-video";
  return "music";
}
