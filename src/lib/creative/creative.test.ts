/**
 * @vitest-environment node
 *
 * Required, not incidental. The project's default vitest environment is jsdom,
 * which defines `window` — and src/lib/creative/env.ts deliberately THROWS when
 * a credential is read with `window` present, because that is the signature of a
 * client component importing a server module. Running these under jsdom makes
 * every configuration test fail with that guard, which is the guard working.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAGNIFIC_AUTH_HEADER,
  findModel,
  quantiseDuration,
  selectModel,
  toMagnificImageRatio,
  toMagnificVideoRatio,
} from "./magnific/catalog";
import { MagnificAuthError, MagnificClient, MagnificRequestError, mapFailure, parseEnvelope } from "./magnific/client";
import type { MagnificTransport } from "./magnific/client";
import { MagnificProvider, toState } from "./magnific/provider";
import { signWebhook, verifyMagnificWebhook } from "./magnific/webhook";
import { MockCreativeProvider } from "./mock";
import { CENTS_PER_PRODUCTION_CREDIT, centsToCredits, productionModeDefault } from "./modes";
import { ProviderRouter } from "./router";
import { assertScope, tenantScope } from "./scope";
import { ProviderNotConfiguredError, ProviderUnsupportedError, isTerminalState } from "./types";
import type { ImageGenerationInput, VideoGenerationInput } from "./types";

/**
 * Phase 1 tests.
 *
 * No network and no database. Every provider call goes through an injected
 * transport, so these assert the adapter's request-building and response-mapping
 * against Magnific's PUBLISHED contract — they do not and cannot prove the live
 * API behaves as documented. That requires a real key, which this repository
 * does not have.
 */

const KEY_VAR = "MAGNIFIC_API_KEY";
const SECRET_VAR = "MAGNIFIC_WEBHOOK_SECRET";

let savedKey: string | undefined;
let savedSecret: string | undefined;

beforeEach(() => {
  savedKey = process.env[KEY_VAR];
  savedSecret = process.env[SECRET_VAR];
});

