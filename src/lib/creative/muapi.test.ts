/**
 * @vitest-environment node
 *
 * Node, not the project's default jsdom. `src/lib/creative/env.ts` throws on
 * sight of a `window`, deliberately, so that a client component importing it
 * fails at the import boundary rather than silently receiving `undefined` and
 * degrading to mock — which would look like a configuration problem instead of
 * the credential leak it actually is. Any test that touches a provider adapter
 * therefore has to run server-side, exactly as the adapter does in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERATION_CAPABILITIES,
  checkModelFit,
  isRoutable,
  kindForCapability,
  quantiseDuration,
  requiredInputsFor,
  requiresConsent,
  type GenerationModel,
} from "./capabilities";
import { MockCreativeProvider } from "./mock";
import {
  MUAPI_MODELS,
  findMuApiModel,
  muApiMetadata,
  selectMuApiModel,
  toMuApiAspectRatio,
} from "./muapi/catalog";
import { MuApiClient, mapFailure, parseResult, parseSubmit } from "./muapi/client";
import { MuApiProvider, toState, toStatus } from "./muapi/provider";
import { ProviderRouter } from "./router";
import type { CreativeGenerationProvider, ImageGenerationInput } from "./types";

/**
 * Phase 2 — provider foundation.
 *
 * These tests exist to hold the properties that are expensive to get wrong and
 * silent when they are: a credential leaking to the browser, a reference image
 * landing in a field the model ignores, a poll that never stops, a second
 * provider that quietly steals the first one's task ids.
 *
 * Nothing here reaches the network or the database. The client takes an
 * injected transport and the provider takes an injected catalogue, which is why
 * they can be tested at all.
 */

const KEY_VAR = "MUAPI_API_KEY";

function withKey(value: string | undefined) {
  if (value === undefined) delete process.env[KEY_VAR];
  else process.env[KEY_VAR] = value;
}

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[KEY_VAR];
  withKey("test-key-not-a-real-credential");
});

afterEach(() => {
  withKey(savedKey);
  vi.restoreAllMocks();
});

// --- Configuration ------------------------------------------------------------

describe("provider configuration", () => {
  it("reports unconfigured when the key is absent", () => {
    withKey(undefined);
    expect(new MuApiProvider().isConfigured()).toBe(false);
  });

  it("treats a blank key as absent", () => {
    // A blank value is how every deployment starts. Sending it produces a 401
    // that reads like a revoked key rather than an unset one.
    withKey("   ");
    expect(new MuApiProvider().isConfigured()).toBe(false);
  });

  it("names the variable, never the value, so the message is safe to render", () => {
    const provider = new MuApiProvider();
    expect(provider.credentialEnvVar).toBe(KEY_VAR);
    expect(provider.credentialEnvVar).not.toContain("test-key");
  });

  it("refuses to generate when unconfigured", async () => {
    withKey(undefined);
    await expect(new MuApiProvider().generateImage(imageInput())).rejects.toThrow(
      /configuration required/i,
    );
  });

  it("never surfaces the credential in an auth error", async () => {
    const client = new MuApiClient({
      transport: async () => ({ status: 401, body: { message: "bad key test-key-not-a-real" } }),
    });
    await expect(client.result("abc")).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("test-key-not-a-real"),
      }),
    );
  });
});

// --- Capability taxonomy ------------------------------------------------------

describe("capability taxonomy", () => {
  it("maps every capability to an output kind", () => {
    for (const capability of GENERATION_CAPABILITIES) {
      expect(["image", "video", "audio"]).toContain(kindForCapability(capability));
    }
  });

  it("files lip-sync output as video, not as the audio it consumes", () => {
    expect(kindForCapability("lip-sync")).toBe("video");
    expect(requiredInputsFor("lip-sync")).toContain("audio");
  });

  it("gates lip-sync on consent", () => {
    // The brief forbids cloning a likeness or voice without confirmed
    // authorization. If a capability is ever added that animates a person, this
    // assertion is the reminder to classify it.
    expect(requiresConsent("lip-sync")).toBe(true);
    expect(requiresConsent("text-to-image")).toBe(false);
  });

  it("treats an unpriced model as unroutable", () => {
    // An unpriced model cannot be quoted honestly and a credit reservation
    // would have nothing to reserve against.
    expect(isRoutable({ ...model(), estimatedCentsPerUnit: undefined })).toBe(false);
  });

  it("treats a deprecated model as unroutable but still resolvable", () => {
    const retired = { ...model(), deprecatedAt: new Date("2026-01-01") };
    expect(isRoutable(retired)).toBe(false);
    expect(retired.name).toBeTruthy();
  });
});

