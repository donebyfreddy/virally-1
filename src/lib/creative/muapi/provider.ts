import {
  checkModelFit,
  isRoutable,
  quantiseDuration,
  type GenerationCapability,
  type GenerationModel,
} from "../capabilities";
import { CREATIVE_ENV, isMuApiConfigured } from "../env";
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
  type GenerationTaskState,
  type GenerationTaskStatus,
  type ImageGenerationInput,
  type ProductionMode,
  type SupportDecision,
  type SupportsQuery,
  type VideoGenerationInput,
} from "../types";
import {
  MUAPI_MODELS,
  muApiMetadata,
  selectMuApiModel,
  toMuApiAspectRatio,
} from "./catalog";
import { MuApiClient, type MuApiResult } from "./client";

/**
 * MuAPI as a Virally generation provider.
 *
 * A SECOND provider, not a replacement for Magnific. It exists because MuAPI
 * aggregates model families Magnific does not carry — lip-sync, music with
 * vocals, a much wider video catalogue — and because having two real providers
 * is what turns the router's fallback path from theory into something exercised
 * on every deployment where one of the two is unconfigured.
 *
 * Three vendor properties shape this adapter, and each one is a place where
 * doing the obvious thing would be wrong:
 *
 * **MuAPI reports no progress.** There is no percentage field. Every status
 * carries `progress: null` and the UI renders an indeterminate indicator. A bar
 * interpolated against elapsed time is a lie about how much work is left.
 *
 * **MuAPI quotes no price.** Not in the catalogue, not at submit, not at poll.
 * Every estimate is `basis: "configured_table"` and `providerCredits` is always
 * null. Reconciliation is against the account balance endpoint, out of band.
 *
 * **MuAPI's endpoint slugs are not derivable.** `flux-dev` posts to
 * `flux-dev-image`. Slugs come from the catalogue and nowhere else — never from
 * a model name, and never from user input, which is what keeps this adapter
 * from becoming the open relay the upstream project's middleware is.
 *
 * There is deliberately no `cancelTask`. MuAPI publishes no cancellation
 * endpoint, and the interface makes it optional precisely so an adapter can
 * decline rather than implement a no-op that reports success while the task
 * keeps running and billing.
 */

export class MuApiProvider implements CreativeGenerationProvider {
  readonly id = "muapi";
  readonly label = "MuAPI";
  readonly credentialEnvVar = CREATIVE_ENV.muapiApiKey;

  private readonly client: MuApiClient;
  /**
   * The models this instance may route to.
   *
   * Injectable so the router can hand in the catalogue loaded from Neon, which
   * is the authoritative one, while the default keeps the adapter usable in a
   * unit test and in an unseeded deployment. The shipped array is the truth
   * about what the VENDOR's models can do — ratios, durations, payload field
   * names — and the database is the truth about which of them Virally currently
   * offers and at what price. Neither subsumes the other.
   */
  private readonly catalog: readonly GenerationModel[];
  /** Pins model selection. Used when re-polling a run that recorded its model. */
  private readonly modelOverride: string | null;

  constructor(
    options: {
      client?: MuApiClient;
      catalog?: readonly GenerationModel[];
      modelId?: string;
    } = {},
  ) {
    this.client = options.client ?? new MuApiClient();
    this.catalog = options.catalog ?? MUAPI_MODELS;
    this.modelOverride = options.modelId ?? null;
  }

  isConfigured(): boolean {
    return isMuApiConfigured();
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
        reason: `MuAPI has no ${capability} model configured for ${query.mode} production.`,
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

    // Checked separately from `checkModelFit` because a ratio the model lists
    // but Virally cannot express in MuAPI's vocabulary is a mapping gap on our
    // side, not a model limitation — and it produces a different message.
    if (query.ratio !== undefined && toMuApiAspectRatio(query.ratio) === null) {
      return {
        supported: false,
        reason: `MuAPI does not accept ${query.ratio}. Generate a supported ratio and adapt it in the editor.`,
      };
    }

    return { supported: true };
  }