afterEach(() => {
  restore(KEY_VAR, savedKey);
  restore(SECRET_VAR, savedSecret);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

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

/** Transport that records what it was asked and replies with a fixed envelope. */
function stubTransport(
  reply: { status: number; body: unknown },
  sink: { url?: string; init?: RequestInit } = {},
): MagnificTransport {
  return async (url, init) => {
    sink.url = url;
    sink.init = init;
    return reply;
  };
}

const CREATED = { status: 200, body: { data: { task_id: "t-1", status: "CREATED", generated: [] } } };

// =============================================================================
// Configuration
// =============================================================================

describe("provider configuration", () => {
  it("reports unconfigured when the key is absent, without throwing", () => {
    delete process.env[KEY_VAR];
    expect(new MagnificProvider().isConfigured()).toBe(false);
  });

  it("treats a blank key as absent, so `MAGNIFIC_API_KEY=` does not 401", () => {
    process.env[KEY_VAR] = "   ";
    expect(new MagnificProvider().isConfigured()).toBe(false);
  });

  it("refuses to generate without a key, and names the variable", async () => {
    delete process.env[KEY_VAR];
    await expect(new MagnificProvider().generateImage(imageInput())).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
  });

  it("never puts the key value in an auth error message", async () => {
    process.env[KEY_VAR] = "sk-super-secret-value";
    const client = new MagnificClient({ transport: stubTransport({ status: 401, body: {} }) });
    const provider = new MagnificProvider({ client });

    const error = await provider.generateImage(imageInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MagnificAuthError);
    expect((error as Error).message).not.toContain("sk-super-secret-value");
  });
});

// =============================================================================
// Request building — against the published Magnific contract
// =============================================================================

describe("Magnific request building", () => {
  beforeEach(() => {
    process.env[KEY_VAR] = "test-key";
  });

  it("authenticates with x-magnific-api-key, not Authorization", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new MagnificClient({ transport: stubTransport(CREATED, sink) });
    await new MagnificProvider({ client }).generateImage(imageInput());

    const headers = sink.init?.headers as Record<string, string>;
    expect(headers[MAGNIFIC_AUTH_HEADER]).toBe("test-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends Magnific's named aspect ratio, not the numeric one", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new MagnificClient({ transport: stubTransport(CREATED, sink) });
    await new MagnificProvider({ client }).generateImage(imageInput({ ratio: "4:5" }));

    const body = JSON.parse(String(sink.init?.body));
    expect(body.aspect_ratio).toBe("social_post_4_5");
  });

  it("sends Kling's duration as a STRING enum — a number is a 400", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new MagnificClient({ transport: stubTransport(CREATED, sink) });
    await new MagnificProvider({ client, modelId: "magnific.kling-v2-6-pro" }).generateVideo(
      videoInput({ durationSeconds: 5 }),
    );

    const body = JSON.parse(String(sink.init?.body));
    expect(body.duration).toBe("5");
    expect(typeof body.duration).toBe("string");
  });

  it("never disables the NSFW filter", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new MagnificClient({ transport: stubTransport(CREATED, sink) });
    await new MagnificProvider({ client }).generateImage(imageInput());

    expect(JSON.parse(String(sink.init?.body)).filter_nsfw).toBe(true);
  });

  it("includes an image only when a reference frame was supplied (selects i2v)", async () => {
    const sink: { init?: RequestInit } = {};
    const client = new MagnificClient({ transport: stubTransport(CREATED, sink) });
    const provider = new MagnificProvider({ client, modelId: "magnific.kling-v2-6-pro" });

    await provider.generateVideo(videoInput());
    expect(JSON.parse(String(sink.init?.body)).image).toBeUndefined();

    await provider.generateVideo(videoInput({ referenceImageUrl: "https://example.test/a.png" }));
    expect(JSON.parse(String(sink.init?.body)).image).toBe("https://example.test/a.png");
  });

  it("polls the submit path plus the task id", async () => {
    const sink: { url?: string } = {};
    const client = new MagnificClient({
      transport: stubTransport(
        { status: 200, body: { data: { task_id: "t-9", status: "IN_PROGRESS", generated: [] } } },
        sink,
      ),
    });
    await new MagnificProvider({ client, modelId: "magnific.mystic" }).getTaskStatus("t-9", "image");

    expect(sink.url).toBe("https://api.magnific.com/v1/ai/mystic/t-9");
  });
});

// =============================================================================
// Catalogue mapping
// =============================================================================

describe("catalogue mapping", () => {
  it("returns null for a ratio Magnific cannot do, rather than a nearest match", () => {
    // Silently substituting 16:9 for a 4:3 request produces a file that passes
    // every technical check and is wrong in a way nobody notices.
    expect(toMagnificVideoRatio("4:3")).toBeNull();
    expect(toMagnificVideoRatio("4:5")).toBeNull();
    expect(toMagnificImageRatio("4:3")).toBe("classic_4_3");
  });

  it("rounds a requested duration UP to one the model accepts", () => {
    const kling = findModel("magnific.kling-v2-6-pro");
    expect(kling).not.toBeNull();
    // Rounding down would truncate a shot the storyboard timed.
    expect(quantiseDuration(kling!, 3)).toBe(5);
    expect(quantiseDuration(kling!, 5)).toBe(5);
    expect(quantiseDuration(kling!, 6)).toBe(10);
    expect(quantiseDuration(kling!, 30)).toBe(10);
  });

  it("selects cheaper models for draft and dearer for high, within a mode", () => {
    const draft = selectModel("image", "cinematic", "draft");
    const high = selectModel("image", "cinematic", "high");
    expect(draft).not.toBeNull();
    expect(high).not.toBeNull();
    expect(draft!.estimatedCentsPerUnit).toBeLessThanOrEqual(high!.estimatedCentsPerUnit);
  });

  it("offers no video model for fast production", () => {
    // Fast Reel is defined as images plus editor motion, so a video model here
    // would silently blow the €0.20–0.60 cost band.
    expect(selectModel("video", "fast", "standard")).toBeNull();
  });
});