describe("checkModelFit", () => {
  it("rejects a ratio the model does not produce, and says which it does", () => {
    const fit = checkModelFit(model({ supportedAspectRatios: ["16:9"] }), {
      capability: "text-to-image",
      ratio: "9:16",
    });
    expect(fit.fits).toBe(false);
    if (!fit.fits) expect(fit.reason).toContain("16:9");
  });

  it("treats an empty ratio list as unconstrained rather than as unknown", () => {
    const fit = checkModelFit(model({ supportedAspectRatios: [] }), {
      capability: "text-to-image",
      ratio: "3:2",
    });
    expect(fit.fits).toBe(true);
  });

  it("accepts a shorter duration than the model's minimum, because it rounds up", () => {
    const fit = checkModelFit(
      model({ capabilities: ["text-to-video"], supportedDurations: [5, 10] }),
      { capability: "text-to-video", durationSeconds: 3 },
    );
    expect(fit.fits).toBe(true);
  });

  it("rejects a duration beyond the model's longest clip", () => {
    const fit = checkModelFit(
      model({ capabilities: ["text-to-video"], supportedDurations: [5, 10] }),
      { capability: "text-to-video", durationSeconds: 30 },
    );
    expect(fit.fits).toBe(false);
  });

  it("rejects more reference images than the model accepts", () => {
    const fit = checkModelFit(
      model({ capabilities: ["image-to-image"], maxReferenceImages: 1 }),
      { capability: "image-to-image", referenceImageCount: 3 },
    );
    expect(fit.fits).toBe(false);
    if (!fit.fits) expect(fit.reason).toMatch(/up to 1 reference image/);
  });

  it("rejects any reference image when the model accepts none", () => {
    const fit = checkModelFit(model({ maxReferenceImages: undefined }), {
      capability: "text-to-image",
      referenceImageCount: 1,
    });
    expect(fit.fits).toBe(false);
  });
});

describe("quantiseDuration", () => {
  it("rounds up rather than down", () => {
    // Rounding down silently truncates a shot the storyboard timed, which
    // desynchronises the Remotion composition against its own script.
    expect(quantiseDuration(model({ supportedDurations: [5, 10] }), 6)).toBe(10);
    expect(quantiseDuration(model({ supportedDurations: [5, 10] }), 5)).toBe(5);
  });

  it("clamps to the longest allowed duration", () => {
    expect(quantiseDuration(model({ supportedDurations: [5, 10] }), 25)).toBe(10);
  });

  it("passes a continuous duration through", () => {
    expect(quantiseDuration(model({ supportedDurations: [] }), 7.4)).toBe(7);
  });
});

// --- Catalogue ----------------------------------------------------------------

