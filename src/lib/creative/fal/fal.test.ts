/**
 * @vitest-environment node
 *
 * Node for the same reason the rest of src/lib/creative's tests are: this file
 * reaches the credential guard in env.ts, which throws when `window` exists.
 *
 * No network and no database. Every provider call goes through an injected
 * transport, so these assert the adapter's request-building and
 * response-mapping against fal's PUBLISHED queue-API contract — they do not
 * and cannot prove the live API behaves as documented. That requires a real
 * key, which this repository does not have.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImageGenerationInput, VideoGenerationInput } from "../types";
import { ProviderNotConfiguredError, ProviderUnsupportedError } from "../types";
import { falImageSize, toFalAspectRatio } from "./catalog";
import { FalAuthError, FalClient, parseStatus, parseSubmit, type FalTransport } from "./client";
import { FalProvider } from "./provider";

const KEY_VAR = "FAL_API_KEY";

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[KEY_VAR];
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY_VAR];
  else process.env[KEY_VAR] = savedKey;
});

function imageInput(overrides: Partial<ImageGenerationInput> = {}): ImageGenerationInput {
  return {
    idempotencyKey: "key-1",
    prompt: "a cat",
    mode: "fast",
    quality: "standard",
    ratio: "9:16",
    ...overrides,
  };
}

function videoInput(overrides: Partial<VideoGenerationInput> = {}): VideoGenerationInput {
  return {
    idempotencyKey: "key-1",
    prompt: "a cat walking",
    mode: "hybrid",
    quality: "standard",
    ratio: "9:16",
    durationSeconds: 5,
    ...overrides,
  };
}

/** Transport that records what it was asked and replies with a fixed body. */
function stubTransport(
  reply: { status: number; body: unknown },
  sink: { url?: string; init?: RequestInit } = {},
): FalTransport {
  return async (url, init) => {
    sink.url = url;
    sink.init = init;
    return reply;
  };
}

const IN_QUEUE = { status: 200, body: { request_id: "req-1", status: "IN_QUEUE", queue_position: 0 } };

// =============================================================================
// Configuration
// =============================================================================

describe("provider configuration", () => {
  it("reports unconfigured when the key is absent, without throwing", () => {
    delete process.env[KEY_VAR];
    expect(new FalProvider().isConfigured()).toBe(false);
  });

  it("treats a blank key as absent, so `FAL_API_KEY=` does not 401", () => {
    process.env[KEY_VAR] = "   ";
    expect(new FalProvider().isConfigured()).toBe(false);
  });

  it("refuses to generate without a key, and names the variable", async () => {
    delete process.env[KEY_VAR];
    await expect(new FalProvider().generateImage(imageInput())).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
  });

  it("never puts the key value in an auth error message", async () => {
    process.env[KEY_VAR] = "fal-super-secret-value";
    const client = new FalClient({ transport: stubTransport({ status: 401, body: {} }) });
    const error = await new FalProvider({ client }).generateImage(imageInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FalAuthError);
    expect((error as Error).message).not.toContain("fal-super-secret-value");
  });
});

// =============================================================================
// Request building — against fal's published queue-API contract
// =============================================================================