// =============================================================================
// supports()
// =============================================================================

describe("supports()", () => {
  beforeEach(() => {
    process.env[KEY_VAR] = "test-key";
  });

  it("refuses a 4:5 video and says which ratios are available", () => {
    const decision = new MagnificProvider().supports({ kind: "video", ratio: "4:5", mode: "hybrid" });
    expect(decision.supported).toBe(false);
    if (!decision.supported) expect(decision.reason).toContain("9:16");
  });

  it("refuses a shot longer than the model's longest clip", () => {
    const decision = new MagnificProvider().supports({
      kind: "video",
      ratio: "9:16",
      durationSeconds: 30,
      mode: "hybrid",
    });
    expect(decision.supported).toBe(false);
  });

  it("throws ProviderUnsupportedError if generate is called anyway", async () => {
    const client = new MagnificClient({ transport: stubTransport(CREATED) });
    await expect(
      new MagnificProvider({ client }).generateVideo(videoInput({ ratio: "4:5" })),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
});

// =============================================================================
// Response mapping
// =============================================================================

describe("response mapping", () => {
  it("maps COMPLETED to `downloading`, never to `completed`", () => {
    // The bytes are at an expiring provider URL, not in Virally storage. Only
    // ingestion may declare a run complete.
    expect(toState("COMPLETED")).toBe("downloading");
    expect(toState("CREATED")).toBe("submitted");
    expect(toState("IN_PROGRESS")).toBe("generating");
    expect(toState("FAILED")).toBe("failed");
  });

  it("reports null progress while running, because Magnific sends none", async () => {
    process.env[KEY_VAR] = "k";
    const client = new MagnificClient({
      transport: stubTransport({
        status: 200,
        body: { data: { task_id: "t", status: "IN_PROGRESS", generated: [] } },
      }),
    });
    const status = await new MagnificProvider({ client, modelId: "magnific.mystic" }).getTaskStatus(
      "t",
      "image",
    );
    expect(status.progress).toBeNull();
  });

  it("rejects a malformed envelope instead of yielding an undefined task id", () => {
    expect(() => parseEnvelope({ data: { status: "CREATED", generated: [] } })).toThrow(
      MagnificRequestError,
    );
    expect(() => parseEnvelope({ data: { task_id: "t", status: "WAT", generated: [] } })).toThrow(
      MagnificRequestError,
    );
    expect(() => parseEnvelope(null)).toThrow(MagnificRequestError);
  });

  it("marks rate limits retryable and unbilled, but 5xx retryable and billed", () => {
    // The two flags drive different machinery: retry decisions and refunds.
    const limited = mapFailure(429, {});
    expect(limited.retryable).toBe(true);
    expect(limited.costIncurred).toBe(false);

    const serverError = mapFailure(500, {});
    expect(serverError.retryable).toBe(true);
    // Conservative: a 500 can follow a generation that already ran.
    expect(serverError.costIncurred).toBe(true);

    const bad = mapFailure(400, { message: "aspect_ratio is not valid" });
    expect(bad.retryable).toBe(false);
    expect(bad.message).toContain("aspect_ratio");
  });
});

// =============================================================================
// Mock provider
// =============================================================================

describe("MockCreativeProvider", () => {
  it("costs nothing — an invented cost would corrupt the ledger", async () => {
    const estimate = await new MockCreativeProvider().estimateVideo(videoInput());
    expect(estimate.internalCents).toBe(0);
    expect(estimate.internalCredits).toBe(0);
    expect(estimate.providerCredits).toBe(0);
  });

  it("is deterministic: the same idempotency key yields the same task", async () => {
    const provider = new MockCreativeProvider();
    const a = await provider.generateImage(imageInput({ idempotencyKey: "same" }));
    const b = await provider.generateImage(imageInput({ idempotencyKey: "same" }));
    const c = await provider.generateImage(imageInput({ idempotencyKey: "other" }));

    expect(a.externalTaskId).toBe(b.externalTaskId);
    expect(a.externalTaskId).not.toBe(c.externalTaskId);
  });

  it("progresses asynchronously and stops at `downloading`, like the real thing", async () => {
    const provider = new MockCreativeProvider();
    const task = await provider.generateImage(imageInput());

    const states: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      states.push((await provider.getTaskStatus(task.externalTaskId, "image")).state);
    }

    expect(states[0]).toBe("submitted");
    expect(states).toContain("generating");
    // Never `completed` — ingestion has not happened.
    expect(states).not.toContain("completed");
    expect(states[states.length - 1]).toBe("downloading");
  });

  it("fails loudly on an unknown task rather than hanging a worker", async () => {
    const status = await new MockCreativeProvider().getTaskStatus("nope", "image");
    expect(status.state).toBe("failed");
    expect(status.failure?.retryable).toBe(false);
  });

  it("marks its media as demo and does not point at an external host", async () => {
    const provider = new MockCreativeProvider();
    const task = await provider.generateVideo(videoInput());
    for (let i = 0; i < 4; i += 1) await provider.getTaskStatus(task.externalTaskId, "video");
    const final = await provider.getTaskStatus(task.externalTaskId, "video");

    expect(final.media[0]?.url).toContain("demo=1");
    expect(final.media[0]?.url.startsWith("/")).toBe(true);
  });
});

// =============================================================================
// Router
// =============================================================================

describe("ProviderRouter", () => {
  it("falls back to the mock when nothing is configured, and says so", () => {
    delete process.env[KEY_VAR];
    const decision = new ProviderRouter().route({
      kind: "image",
      mode: "fast",
      allowMockFallback: true,
    });

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.isMock).toBe(true);
      expect(decision.reason).toContain("demo");
    }
  });

  it("refuses rather than silently producing demo output when fallback is off", () => {
    // A user who reserved credits must not receive a mock asset.
    delete process.env[KEY_VAR];
    const decision = new ProviderRouter().route({
      kind: "image",
      mode: "fast",
      allowMockFallback: false,
    });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("MAGNIFIC_API_KEY");
  });

  it("prefers a configured real provider over the mock", () => {
    process.env[KEY_VAR] = "k";
    const decision = new ProviderRouter().route({
      kind: "image",
      ratio: "9:16",
      mode: "fast",
      allowMockFallback: true,
    });

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.isMock).toBe(false);
      expect(decision.provider.id).toBe("magnific");
    }
  });

  it("records why each candidate was rejected", () => {
    process.env[KEY_VAR] = "k";
    const decision = new ProviderRouter().route({
      kind: "video",
      ratio: "4:3",
      mode: "hybrid",
      allowMockFallback: true,
    });

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.isMock).toBe(true);
      expect(decision.rejected.map((r) => r.providerId)).toContain("magnific");
    }
  });

  it("honours a workspace's preferred provider when it can serve", () => {
    process.env[KEY_VAR] = "k";
    const decision = new ProviderRouter().route({
      kind: "image",
      mode: "fast",
      preferredProviderId: "magnific",
      allowMockFallback: true,
    });

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.reason).toContain("preferred");
  });
});