describe("MuAPI catalogue", () => {
  it("covers every capability", () => {
    const covered = new Set(MUAPI_MODELS.flatMap((each) => each.capabilities));
    for (const capability of GENERATION_CAPABILITIES) {
      expect(covered.has(capability)).toBe(true);
    }
  });

  it("prices every model, because an unpriced one is unroutable", () => {
    for (const each of MUAPI_MODELS) {
      expect(each.estimatedCentsPerUnit).toBeTypeOf("number");
      expect(each.estimatedCentsPerUnit).toBeGreaterThan(0);
    }
  });

  it("gives every model a non-empty external id", () => {
    // MuAPI's endpoint slugs are not derivable from model ids — `flux-dev`
    // posts to `flux-dev-image`. A blank one is a 404 at runtime.
    for (const each of MUAPI_MODELS) {
      expect(each.externalModelId).not.toBe("");
      expect(each.externalModelId).not.toContain("/");
    }
  });

  it("namespaces every id so it cannot collide with another provider's", () => {
    for (const each of MUAPI_MODELS) {
      expect(each.id.startsWith("muapi.")).toBe(true);
      expect(each.providerId).toBe("muapi");
    }
  });

  it("has no duplicate ids", () => {
    const ids = MUAPI_MODELS.map((each) => each.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serves every production mode for every capability it advertises", () => {
    for (const capability of GENERATION_CAPABILITIES) {
      for (const mode of ["fast", "hybrid", "cinematic"] as const) {
        const picked = selectMuApiModel(capability, mode, "standard");
        expect(picked, `${capability} in ${mode}`).not.toBeNull();
      }
    }
  });

  it("selects cheapest for draft and dearest for high", () => {
    const draft = selectMuApiModel("text-to-image", "hybrid", "draft");
    const high = selectMuApiModel("text-to-image", "hybrid", "high");
    expect(draft?.estimatedCentsPerUnit).toBeLessThanOrEqual(high?.estimatedCentsPerUnit ?? 0);
  });

  it("never substitutes a near-neighbour aspect ratio", () => {
    // Silently generating 16:9 for a 4:3 request produces a file that passes
    // every technical check and is wrong in a way nobody notices until publish.
    expect(toMuApiAspectRatio("custom")).toBeNull();
  });

  it("resolves a model by id and reports null for an unknown one", () => {
    const first = MUAPI_MODELS[0];
    expect(first).toBeDefined();
    if (first) expect(findMuApiModel(first.id)?.id).toBe(first.id);
    expect(findMuApiModel("muapi.does-not-exist")).toBeNull();
  });

  it("declares a payload field for every model that accepts references", () => {
    for (const each of MUAPI_MODELS) {
      if ((each.maxReferenceImages ?? 0) > 0) {
        expect(muApiMetadata(each).imageField, each.id).toBeTruthy();
      }
    }
  });
});

// --- Client -------------------------------------------------------------------

describe("MuApiClient", () => {
  it("normalises request_id and id alike", () => {
    expect(parseSubmit({ request_id: "a" })).toEqual({ kind: "accepted", requestId: "a" });
    expect(parseSubmit({ id: "b" })).toEqual({ kind: "accepted", requestId: "b" });
  });

  it("recognises an endpoint that answered inline", () => {
    expect(parseSubmit({ outputs: ["https://cdn/x.png"] })).toEqual({
      kind: "inline",
      outputs: ["https://cdn/x.png"],
    });
  });

  it("fails loudly on a response with neither an id nor a result", () => {
    // Better here than as a NOT NULL violation three layers away.
    expect(() => parseSubmit({ ok: true })).toThrow(/neither a task id nor a result/);
  });

  it("reads outputs from all three shapes MuAPI uses", () => {
    expect(parseResult("r", { status: "completed", outputs: ["u1"] }).outputs).toEqual(["u1"]);
    expect(parseResult("r", { status: "success", url: "u2" }).outputs).toEqual(["u2"]);
    expect(parseResult("r", { status: "succeeded", output: { url: "u3" } }).outputs).toEqual(["u3"]);
  });

  it("treats an unrecognised status as still running, not as failure", () => {
    // Guessing failure would abandon and refund a generation that was about to
    // succeed and had already been billed for.
    expect(parseResult("r", { status: "hydrating" }).state).toBe("running");
    expect(parseResult("r", {}).state).toBe("running");
  });

  it("distinguishes queued from running so the poller can back off differently", () => {
    expect(parseResult("r", { status: "queued" }).state).toBe("queued");
    expect(parseResult("r", { status: "processing" }).state).toBe("running");
  });

  it("treats success with no output as failure", () => {
    // Otherwise the run sits in `downloading` forever waiting for bytes that
    // will never arrive.
    const result = parseResult("r", { status: "completed", outputs: [] });
    expect(result.state).toBe("failed");
  });

  it("aborts a request that exceeds its budget rather than hanging", async () => {
    const client = new MuApiClient({
      pollTimeoutMs: 10,
      transport: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    await expect(client.result("abc")).rejects.toThrow(/did not respond in time/);
  });

  it("sends the key as a header and never in the URL or body", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = new MuApiClient({
      transport: async (url, init) => {
        seen.push({ url, init });
        return { status: 200, body: { request_id: "x" } };
      },
    });
    await client.submit("flux-dev-image", { prompt: "hello" });

    const call = seen[0];
    expect(call).toBeDefined();
    expect(call?.url).not.toContain("test-key");
    expect(String(call?.init.body)).not.toContain("test-key");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key-not-a-real-credential");
  });
});

describe("mapFailure", () => {
  it("marks a rate limit retryable and uncharged", () => {
    const failure = mapFailure(429, {});
    expect(failure.retryable).toBe(true);
    expect(failure.costIncurred).toBe(false);
  });

  it("marks a 400 non-retryable and surfaces which field was wrong", () => {
    const failure = mapFailure(400, { message: "aspect_ratio is invalid" });
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("aspect_ratio");
  });

  it("assumes a 5xx was billed, so a real cost is not silently absorbed", () => {
    expect(mapFailure(500, {}).costIncurred).toBe(true);
  });

  it("does not leak Virally's vendor balance to the end user on a 402", () => {
    const failure = mapFailure(402, { message: "insufficient credits: 3 remaining" });
    expect(failure.message).not.toContain("3 remaining");
    expect(failure.message).toMatch(/has not been charged/);
  });
});

// --- Status mapping -----------------------------------------------------------

describe("status mapping", () => {
  it("maps provider success to downloading, never to completed", () => {
    // Nothing is complete until the bytes are in Virally storage. `applyStatus`
    // also refuses to write `completed`, so this is belt and braces on purpose.
    expect(toState("succeeded")).toBe("downloading");
  });

  it("never synthesises a progress percentage", () => {
    // MuAPI publishes no progress field. A bar interpolated against elapsed
    // time is a lie about how much work is left.
    const status = toStatus({
      requestId: "r",
      state: "running",
      outputs: [],
      errorMessage: null,
    });
    expect(status.progress).toBeNull();
  });

  it("never claims a provider credit figure MuAPI did not give", () => {
    const status = toStatus({
      requestId: "r",
      state: "succeeded",
      outputs: ["u"],
      errorMessage: null,
    });
    expect(status.providerCredits).toBeNull();
  });

  it("leaves media metadata null until the bytes are probed", () => {
    // Guessing a MIME type from a URL extension is how a .mp4 served as
    // octet-stream ends up filed as an image.
    const status = toStatus({
      requestId: "r",
      state: "succeeded",
      outputs: ["https://cdn/x"],
      errorMessage: null,
    });
    expect(status.media[0]?.mimeType).toBeNull();
    expect(status.media[0]?.durationMs).toBeNull();
  });
});

// --- Payload shaping ----------------------------------------------------------

describe("payload shaping", () => {
  async function capturePayload(
    provider: MuApiProvider,
    run: (p: MuApiProvider) => Promise<unknown>,
    seen: Record<string, unknown>[],
  ) {
    await run(provider);
    return seen[0];
  }

  function recordingProvider(catalog: readonly GenerationModel[]) {
    const seen: Record<string, unknown>[] = [];
    const client = new MuApiClient({
      transport: async (_url, init) => {
        seen.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return { status: 200, body: { request_id: "task-1" } };
      },
    });
    return { provider: new MuApiProvider({ client, catalog }), seen };
  }

  it("places a reference image in the field the model declares", async () => {
    // The failure this prevents is invisible: sending the wrong key is not an
    // error, it is a successful generation that ignored the reference and
    // billed for it.
    const target = model({
      capabilities: ["image-to-image"],
      maxReferenceImages: 1,
      metadata: { imageField: "start_image", hasPrompt: true },
    });
    const { provider, seen } = recordingProvider([target]);
    const payload = await capturePayload(
      provider,
      (p) => p.generateImage(imageInput({ styleReferenceUrl: "https://cdn/ref.png" })),
      seen,
    );
    expect(payload?.start_image).toBe("https://cdn/ref.png");
    expect(payload?.image_url).toBeUndefined();
  });

  it("sends an array when the model's field is a list", async () => {
    const target = model({
      capabilities: ["image-to-image"],
      maxReferenceImages: 2,
      metadata: { imageField: "images_list", imageFieldIsList: true },
    });
    const { provider, seen } = recordingProvider([target]);
    const payload = await capturePayload(
      provider,
      (p) =>
        p.generateImage(
          imageInput({
            styleReferenceUrl: "https://cdn/a.png",
            structureReferenceUrl: "https://cdn/b.png",
          }),
        ),
      seen,
    );
    expect(payload?.images_list).toEqual(["https://cdn/b.png", "https://cdn/a.png"]);
  });

  it("refuses a reference image the model cannot accept", async () => {
    const target = model({ capabilities: ["image-to-image"], maxReferenceImages: undefined });
    const { provider } = recordingProvider([target]);
    await expect(
      provider.generateImage(imageInput({ styleReferenceUrl: "https://cdn/a.png" })),
    ).rejects.toThrow(/does not accept reference images/);
  });

  it("omits a prompt from an endpoint that rejects one", async () => {
    const target = model({
      capabilities: ["text-to-video"],
      supportedDurations: [5],
      metadata: { hasPrompt: false },
    });
    const { provider, seen } = recordingProvider([target]);
    const payload = await capturePayload(
      provider,
      (p) =>
        p.generateVideo({
          idempotencyKey: "k",
          prompt: "ignored",
          mode: "hybrid",
          quality: "standard",
          ratio: "9:16",
          durationSeconds: 5,
        }),
      seen,
    );
    expect(payload?.prompt).toBeUndefined();
  });

  it("omits a negative prompt the model does not support", async () => {
    const target = model({ supportsNegativePrompt: false });
    const { provider, seen } = recordingProvider([target]);
    const payload = await capturePayload(
      provider,
      (p) => p.generateImage(imageInput({ negativePrompt: "blurry" })),
      seen,
    );
    expect(payload?.negative_prompt).toBeUndefined();
  });

  it("forwards a webhook URL as an untrusted hint", async () => {
    const { provider, seen } = recordingProvider([model()]);
    const payload = await capturePayload(
      provider,
      (p) => p.generateImage(imageInput({ webhookUrl: "https://app/api/x?t=secret" })),
      seen,
    );
    expect(payload?.webhook).toBe("https://app/api/x?t=secret");
  });
});

// --- Idempotency and cost -----------------------------------------------------

describe("estimation", () => {
  it("quotes as a configured table, never as a provider quote", async () => {
    // MuAPI publishes no prices at all. Labelling an estimate as a vendor quote
    // would misrepresent where the number came from.
    const provider = new MuApiProvider({ catalog: [model({ estimatedCentsPerUnit: 8 })] });
    const estimate = await provider.estimateImage(imageInput());
    expect(estimate.basis).toBe("configured_table");
    expect(estimate.providerCredits).toBeNull();
    expect(estimate.internalCents).toBe(8);
  });

  it("prices a long shot as several clips, not one", async () => {
    // Quoting one clip's price for a 30s shot under-quotes by a factor of three,
    // and the reservation made against it is short by the same factor.
    const provider = new MuApiProvider({
      catalog: [
        model({
          capabilities: ["text-to-video"],
          supportedDurations: [10],
          estimatedCentsPerUnit: 100,
        }),
      ],
    });
    const estimate = await provider.estimateVideo({
      idempotencyKey: "k",
      prompt: "p",
      mode: "hybrid",
      quality: "standard",
      ratio: "9:16",
      durationSeconds: 30,
    });
    expect(estimate.internalCents).toBe(300);
  });
});

// --- Router -------------------------------------------------------------------

describe("ProviderRouter", () => {
  function stub(
    id: string,
    options: { configured?: boolean; supported?: boolean } = {},
  ): CreativeGenerationProvider {
    const provider = new MuApiProvider();
    return {
      ...provider,
      id,
      label: id,
      credentialEnvVar: `${id.toUpperCase()}_API_KEY`,
      isConfigured: () => options.configured ?? true,
      supports: () =>
        options.supported === false
          ? { supported: false, reason: `${id} cannot serve this.` }
          : { supported: true },
      listModels: async () => [],
      estimateImage: provider.estimateImage.bind(provider),
      estimateVideo: provider.estimateVideo.bind(provider),
      estimateAudio: provider.estimateAudio.bind(provider),
      generateImage: provider.generateImage.bind(provider),
      generateVideo: provider.generateVideo.bind(provider),
      generateAudio: provider.generateAudio.bind(provider),
      getTaskStatus: provider.getTaskStatus.bind(provider),
    } as CreativeGenerationProvider;
  }

  it("resolves a provider by id rather than by re-routing", () => {
    // The bug this pins: re-routing to find a run's provider worked while there
    // was one candidate and silently broke with two — a MuAPI run would resolve
    // to Magnific, fail the id check, and hang in `submitted` with no error.
    const router = new ProviderRouter({ candidates: [stub("magnific"), stub("muapi")] });
    expect(router.providerById("muapi")?.id).toBe("muapi");
    expect(router.providerById("magnific")?.id).toBe("magnific");
    expect(router.providerById("mock")?.id).toBe("mock");
    expect(router.providerById("nope")).toBeNull();
  });

  it("skips an unconfigured provider and names the variable to set", () => {
    const router = new ProviderRouter({
      candidates: [stub("magnific", { configured: false }), stub("muapi")],
    });
    const decision = router.route({ kind: "image", mode: "fast", allowMockFallback: false });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.provider.id).toBe("muapi");
      expect(decision.rejected[0]?.reason).toContain("MAGNIFIC_API_KEY");
    }
  });

  it("falls back to the second provider when the first cannot serve", () => {
    const router = new ProviderRouter({
      candidates: [stub("magnific", { supported: false }), stub("muapi")],
    });
    const decision = router.route({ kind: "video", mode: "hybrid", allowMockFallback: false });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.provider.id).toBe("muapi");
  });

  it("honours a workspace preference over declaration order", () => {
    const router = new ProviderRouter({ candidates: [stub("magnific"), stub("muapi")] });
    const decision = router.route({
      kind: "image",
      mode: "fast",
      preferredProviderId: "muapi",
      allowMockFallback: false,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.provider.id).toBe("muapi");
      expect(decision.reason).toContain("preferred");
    }
  });

  it("refuses rather than silently producing a demo asset when mock is disallowed", () => {
    // Handing a demo file to someone who paid credits is worse than failing.
    const router = new ProviderRouter({
      candidates: [stub("magnific", { configured: false })],
    });
    const decision = router.route({ kind: "image", mode: "fast", allowMockFallback: false });
    expect(decision.ok).toBe(false);
  });

  it("labels the mock decision so the demo badge can explain itself", () => {
    const router = new ProviderRouter({
      candidates: [stub("magnific", { configured: false })],
    });
    const decision = router.route({ kind: "image", mode: "fast", allowMockFallback: true });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.isMock).toBe(true);
      expect(decision.reason).toMatch(/demo only/i);
    }
  });

  it("never selects the mock by ordinary preference", () => {
    const router = new ProviderRouter({ candidates: [stub("magnific"), stub("muapi")] });
    const decision = router.route({
      kind: "image",
      mode: "fast",
      preferredProviderId: "mock",
      allowMockFallback: true,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.isMock).toBe(false);
  });
});

