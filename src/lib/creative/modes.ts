import type { ProductionMode } from "./types";

/**
 * Production-mode defaults.
 *
 * These are the seed values for the `production_modes` table and the fallback
 * used before it has been seeded. They are NOT the runtime source of truth —
 * the brief requires these numbers to be editable without a deploy, so anything
 * pricing a real generation must read the table via `loadProductionModes()`
 * and use this only when the table is empty.
 *
 * Money is integer cents throughout. Currency is EUR, matching the plan
 * pricing; nothing here converts, so a deployment billing in another currency
 * must reseed rather than multiply at read time.
 */

/**
 * Internal cost one Production Credit is meant to cover.
 *
 * Derived from the brief's own bands rather than chosen: Fast is 1 credit for
 * 20–60c, Hybrid 6 credits for 120–250c, Cinematic 24 credits for 500–900c.
 * Those imply roughly 20–42c per credit, so 25 sits inside every band. It is
 * the single conversion between provider cost and user-visible credits, and
 * changing it reprices the whole product — which is why it lives here alone and
 * not inline in an adapter.
 */
export const CENTS_PER_PRODUCTION_CREDIT = 25;

export type ProductionModeDefinition = {
  id: ProductionMode;
  label: string;
  description: string;
  position: number;
  productionCredits: number;
  targetCostCentsLow: number;
  targetCostCentsHigh: number;
  aiVideoClipsMin: number;
  aiVideoClipsMax: number;
  generatedImagesTypical: number;
  regenerationAllowance: number;
  /** What the mode actually assembles. Shown in the create-page selector. */
  composition: readonly string[];
};

export const PRODUCTION_MODE_DEFAULTS: readonly ProductionModeDefinition[] = [
  {
    id: "fast",
    label: "Fast Reel",
    description:
      "High volume at the lowest cost. Generated stills given motion in the editor rather than generated video, so the cost is dominated by images and rendering.",
    position: 0,
    productionCredits: 1,
    targetCostCentsLow: 20,
    targetCostCentsHigh: 60,
    aiVideoClipsMin: 0,
    aiVideoClipsMax: 1,
    generatedImagesTypical: 6,
    regenerationAllowance: 0,
    composition: [
      "Generated images or licensed stock",
      "Camera movement, zooms, pans and crops added in the editor",
      "Voice-over and word-level captions",
      "Music and motion graphics",
      "At most one short generated video clip",
    ],
  },
  {
    id: "hybrid",
    label: "Hybrid Reel",
    description:
      "Real generated motion where it matters, stills elsewhere. The best quality-to-price balance and the default for most campaigns that need movement.",
    position: 1,
    productionCredits: 6,
    targetCostCentsLow: 120,
    targetCostCentsHigh: 250,
    aiVideoClipsMin: 2,
    aiVideoClipsMax: 3,
    generatedImagesTypical: 4,
    regenerationAllowance: 1,
    composition: [
      "Two or three generated video clips",
      "Generated images or stock between clips",
      "Voice-over and word-level captions",
      "Music and editor-driven transitions",
      "Hook and CTA variations",
    ],
  },
  {
    id: "cinematic",
    label: "Cinematic Reel",
    description:
      "Mostly generated moving footage on premium models, with a regeneration allowance for shots that miss. For launches and paid campaigns.",
    position: 2,
    productionCredits: 24,
    targetCostCentsLow: 500,
    targetCostCentsHigh: 900,
    aiVideoClipsMin: 5,
    aiVideoClipsMax: 10,
    generatedImagesTypical: 2,
    regenerationAllowance: 3,
    composition: [
      "Multiple premium generated clips",
      "Higher-cost models with stronger visual consistency",
      "Included regeneration allowance",
      "Advanced sound design",
      "Higher-quality export and advanced composition",
    ],
  },
] as const;

export function productionModeDefault(mode: ProductionMode): ProductionModeDefinition {
  const found = PRODUCTION_MODE_DEFAULTS.find((definition) => definition.id === mode);
  // Every ProductionMode has a definition, and the type system enforces that the
  // union is exhaustive. Throwing rather than defaulting keeps a future added
  // mode from silently pricing as Fast.
  if (!found) throw new Error(`No production mode definition for "${mode}".`);
  return found;
}

/** Converts an internal cost in cents to whole Production Credits. */
export function centsToCredits(cents: number): number {
  const safe = Math.max(0, Math.trunc(cents));
  if (safe === 0) return 0;
  // Rounded up: a generation that costs a fraction of a credit still costs a
  // credit, and rounding down would let a large batch of small operations run
  // free.
  return Math.ceil(safe / CENTS_PER_PRODUCTION_CREDIT);
}

/** The safest mode, used when nothing has been chosen yet. */
export const DEFAULT_PRODUCTION_MODE: ProductionMode = "fast";