describe("fal request building", () => {
  beforeEach(() => {
    process.env[KEY_VAR] = "test-key";
  });

  it("authenticates with `Authorization: Key <token>`", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).generateImage(imageInput());

    const headers = sink.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key test-key");
  });

  it("posts to the model's queue endpoint under the fal base URL", async () => {
    const sink: { url?: string } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).generateImage(imageInput());

    expect(sink.url).toBe("https://queue.fal.run/fal-ai/flux/dev");
  });

  it("sizes flux-dev by an exact {width, height}, not a ratio enum", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).generateImage(imageInput({ ratio: "9:16" }));

    const body = JSON.parse(String(sink.init?.body));
    expect(body.image_size).toEqual(falImageSize("9:16"));
    expect(body.aspect_ratio).toBeUndefined();
  });

  it("sends Flux Kontext's aspect_ratio enum for image-to-image", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).generateImage(
      imageInput({
        mode: "hybrid",
        ratio: "4:3",
        structureReferenceUrl: "https://example.test/ref.png",
      }),
    );

    const body = JSON.parse(String(sink.init?.body));
    expect(body.aspect_ratio).toBe("4:3");
    expect(body.image_url).toBe("https://example.test/ref.png");
  });

  it("sends Kling's duration as a STRING — a number is a 400 on the underlying model", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client, modelId: "fal.kling-v1.6-text-to-video" }).generateVideo(
      videoInput({ durationSeconds: 5 }),
    );

    const body = JSON.parse(String(sink.init?.body));
    expect(body.duration).toBe("5");
    expect(typeof body.duration).toBe("string");
  });

  it("selects image-to-video only when a reference frame was supplied", async () => {
    const sink: { url?: string; init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    const provider = new FalProvider({ client });

    await provider.generateVideo(videoInput());
    expect(sink.url).toBe("https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video");

    await provider.generateVideo(videoInput({ referenceImageUrl: "https://example.test/a.png" }));
    expect(sink.url).toBe("https://queue.fal.run/fal-ai/kling-video/v1.6/standard/image-to-video");
    expect(JSON.parse(String(sink.init?.body)).image_url).toBe("https://example.test/a.png");
  });

  it("encodes the endpoint id into the returned task id", async () => {
    const client = new FalClient({ transport: stubTransport(IN_QUEUE) });
    const task = await new FalProvider({ client }).generateImage(imageInput());
    expect(task.externalTaskId).toBe("fal-ai/flux/dev::req-1");
  });

  it("derives a stable seed from the idempotency key when fixedGeneration is requested", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).generateImage(
      imageInput({ idempotencyKey: "same-key", fixedGeneration: true }),
    );
    const firstSeed = JSON.parse(String(sink.init?.body)).seed;

    await new FalProvider({ client }).generateImage(
      imageInput({ idempotencyKey: "same-key", fixedGeneration: true }),
    );
    const secondSeed = JSON.parse(String(sink.init?.body)).seed;

    expect(typeof firstSeed).toBe("number");
    expect(firstSeed).toBe(secondSeed);
  });

  it("routes a voiceover request to Kokoro, not the sound-effects gap", async () => {
    const sink: { url?: string; init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).generateAudio({
      idempotencyKey: "key-1",
      prompt: "Hidden beaches nobody talks about.",
      mode: "fast",
      quality: "standard",
      kind: "voiceover",
      durationSeconds: 20,
    });

    expect(sink.url).toBe("https://queue.fal.run/fal-ai/kokoro/american-english");
    const body = JSON.parse(String(sink.init?.body));
    expect(body.prompt).toBe("Hidden beaches nobody talks about.");
    // Kokoro has no duration input — driven by the text, not a clip length.
    expect(body.seconds_total).toBeUndefined();
  });

  it("sends Stable Audio's seconds_total for a music request", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).generateAudio({
      idempotencyKey: "key-1",
      prompt: "Upbeat instrumental background music.",
      mode: "fast",
      quality: "standard",
      kind: "music",
      durationSeconds: 24.4,
    });

    const body = JSON.parse(String(sink.init?.body));
    expect(body.seconds_total).toBe(24);
  });
});

// =============================================================================
// Catalogue mapping
// =============================================================================

describe("catalogue mapping", () => {
  it("returns null for a ratio fal cannot do, rather than a nearest match", () => {
    // Silently substituting 4:3 for a 4:5 request produces a file that passes
    // every technical check and is cropped wrong wherever it is published.
    expect(toFalAspectRatio("4:5")).toBeNull();
    expect(toFalAspectRatio("custom")).toBeNull();
    expect(toFalAspectRatio("16:9")).toBe("16:9");
  });
});

// =============================================================================
// supports()
// =============================================================================

