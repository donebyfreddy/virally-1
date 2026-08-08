/**
 * @vitest-environment node
 *
 * Node for the same reason fal/fal.test.ts is: this file imports the creative
 * barrel, which reaches the credential guard in env.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateCatalogCache,
  listModels,
  loadCatalog,
  modelToRow,
  rowToModel,
  seedCatalog,
} from "./catalog";
import { isRoutable, kindForCapability } from "./capabilities";
import { FAL_MODELS } from "./fal/catalog";
import { MAGNIFIC_MODELS_NORMALISED } from "./magnific/catalog";

/**
 * The catalogue is what makes models data rather than code.
 *
 * The properties worth holding are the ones that only break in production: a
 * database outage taking generation down with it, a disabled model still being
 * routed to, and a seed row and a fallback row describing the same model
 * differently.
 */

beforeEach(() => {
  invalidateCatalogCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  invalidateCatalogCache();
});

describe("seed fallback", () => {
  it("resolves without a database", async () => {
    // DATABASE_URL is absent in unit tests. The loader must degrade to "the
    // models we shipped with" rather than "generation is impossible" — the
    // difference between a working dev environment and a mystifying empty
    // dropdown.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const models = await loadCatalog();
    expect(models.length).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("combines both providers", () => {
    const providers = new Set(seedCatalog().map((each) => each.providerId));
    expect(providers.has("magnific")).toBe(true);
    expect(providers.has("fal")).toBe(true);
  });

  it("covers every image, video, voiceover and music capability across the two providers", () => {
    const covered = new Set(seedCatalog().flatMap((each) => each.capabilities));
    const expected = [
      "text-to-image",
      "image-to-image",
      "text-to-video",
      "image-to-video",
      "audio",
      "music",
      "sound-effect",
    ] as const;
    for (const capability of expected) {
      expect(covered.has(capability), capability).toBe(true);
    }
  });

  it("has no real provider for lip-sync or upscale — these fall through to the mock", () => {
    // MuAPI was the only provider that catalogued these, and it has been
    // removed from the active generation flow. A request for one of them is
    // routed to the deterministic mock and labelled as demo until a fal or
    // Magnific model is catalogued for it.
    const covered = new Set(seedCatalog().flatMap((each) => each.capabilities));
    expect(covered.has("lip-sync")).toBe(false);
    expect(covered.has("upscale")).toBe(false);
  });

  it("has no id collisions between providers", () => {
    const ids = seedCatalog().map((each) => each.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns only routable models", () => {
    for (const each of seedCatalog()) {
      expect(isRoutable(each), each.id).toBe(true);
    }
  });
});

describe("filtering", () => {
  it("filters by capability", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const models = await listModels({ capability: "image-to-video" });
    expect(models.length).toBeGreaterThan(0);
    for (const each of models) {
      expect(each.capabilities).toContain("image-to-video");
    }
  });

  it("filters by production mode, so a tier is never served a model it did not buy", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const models = await listModels({ mode: "fast" });
    expect(models.length).toBeGreaterThan(0);
    for (const each of models) {
      expect(each.modes).toContain("fast");
    }
  });

  it("filters by provider", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const models = await listModels({ providerId: "fal" });
    expect(models.length).toBeGreaterThan(0);
    for (const each of models) {
      expect(each.providerId).toBe("fal");
    }
  });
});

describe("row mapping", () => {
  it("round-trips a model through the row shape without losing a field", () => {
    // The seeder and the runtime fallback both go through `modelToRow`. If the
    // round trip drops a constraint, a seeded deployment and an unseeded one
    // disagree about what a model can do — and only one of them is tested.
    for (const original of [...FAL_MODELS, ...MAGNIFIC_MODELS_NORMALISED]) {
      const row = modelToRow(original, kindForCapability(original.capabilities[0]!));
      const restored = rowToModel({
        ...row,
        description: row.description ?? null,
        estimatedCentsPerUnit: row.estimatedCentsPerUnit ?? null,
        deprecatedAt: row.deprecatedAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Parameters<typeof rowToModel>[0]);

      expect(restored.id, original.id).toBe(original.id);
      expect(restored.providerId).toBe(original.providerId);
      expect(restored.externalModelId).toBe(original.externalModelId);
      expect(restored.name).toBe(original.name);
      expect([...restored.capabilities]).toEqual([...original.capabilities]);
      expect([...restored.inputTypes]).toEqual([...original.inputTypes]);
      expect([...restored.supportedAspectRatios]).toEqual([...original.supportedAspectRatios]);
      expect([...restored.supportedDurations]).toEqual([...original.supportedDurations]);
      expect([...restored.supportedResolutions]).toEqual([...original.supportedResolutions]);
      expect([...restored.modes]).toEqual([...original.modes]);
      expect(restored.supportsNegativePrompt).toBe(original.supportsNegativePrompt);
      expect(restored.supportsSeed).toBe(original.supportsSeed);
      expect(restored.supportsAudio).toBe(original.supportsAudio);
      expect(restored.estimatedCentsPerUnit).toBe(original.estimatedCentsPerUnit);
      expect(restored.maxReferenceImages ?? 0).toBe(original.maxReferenceImages ?? 0);
    }
  });

  it("never labels a configured price as a provider quote", () => {
    // Neither vendor returns a price at submit time — fal publishes none at
    // all. `provider_quote` would misrepresent where the figure came from.
    for (const model of FAL_MODELS) {
      const row = modelToRow(model, "image");
      expect(row.costBasis).toBe("configured_table");
    }
  });

  it("drops a jsonb value that is not a valid member of its union", () => {
    // A cast would let a malformed seed row produce a model whose ratios
    // contain a string that is not an AspectRatio, which then fails a ratio
    // comparison silently and routes the request somewhere unexpected.
    const restored = rowToModel({
      id: "x.y",
      providerId: "x",
      label: "Y",
      description: null,
      kind: "image",
      externalModelId: "y",
      endpointPath: "y",
      capabilities: ["text-to-image", "not-a-capability"],
      inputTypes: ["text", 42],
      maxReferenceImages: 0,
      allowedDurations: [5, "ten"],
      supportedRatios: ["16:9", "21:9"],
      supportedResolutions: ["1k"],
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsAudio: false,
      estimatedCentsPerUnit: 5,
      costBasis: "configured_table",
      modes: ["fast", "turbo"],
      enabled: true,
      deprecatedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof rowToModel>[0]);

    expect([...restored.capabilities]).toEqual(["text-to-image"]);
    expect([...restored.inputTypes]).toEqual(["text"]);
    expect([...restored.supportedDurations]).toEqual([5]);
    expect([...restored.supportedAspectRatios]).toEqual(["16:9"]);
    expect([...restored.modes]).toEqual(["fast"]);
  });

  it("treats an unpriced row as unroutable rather than as free", () => {
    const restored = rowToModel({
      id: "x.y",
      providerId: "x",
      label: "Y",
      description: null,
      kind: "image",
      externalModelId: "y",
      endpointPath: "y",
      capabilities: ["text-to-image"],
      inputTypes: ["text"],
      maxReferenceImages: 0,
      allowedDurations: [],
      supportedRatios: [],
      supportedResolutions: [],
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsAudio: false,
      estimatedCentsPerUnit: null,
      costBasis: "configured_table",
      modes: ["fast"],
      enabled: true,
      deprecatedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof rowToModel>[0]);

    expect(restored.estimatedCentsPerUnit).toBeUndefined();
    expect(isRoutable(restored)).toBe(false);
  });
});
