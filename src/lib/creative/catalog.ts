import { and, eq, isNull, sql } from "drizzle-orm";
import { generationModels, generationModelVersions } from "@/lib/db/schema.creative";
import type { AspectRatio } from "@/types/database";
import {
  isGenerationCapability,
  isRoutable,
  type GenerationCapability,
  type GenerationInputType,
  type GenerationModel,
} from "./capabilities";
import { FAL_MODELS } from "./fal/catalog";
import { MAGNIFIC_MODELS_NORMALISED } from "./magnific/catalog";
import type { GenerationKind, ProductionMode } from "./types";

/**
 * The model catalogue, read from Neon.
 *
 * `generation_models` is authoritative at runtime. The in-code catalogues under
 * fal/ and magnific/ are seed data and the unseeded-deployment fallback, and
 * nothing outside the seeder reads them to make a routing decision.
 *
 * That indirection is the entire point of this module. The brief requires the
 * application to survive models being added, removed, renamed, temporarily
 * withdrawn, deprecated, repriced and capability-restricted, and none of those
 * are survivable against a hardcoded array — every one of them would be a
 * deploy, and the two that matter most (a model going down, a price changing)
 * would be a deploy under time pressure.
 *
 * It is also what makes "no model selector hardcoded in JSX" enforceable rather
 * than aspirational: a component that wants a model list has to ask for one,
 * and what it gets back carries the constraints it needs to render the form.
 */

// --- Caching ------------------------------------------------------------------

/**
 * Short-lived process cache.
 *
 * The catalogue changes rarely and is read on every estimate, every route and
 * every render of a model picker, so an uncached read would put a query on the
 * hot path of the whole feature. Thirty seconds is chosen so an operator
 * disabling a model during an incident sees it take effect within one page
 * refresh — long enough to be worth having, short enough that nobody has to
 * remember a cache exists.
 *
 * Deliberately not `unstable_cache` or `revalidateTag`: this is read from
 * server actions, route handlers AND a worker process, and only one of those
 * three has a Next.js request context to hang a cache tag on.
 */
const CACHE_TTL_MS = 30_000;

type CacheEntry = { models: readonly GenerationModel[]; loadedAt: number };

let cache: CacheEntry | null = null;

/** Test seam, and the hook an admin write should call after changing a model. */
export function invalidateCatalogCache(): void {
  cache = null;
}

/**
 * Resolves the database handle at call time rather than at import time.
 *
 * `@/lib/db` constructs its pool as a module-level constant and throws when
 * DATABASE_URL is absent, so a static import here would make importing ANY of
 * the creative barrel — the router, the capability taxonomy, the seed
 * catalogues — require a configured database. That is the wrong dependency
 * direction twice over: the seed fallback exists precisely for the case where
 * the database is unavailable, and a unit test of ratio mapping has no business
 * needing a connection string.
 */
async function database() {
  const { db } = await import("@/lib/db");
  return db;
}

// --- Reading ------------------------------------------------------------------

/**
 * Every routable model across every provider.
 *
 * Returns the seed fallback when the table is empty, which is the state of a
 * deployment that has migrated but not yet seeded, and of every unit test that
 * does not stand up a database. Falling back rather than returning nothing
 * means an unseeded environment degrades to "the models we shipped with"
 * instead of "generation is impossible", and the difference shows up as a
 * working dev environment rather than a mystifying empty dropdown.
 */
export async function loadCatalog(): Promise<readonly GenerationModel[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.models;

  let models: readonly GenerationModel[];
  try {
    const rows = await (await database())
      .select()
      .from(generationModels)
      .where(
        and(
          eq(generationModels.enabled, true),
          isNull(generationModels.deprecatedAt),
          sql`${generationModels.estimatedCentsPerUnit} is not null`,
        ),
      );
    models = rows.map(rowToModel).filter(isRoutable);
  } catch (error) {
    // A catalogue read failing is not a reason to make generation impossible —
    // the seed is a correct, if possibly stale, answer. Logged rather than
    // swallowed so a persistently unreachable database is visible instead of
    // being permanently masked by a fallback that appears to work.
    console.warn("[catalog] Falling back to seed models: could not read generation_models.", error);
    models = seedCatalog();
  }

  if (models.length === 0) models = seedCatalog();

  cache = { models, loadedAt: now };
  return models;
}

export async function listModels(options: {
  providerId?: string;
  capability?: GenerationCapability;
  kind?: GenerationKind;
  mode?: ProductionMode;
} = {}): Promise<readonly GenerationModel[]> {
  const all = await loadCatalog();
  return all.filter((model) => {
    if (options.providerId !== undefined && model.providerId !== options.providerId) return false;
    if (options.capability !== undefined && !model.capabilities.includes(options.capability)) {
      return false;
    }
    if (options.mode !== undefined && !model.modes.includes(options.mode)) return false;
    return true;
  });
}

export async function findModel(id: string): Promise<GenerationModel | null> {
  const all = await loadCatalog();
  return all.find((model) => model.id === id) ?? null;
}

/**
 * Resolves a model that may no longer be routable.
 *
 * Separate from `findModel` because a historic run references a model that may
 * since have been retired or switched off, and the usage dashboard still has to
 * render its name. Bypasses the cache and the routable filter for exactly that
 * reason, and must never be used to pick a model for a new generation.
 */
export async function findModelForDisplay(id: string): Promise<GenerationModel | null> {
  try {
    const rows = await (await database())
      .select()
      .from(generationModels)
      .where(eq(generationModels.id, id))
      .limit(1);
    const row = rows[0];
    if (row) return rowToModel(row);
  } catch {
    // Fall through to the seed, which is better than rendering a bare id.
  }
  return seedCatalog().find((model) => model.id === id) ?? null;
}