  // --- Estimates --------------------------------------------------------------
  //
  // All three are `configured_table`. MuAPI publishes no prices at all, so
  // presenting any of these as a provider quote would misrepresent a figure
  // Virally chose as one the vendor stated.

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
    // Priced per clip, and a long shot needs several. Quoting one clip's price
    // for a 30s shot under-quotes by a factor of three, and the reservation made
    // against that quote would then be short by the same factor.
    const perClipSeconds = quantiseDuration(model, input.durationSeconds);
    const clips = Math.max(1, Math.ceil(input.durationSeconds / perClipSeconds));
    return estimateFor(model, clips);
  }

  async estimateAudio(input: AudioGenerationInput): Promise<CostEstimate> {
    const capability = input.kind === "music" ? "music" : "sound-effect";
    const model = this.requireModel(capability, input.mode, input.quality);
    return estimateFor(model, 1);
  }

  // --- Generation -------------------------------------------------------------

  async generateImage(input: ImageGenerationInput): Promise<GenerationTask> {
    const references = [input.structureReferenceUrl, input.styleReferenceUrl].filter(
      (url): url is string => typeof url === "string" && url !== "",
    );
    const capability = references.length > 0 ? "image-to-image" : "text-to-image";
    const model = this.requireModel(capability, input.mode, input.quality);

    const payload: Record<string, unknown> = { prompt: input.prompt };
    applyAspectRatio(payload, model, input.ratio, this.id);
    if (input.resolution && model.supportedResolutions.includes(input.resolution)) {
      payload.resolution = input.resolution;
    }
    if (input.negativePrompt && model.supportsNegativePrompt) {
      payload.negative_prompt = input.negativePrompt;
    }
    applyReferenceImages(payload, model, references, this.id);

    return this.submit(model, payload, input.webhookUrl);
  }

  async generateVideo(input: VideoGenerationInput): Promise<GenerationTask> {
    const capability = input.referenceImageUrl ? "image-to-video" : "text-to-video";
    const model = this.requireModel(capability, input.mode, input.quality);
    const metadata = muApiMetadata(model);

    const payload: Record<string, unknown> = {};
    // A few MuAPI endpoints take no prompt at all and reject one. The catalogue
    // records which, because sending a field the endpoint does not know is a
    // 422 on some models and a silent no-op on others.
    if (metadata.hasPrompt !== false) payload.prompt = input.prompt;

    applyAspectRatio(payload, model, input.ratio, this.id);

    const duration = quantiseDuration(model, input.durationSeconds);
    // Numeric here, unlike Magnific's Kling endpoint which types duration as a
    // string enum. Copied from the observed MuAPI schemas rather than assumed.
    if (model.supportedDurations.length > 0) payload.duration = duration;

    if (input.negativePrompt && model.supportsNegativePrompt) {
      payload.negative_prompt = input.negativePrompt;
    }
    if (input.generateAudio !== undefined && model.supportsAudio) {
      payload.generate_audio = input.generateAudio;
    }
    if (input.referenceImageUrl) {
      applyReferenceImages(payload, model, [input.referenceImageUrl], this.id);
    }

    return this.submit(model, payload, input.webhookUrl);
  }

  async generateAudio(input: AudioGenerationInput): Promise<GenerationTask> {
    const capability = input.kind === "music" ? "music" : "sound-effect";
    const model = this.requireModel(capability, input.mode, input.quality);

    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      duration: Math.max(1, Math.round(input.durationSeconds)),
    };

    return this.submit(model, payload, input.webhookUrl);
  }

  /**
   * Polls one task.
   *
   * `kind` is unused, unlike the Magnific adapter where the status path is the
   * submit path and therefore model-dependent. MuAPI polls a single uniform
   * endpoint for every model, so the parameter is accepted only to satisfy the
   * interface. Named with an underscore to say that deliberately rather than
   * leaving a reader to wonder whether its omission is a bug.
   */
  async getTaskStatus(taskId: string, _kind: GenerationKind): Promise<GenerationTaskStatus> {
    this.assertConfigured();
    const result = await this.client.result(taskId);
    return toStatus(result);
  }

  // --- Internals --------------------------------------------------------------

  private async submit(
    model: GenerationModel,
    payload: Record<string, unknown>,
    webhookUrl: string | undefined,
  ): Promise<GenerationTask> {
    this.assertConfigured();

    // MuAPI accepts a `webhook` callback but publishes no signature scheme, so
    // the receiving route treats a hit as an untrusted hint that merely
    // schedules an earlier poll. The URL itself carries a per-run unguessable
    // token; it is built by the caller, and this adapter only forwards it.
    if (webhookUrl) payload.webhook = webhookUrl;

    const submission = await this.client.submit(model.externalModelId, payload);

    if (submission.kind === "inline") {
      // The endpoint answered without queueing. Real MuAPI behaviour for a few
      // tools. Reported as `downloading` rather than `completed` for the same
      // reason every other path is: nothing is complete until the bytes are in
      // Virally storage, and `applyStatus` refuses to write `completed` at all.
      return {
        externalTaskId: inlineTaskId(model, payload),
        providerId: this.id,
        model: model.id,
        state: "downloading",
        suggestedPollMs: 0,
      };
    }

    return {
      externalTaskId: submission.requestId,
      providerId: this.id,
      model: model.id,
      state: "submitted",
      // MuAPI gives no polling hint. Two seconds matches the cadence the vendor's
      // own tooling uses; the worker applies backoff on top of it.
      suggestedPollMs: 2_000,
    };
  }

  /**
   * Picks a model, honouring an explicit override.
   *
   * The override exists so a run being re-polled or retried uses the model it
   * originally submitted to, rather than whatever selection would pick today —
   * a catalogue change between submit and retry would otherwise silently move a
   * generation to a different model at a different price.
   */
  private resolveModel(
    capability: GenerationCapability,
    mode: ProductionMode,
    quality: GenerationQuality,
  ): GenerationModel | null {
    if (this.modelOverride) {
      const pinned = this.catalog.find((model) => model.id === this.modelOverride);
      if (pinned) return pinned;
    }
    return selectMuApiModel(capability, mode, quality, this.catalog);
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
        `MuAPI has no ${capability} model configured for ${mode} production.`,
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

// --- Payload shaping ----------------------------------------------------------

/**
 * Places reference images in whichever payload key the model expects.
 *
 * This is the one piece of genuine MuAPI domain knowledge in the adapter, and
 * the reason the catalogue records `imageField` per model: there is no uniform
 * key. Some endpoints take `image_url`, some `start_image`, some an
 * `images_list` array — and sending the wrong one is not an error, it is a
 * successful generation that quietly ignored the reference and billed for it.
 * That failure is invisible to every automated check and only shows up as "the
 * output does not look like my reference photo".
 */
function applyReferenceImages(
  payload: Record<string, unknown>,
  model: GenerationModel,
  urls: readonly string[],
  providerId: string,
): void {
  if (urls.length === 0) return;

  const metadata = muApiMetadata(model);
  const field = metadata.imageField;
  const allowed = model.maxReferenceImages ?? 0;

  // Checked before the count, and before the field. "Accepts up to 0 reference
  // images" is technically true and tells the user nothing they can act on;
  // the two conditions also arrive together for any correctly catalogued model,
  // so which one is reported is purely a question of which message helps.
  if (allowed === 0 || !field) {
    throw new ProviderUnsupportedError(
      providerId,
      `${model.name} does not accept reference images.`,
    );
  }

  if (urls.length > allowed) {
    const plural = allowed === 1 ? "image" : "images";
    throw new ProviderUnsupportedError(
      providerId,
      `${model.name} accepts up to ${allowed} reference ${plural}, and ${urls.length} were supplied.`,
    );
  }

  if (metadata.imageFieldIsList) {
    payload[field] = [...urls];
    return;
  }
  payload[field] = urls[0];
  // A second reference is only placed when the model declares somewhere to put
  // it. Silently dropping it would be worse than the error above, but so would
  // inventing a field name.
  if (urls.length > 1 && metadata.lastImageField) {
    payload[metadata.lastImageField] = urls[1];
  }
}

function applyAspectRatio(
  payload: Record<string, unknown>,
  model: GenerationModel,
  ratio: Parameters<typeof toMuApiAspectRatio>[0],
  providerId: string,
): void {
  if (model.supportedAspectRatios.length === 0) return;
  const mapped = toMuApiAspectRatio(ratio);
  if (mapped === null) {
    throw new ProviderUnsupportedError(providerId, `MuAPI does not accept ${ratio}.`);
  }
  payload.aspect_ratio = mapped;
}

/**
 * A synthetic task id for an endpoint that answered inline.
 *
 * Prefixed so it can never collide with a real MuAPI request id, and so a
 * support engineer reading a run row can tell immediately that no external task
 * exists to poll.
 */
function inlineTaskId(model: GenerationModel, payload: Record<string, unknown>): string {
  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  return `muapi-inline-${model.id}-${fnv1a(`${model.id}:${prompt}`)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// --- Mapping ------------------------------------------------------------------

/**
 * Maps a MuAPI result onto Virally's task state.
 *
 * `succeeded` becomes `downloading`, never `completed`. The rule is enforced
 * one layer down too — `applyStatus` throws on `completed` — but stating it
 * here as well keeps an adapter author from having to discover it by hitting
 * the exception.
 */
export function toState(state: MuApiResult["state"]): GenerationTaskState {
  switch (state) {
    case "queued":
      return "submitted";
    case "running":
      return "generating";
    case "succeeded":
      return "downloading";
    case "failed":
      return "failed";
  }
}

export function toStatus(result: MuApiResult): GenerationTaskStatus {
  const state = toState(result.state);

  return {
    externalTaskId: result.requestId,
    state,
    // Never synthesised. MuAPI publishes no progress field.
    progress: null,
    media: result.outputs.map((url) => ({
      url,
      // All four are unknown until the bytes are downloaded and probed. Guessing
      // a MIME type from a URL extension is how a .mp4 served as octet-stream
      // ends up filed as an image.
      mimeType: null,
      widthPx: null,
      heightPx: null,
      durationMs: null,
    })),
    failure:
      state === "failed"
        ? {
            code: "provider_failed",
            message: result.errorMessage
              ? `MuAPI could not complete the generation: ${result.errorMessage}`
              : "MuAPI could not complete the generation.",
            // A task that reached the provider and failed there will fail the
            // same way on resubmission unless something changes. Marked
            // non-retryable so the worker does not burn attempts on it; a user
            // can still retry explicitly after editing the request.
            retryable: false,
            // Conservative. MuAPI does not say whether a failed generation was
            // billed, and assuming it was not is how a real cost gets silently
            // absorbed.
            costIncurred: true,
          }
        : null,
    // MuAPI never reports a cost on a generation call.
    providerCredits: null,
  };
}

// --- Cost ---------------------------------------------------------------------

function estimateFor(model: GenerationModel, units: number): CostEstimate {
  const perUnit = model.estimatedCentsPerUnit ?? 0;
  const internalCents = perUnit * Math.max(1, units);
  return {
    // Always null: MuAPI publishes no price in any response.
    providerCredits: null,
    internalCents,
    // Shared with every other provider rather than reimplemented, so a change
    // to the credit rate cannot apply to one provider's quotes and not another's.
    internalCredits: centsToCredits(internalCents),
    basis: "configured_table",
  };
}

/**
 * The capability assumed when a caller asks about a kind without naming one.
 *
 * Text-first, because that is the request every capability's simplest form
 * reduces to and the one a kind-shaped legacy call site means.
 */
function defaultCapabilityFor(kind: GenerationKind): GenerationCapability {
  if (kind === "image") return "text-to-image";
  if (kind === "video") return "text-to-video";
  return "music";
}