// --- Mock ---------------------------------------------------------------------

describe("MockCreativeProvider", () => {
  it("offers a model for every capability, so a new one is covered automatically", async () => {
    const mock = new MockCreativeProvider();
    for (const capability of GENERATION_CAPABILITIES) {
      const models = await mock.listModels(capability);
      expect(models.length, capability).toBeGreaterThan(0);
    }
  });

  it("prices everything at zero and stays routable", async () => {
    const models = await new MockCreativeProvider().listModels();
    for (const each of models) {
      expect(each.estimatedCentsPerUnit).toBe(0);
      // Zero, not undefined — undefined would make the fallback unroutable and
      // leave the mock path with nothing to fall back to.
      expect(isRoutable(each)).toBe(true);
    }
  });

  it("works with no credentials at all", async () => {
    withKey(undefined);
    const mock = new MockCreativeProvider();
    expect(mock.isConfigured()).toBe(true);
    const task = await mock.generateImage(imageInput());
    expect(task.externalTaskId).toBeTruthy();
  });

  it("is deterministic, so regenerating one shot is testable", async () => {
    const mock = new MockCreativeProvider();
    const a = await mock.generateImage(imageInput({ idempotencyKey: "same" }));
    const b = await mock.generateImage(imageInput({ idempotencyKey: "same" }));
    expect(a.externalTaskId).toBe(b.externalTaskId);
  });

  it("reaches downloading rather than jumping to completed", async () => {
    const mock = new MockCreativeProvider();
    const task = await mock.generateImage(imageInput());
    let status = await mock.getTaskStatus(task.externalTaskId, "image");
    while (status.state !== "downloading") {
      status = await mock.getTaskStatus(task.externalTaskId, "image");
    }
    expect(status.state).toBe("downloading");
    expect(status.media.length).toBeGreaterThan(0);
  });
});

// --- Helpers ------------------------------------------------------------------

function model(overrides: Partial<GenerationModel> = {}): GenerationModel {
  return {
    id: "muapi.test",
    providerId: "muapi",
    externalModelId: "test-endpoint",
    name: "Test model",
    capabilities: ["text-to-image"],
    inputTypes: ["text"],
    supportedAspectRatios: [],
    supportedDurations: [],
    supportedResolutions: [],
    supportsNegativePrompt: true,
    supportsSeed: false,
    supportsAudio: false,
    modes: ["fast", "hybrid", "cinematic"],
    estimatedCentsPerUnit: 5,
    enabled: true,
    metadata: { imageField: "image_url", hasPrompt: true },
    ...overrides,
  };
}

function imageInput(overrides: Partial<ImageGenerationInput> = {}): ImageGenerationInput {
  return {
    idempotencyKey: "test-key",
    prompt: "a test prompt",
    mode: "hybrid",
    quality: "standard",
    ratio: "9:16",
    ...overrides,
  };
}