// --- Writing ------------------------------------------------------------------

export type CatalogChangeReason =
  | "seeded"
  | "repriced"
  | "renamed"
  | "deprecated"
  | "capability_changed"
  | "enabled_changed";

/**
 * Records a version snapshot for a model.
 *
 * Called by the seeder and by any admin write. Append-only: a change writes a
 * new version rather than updating one, because the reason this table exists is
 * to answer "what did this cost in March", and a mutable history cannot.
 */
export async function recordModelVersion(input: {
  modelId: string;
  snapshot: Record<string, unknown>;
  estimatedCentsPerUnit: number | null;
  externalModelId: string;
  changeReason: CatalogChangeReason;
  changedBy?: string;
}): Promise<number> {
  const db = await database();
  const [latest] = await db
    .select({ version: generationModelVersions.version })
    .from(generationModelVersions)
    .where(eq(generationModelVersions.modelId, input.modelId))
    .orderBy(sql`${generationModelVersions.version} desc`)
    .limit(1);

  const version = (latest?.version ?? 0) + 1;

  await db
    .insert(generationModelVersions)
    .values({
      modelId: input.modelId,
      version,
      snapshot: input.snapshot,
      estimatedCentsPerUnit: input.estimatedCentsPerUnit,
      externalModelId: input.externalModelId,
      changeReason: input.changeReason,
      changedBy: input.changedBy ?? null,
    })
    // A concurrent seeder racing to the same version number is a duplicate
    // snapshot, not a fault worth failing a deploy over.
    .onConflictDoNothing();

  return version;
}

// --- Mapping ------------------------------------------------------------------

type ModelRow = typeof generationModels.$inferSelect;

/**
 * Maps a catalogue row onto the domain type.
 *
 * The jsonb columns are `unknown` as far as the type system is concerned, so
 * every one is filtered through a narrowing guard rather than cast. A cast here
 * would let one malformed seed row produce a model whose `supportedAspectRatios`
 * contains a string that is not an `AspectRatio`, which then fails a ratio
 * comparison silently and routes the request somewhere unexpected.
 */
export function rowToModel(row: ModelRow): GenerationModel {
  return {
    id: row.id,
    providerId: row.providerId,
    externalModelId: row.externalModelId,
    name: row.label,
    description: row.description ?? undefined,
    capabilities: asStringArray(row.capabilities).filter(isGenerationCapability),
    inputTypes: asStringArray(row.inputTypes).filter(isInputType),
    maxReferenceImages: row.maxReferenceImages > 0 ? row.maxReferenceImages : undefined,
    supportedAspectRatios: asStringArray(row.supportedRatios).filter(isAspectRatio),
    supportedDurations: asNumberArray(row.allowedDurations),
    supportedResolutions: asStringArray(row.supportedResolutions),
    supportsNegativePrompt: row.supportsNegativePrompt,
    supportsSeed: row.supportsSeed,
    supportsAudio: row.supportsAudio,
    modes: asStringArray(row.modes).filter(isProductionMode),
    estimatedCentsPerUnit: row.estimatedCentsPerUnit ?? undefined,
    enabled: row.enabled,
    deprecatedAt: row.deprecatedAt ?? undefined,
    metadata: isRecord(row.metadata) ? row.metadata : undefined,
  };
}

/** The inverse, for the seeder. Timestamps are left to the column defaults. */
export function modelToRow(
  model: GenerationModel,
  kind: GenerationKind,
): typeof generationModels.$inferInsert {
  return {
    id: model.id,
    providerId: model.providerId,
    label: model.name,
    description: model.description ?? null,
    kind,
    externalModelId: model.externalModelId,
    endpointPath: model.externalModelId,
    capabilities: [...model.capabilities],
    inputTypes: [...model.inputTypes],
    maxReferenceImages: model.maxReferenceImages ?? 0,
    allowedDurations: [...model.supportedDurations],
    supportedRatios: [...model.supportedAspectRatios],
    supportedResolutions: [...model.supportedResolutions],
    supportsNegativePrompt: model.supportsNegativePrompt,
    supportsSeed: model.supportsSeed,
    supportsAudio: model.supportsAudio,
    estimatedCentsPerUnit: model.estimatedCentsPerUnit ?? null,
    // Never `provider_quote`: neither provider returns a price at submit time,
    // and MuAPI publishes none at all. Anything built from these figures must
    // be presentable as an estimate, not as a vendor quote.
    costBasis: "configured_table",
    modes: [...model.modes],
    enabled: model.enabled,
    deprecatedAt: model.deprecatedAt ?? null,
    metadata: model.metadata ?? {},
  };
}

const INPUT_TYPES = new Set<string>(["text", "image", "video", "audio"]);
const PRODUCTION_MODES = new Set<string>(["fast", "hybrid", "cinematic"]);
const ASPECT_RATIOS = new Set<string>(["9:16", "4:5", "1:1", "16:9", "4:3", "3:2", "custom"]);

function isInputType(value: string): value is GenerationInputType {
  return INPUT_TYPES.has(value);
}

function isProductionMode(value: string): value is ProductionMode {
  return PRODUCTION_MODES.has(value);
}

function isAspectRatio(value: string): value is AspectRatio {
  return ASPECT_RATIOS.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

// --- Seed fallback ------------------------------------------------------------

/**
 * The in-code catalogues, combined.
 *
 * This is the ONLY place outside the seeder permitted to read them. Everything
 * else goes through `loadCatalog`, so a provider catalogue can never quietly
 * become the thing a routing decision is made against.
 */
export function seedCatalog(): readonly GenerationModel[] {
  return [...FAL_MODELS, ...MAGNIFIC_MODELS_NORMALISED];
}