describe("supports()", () => {
  beforeEach(() => {
    process.env[KEY_VAR] = "test-key";
  });

  it("refuses a 4:5 image-to-image request on Kontext", () => {
    const decision = new FalProvider().supports({
      kind: "image",
      capability: "image-to-image",
      ratio: "4:5",
      mode: "hybrid",
    });
    expect(decision.supported).toBe(false);
  });

  it("throws ProviderUnsupportedError if generate is called anyway", async () => {
    const client = new FalClient({ transport: stubTransport(IN_QUEUE) });
    await expect(
      new FalProvider({ client }).generateImage(
        imageInput({
          mode: "hybrid",
          ratio: "4:5",
          structureReferenceUrl: "https://example.test/ref.png",
        }),
      ),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });

  it("has no sound-effect model, so that request is refused rather than silently mismatched", async () => {
    await expect(
      new FalProvider().generateAudio({
        idempotencyKey: "key-1",
        prompt: "a door slam",
        mode: "fast",
        quality: "standard",
        kind: "sound_effect",
        durationSeconds: 3,
      }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
});

// =============================================================================
// Response mapping
// =============================================================================

describe("response mapping", () => {
  beforeEach(() => {
    process.env[KEY_VAR] = "test-key";
  });

  it("polls the queue base (owner/app), not the full submit endpoint — fal drops everything after", async () => {
    // Regression test: a real submit to fal-ai/flux/dev returns a status_url
    // under fal-ai/flux (no /dev), and the client silently 405ed against the
    // full endpoint id here until this was caught — undetected because
    // submission (a different URL, correctly the full id) always succeeded.
    const sink: { url?: string } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).getTaskStatus("fal-ai/flux/dev::req-1", "image");
    expect(sink.url).toBe("https://queue.fal.run/fal-ai/flux/requests/req-1/status");
  });

  it("leaves a two-segment endpoint's queue base unchanged — nothing to drop", async () => {
    const sink: { url?: string } = {};
    const client = new FalClient({ transport: stubTransport(IN_QUEUE, sink) });
    await new FalProvider({ client }).getTaskStatus("fal-ai/stable-audio::req-1", "audio");
    expect(sink.url).toBe("https://queue.fal.run/fal-ai/stable-audio/requests/req-1/status");
  });

  it("fetches the result from the same truncated queue base once completed", async () => {
    let call = 0;
    const sink: { url?: string } = {};
    const client = new FalClient({
      transport: async (url) => {
        call += 1;
        sink.url = url;
        if (call === 1) return { status: 200, body: { status: "COMPLETED" } };
        return { status: 200, body: { images: [{ url: "https://cdn.fal.ai/out.png" }] } };
      },
    });
    await new FalProvider({ client }).getTaskStatus(
      "fal-ai/kling-video/v1.6/standard/text-to-video::req-1",
      "video",
    );
    expect(sink.url).toBe("https://queue.fal.run/fal-ai/kling-video/requests/req-1");
  });

  it("maps IN_QUEUE and IN_PROGRESS, never faking a percentage", async () => {
    const queued = new FalClient({
      transport: stubTransport({ status: 200, body: { status: "IN_QUEUE", queue_position: 3 } }),
    });
    const queuedStatus = await new FalProvider({ client: queued }).getTaskStatus(
      "fal-ai/flux/dev::req-1",
      "image",
    );
    expect(queuedStatus.state).toBe("submitted");
    expect(queuedStatus.progress).toBeNull();

    const running = new FalClient({
      transport: stubTransport({ status: 200, body: { status: "IN_PROGRESS" } }),
    });
    const runningStatus = await new FalProvider({ client: running }).getTaskStatus(
      "fal-ai/flux/dev::req-1",
      "image",
    );
    expect(runningStatus.state).toBe("generating");
    expect(runningStatus.progress).toBeNull();
  });

  it("maps COMPLETED to `downloading`, never to `completed`, and extracts image URLs", async () => {
    let call = 0;
    const client = new FalClient({
      transport: async () => {
        call += 1;
        if (call === 1) return { status: 200, body: { status: "COMPLETED" } };
        return {
          status: 200,
          body: { images: [{ url: "https://cdn.fal.ai/out.png", width: 1024, height: 1820 }] },
        };
      },
    });
    const status = await new FalProvider({ client }).getTaskStatus("fal-ai/flux/dev::req-1", "image");

    // Only ingestion may write `completed` — the bytes are still on fal's CDN.
    expect(status.state).toBe("downloading");
    expect(status.media).toEqual([
      { url: "https://cdn.fal.ai/out.png", mimeType: null, widthPx: 1024, heightPx: 1820, durationMs: null },
    ]);
  });

  it("extracts a single video URL for a video model's completed result", async () => {
    let call = 0;
    const client = new FalClient({
      transport: async () => {
        call += 1;
        if (call === 1) return { status: 200, body: { status: "COMPLETED" } };
        return { status: 200, body: { video: { url: "https://cdn.fal.ai/out.mp4" } } };
      },
    });
    const status = await new FalProvider({ client }).getTaskStatus(
      "fal-ai/kling-video/v1.6/standard/text-to-video::req-1",
      "video",
    );
    expect(status.media).toEqual([
      { url: "https://cdn.fal.ai/out.mp4", mimeType: null, widthPx: null, heightPx: null, durationMs: null },
    ]);
  });

  it("extracts a voiceover URL from Kokoro's `audio` field", async () => {
    let call = 0;
    const client = new FalClient({
      transport: async () => {
        call += 1;
        if (call === 1) return { status: 200, body: { status: "COMPLETED" } };
        return { status: 200, body: { audio: { url: "https://cdn.fal.ai/voice.wav" } } };
      },
    });
    const status = await new FalProvider({ client }).getTaskStatus(
      "fal-ai/kokoro/american-english::req-1",
      "audio",
    );
    expect(status.media).toEqual([
      { url: "https://cdn.fal.ai/voice.wav", mimeType: null, widthPx: null, heightPx: null, durationMs: null },
    ]);
  });

  it("extracts a music URL from Stable Audio's `audio_file` field, a different key than Kokoro's", async () => {
    let call = 0;
    const client = new FalClient({
      transport: async () => {
        call += 1;
        if (call === 1) return { status: 200, body: { status: "COMPLETED" } };
        return { status: 200, body: { audio_file: { url: "https://cdn.fal.ai/music.wav" } } };
      },
    });
    const status = await new FalProvider({ client }).getTaskStatus("fal-ai/stable-audio::req-1", "audio");
    expect(status.media).toEqual([
      { url: "https://cdn.fal.ai/music.wav", mimeType: null, widthPx: null, heightPx: null, durationMs: null },
    ]);
  });

  it("fails a completed task that returned no output, rather than hanging in downloading", async () => {
    let call = 0;
    const client = new FalClient({
      transport: async () => {
        call += 1;
        if (call === 1) return { status: 200, body: { status: "COMPLETED" } };
        return { status: 200, body: { images: [] } };
      },
    });
    const status = await new FalProvider({ client }).getTaskStatus("fal-ai/flux/dev::req-1", "image");
    expect(status.state).toBe("failed");
    expect(status.failure?.costIncurred).toBe(true);
  });

  it("fails immediately when the status payload itself carries an error", async () => {
    const client = new FalClient({
      transport: stubTransport({
        status: 200,
        body: { status: "IN_QUEUE", error: "NSFW content detected" },
      }),
    });
    const status = await new FalProvider({ client }).getTaskStatus("fal-ai/flux/dev::req-1", "image");
    expect(status.state).toBe("failed");
    expect(status.failure?.message).toContain("NSFW content detected");
  });

  it("rejects a task id this adapter never issued", async () => {
    const client = new FalClient({ transport: stubTransport(IN_QUEUE) });
    await expect(
      new FalProvider({ client }).getTaskStatus("not-a-composite-id", "image"),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
});

// =============================================================================
// Client-level parsing
// =============================================================================

describe("parseSubmit / parseStatus", () => {
  it("requires a request_id on submit", () => {
    expect(() => parseSubmit({})).toThrow();
    expect(parseSubmit({ request_id: "r-1" })).toEqual({ requestId: "r-1" });
  });

  it("treats an unrecognised status string as IN_PROGRESS rather than as a failure", () => {
    // Guessing "failed" would abandon and refund a generation that was about
    // to succeed and had already been billed for.
    expect(parseStatus({ status: "SOMETHING_NEW" }).state).toBe("IN_PROGRESS");
  });
});