// =============================================================================
// Webhook verification
// =============================================================================

describe("webhook verification", () => {
  const SECRET = "shhh";
  const BODY = '{"data":{"task_id":"t-1","status":"COMPLETED","generated":["https://x/y.png"]}}';

  function headersFor(timestamp: number, body = BODY, id = "wh-1") {
    return {
      id,
      timestamp: String(timestamp),
      signature: signWebhook(SECRET, id, String(timestamp), body),
    };
  }

  it("accepts a correctly signed, fresh payload", () => {
    const now = 1_800_000_000;
    const result = verifyMagnificWebhook(headersFor(now), BODY, { nowSeconds: now, secret: SECRET });
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const now = 1_800_000_000;
    const tampered = BODY.replace("https://x/y.png", "https://evil.test/y.png");
    const result = verifyMagnificWebhook(headersFor(now), tampered, {
      nowSeconds: now,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a replay outside the tolerance window", () => {
    const now = 1_800_000_000;
    const result = verifyMagnificWebhook(headersFor(now - 3600), BODY, {
      nowSeconds: now,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a far-future timestamp as well as a stale one", () => {
    const now = 1_800_000_000;
    const result = verifyMagnificWebhook(headersFor(now + 3600), BODY, {
      nowSeconds: now,
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    delete process.env[SECRET_VAR];
    const now = 1_800_000_000;
    const result = verifyMagnificWebhook(headersFor(now), BODY, { nowSeconds: now });
    expect(result.ok).toBe(false);
  });

  it("rejects a payload missing any required header", () => {
    const now = 1_800_000_000;
    expect(
      verifyMagnificWebhook({ id: "wh-1", timestamp: String(now), signature: null }, BODY, {
        nowSeconds: now,
        secret: SECRET,
      }).ok,
    ).toBe(false);
  });
});

// =============================================================================
// Production modes and credits
// =============================================================================

describe("production modes", () => {
  it("charges the credits the brief specifies", () => {
    expect(productionModeDefault("fast").productionCredits).toBe(1);
    expect(productionModeDefault("hybrid").productionCredits).toBe(6);
    expect(productionModeDefault("cinematic").productionCredits).toBe(24);
  });

  it("keeps every mode's credit price inside its own target cost band", () => {
    // This is the margin guard: if a mode's credits stop covering its cost band,
    // the product loses money on every reel of that type.
    for (const mode of ["fast", "hybrid", "cinematic"] as const) {
      const definition = productionModeDefault(mode);
      const covered = definition.productionCredits * CENTS_PER_PRODUCTION_CREDIT;
      expect(covered).toBeGreaterThanOrEqual(definition.targetCostCentsLow);
    }
  });

  it("rounds credits up, so a batch of small operations is not free", () => {
    expect(centsToCredits(0)).toBe(0);
    expect(centsToCredits(1)).toBe(1);
    expect(centsToCredits(CENTS_PER_PRODUCTION_CREDIT)).toBe(1);
    expect(centsToCredits(CENTS_PER_PRODUCTION_CREDIT + 1)).toBe(2);
  });
});

// =============================================================================
// Tenant scope
// =============================================================================

describe("tenant scope", () => {
  it("rejects an incomplete scope — there is no RLS behind it", () => {
    expect(() => assertScope({ organizationId: "", workspaceId: "w" })).toThrow();
    expect(() => assertScope({ organizationId: "o", workspaceId: "  " })).toThrow();
    // A scope built from an unauthenticated session can carry undefined that
    // TypeScript's `string` does not catch at a JSON boundary.
    expect(() =>
      assertScope({ organizationId: undefined, workspaceId: "w" } as unknown as {
        organizationId: string;
        workspaceId: string;
      }),
    ).toThrow();
  });

  it("accepts a complete scope", () => {
    expect(tenantScope("org-1", "ws-1")).toEqual({ organizationId: "org-1", workspaceId: "ws-1" });
  });
});

describe("task states", () => {
  it("treats only completed, failed and cancelled as terminal", () => {
    expect(isTerminalState("completed")).toBe(true);
    expect(isTerminalState("failed")).toBe(true);
    expect(isTerminalState("cancelled")).toBe(true);
    // `downloading` is NOT terminal: the bytes are not ours yet.
    expect(isTerminalState("downloading")).toBe(false);
    expect(isTerminalState("generating")).toBe(false);
  });
});
