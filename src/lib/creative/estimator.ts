import type { AspectRatio, Platform } from "@/types/database";
import { computeCounts, type PlanCounts, type Quality } from "@/lib/content/plan";
import { PRODUCTION_MODE_DEFAULTS, centsToCredits, productionModeDefault } from "./modes";
import type { ProductionMode } from "./types";

/**
 * Production-mode batch estimate.
 *
 * Builds on `src/lib/content/plan.ts`, which already computes how many scripts,
 * items, variants and publish jobs a request produces and is exhaustively
 * tested. This module adds the part that plan.ts has no concept of: what a
 * production MODE changes about the work, and what that costs in Production
 * Credits.
 *
 * The division is deliberate. `computeCounts` answers "how many of each thing",
 * which depends only on the multiplication of concepts × hooks × languages ×
 * formats. This answers "how expensive is each thing", which depends on the mode.
 * Merging them would make the mode a parameter of arithmetic it does not affect.
 *
 * Every number here is an integer. Credits are whole, cents are whole, counts
 * are whole. Accumulating floats across a thousand-item batch produces totals
 * that are wrong in the last digit and impossible to reconcile against a ledger.
 */

export type EstimateRequest = {
  mode: ProductionMode;
  concepts: number;
  hooksPerConcept: number;
  platforms: readonly Platform[];
  ratios: readonly AspectRatio[];
  languages: readonly string[];
  accountCount: number;
  withVoiceover: boolean;
  withThumbnail: boolean;
  withMusic: boolean;
  durationSeconds: number;
  quality: Quality;
};

/** What the batch will actually produce, mode included. */
export type EstimateWork = PlanCounts & {
  /** Generated video clips. Driven by the mode, not by the variant count. */
  aiVideoClips: number;
  /** Generated stills. */
  generatedImages: number;
  musicTracks: number;
  /** Platform-specific exports, which reuse a composition rather than re-render. */
  platformExports: number;
};

export type ModeEstimate = {
  mode: ProductionMode;
  work: EstimateWork;
  /** Per-stage rows for the UI. Only non-zero stages appear. */
  breakdown: readonly { stage: string; units: number; credits: number }[];
  /** Total Production Credits to reserve. */
  credits: number;
  /**
   * Internal cost basis in integer cents, for margin reporting only.
   *
   * Never shown to the user. It is our provider cost, not their price, and
   * conflating the two on a customer-facing surface would publish our margin.
   */
  internalCents: number;
};

export type BalanceComparison = {
  estimate: ModeEstimate;
  available: number;
  /** Negative when the batch cannot be afforded. */
  balanceAfter: number;
  affordable: boolean;
  shortfall: number;
};

/**
 * Counts the work a batch produces under a given mode.
 *
 * The two mode-dependent quantities are AI video clips and generated images.
 * Fast substitutes editor motion over stills for generated video; Cinematic
 * does the reverse. Everything else — scripts, voiceovers, renders — scales with
 * the item and variant counts regardless of mode.
 */
export function computeWork(request: EstimateRequest): EstimateWork {
  const counts = computeCounts({
    concepts: request.concepts,
    hooksPerConcept: request.hooksPerConcept,
    platforms: request.platforms,
    ratios: request.ratios,
    languages: request.languages,
    accountCount: request.accountCount,
    withVoiceover: request.withVoiceover,
    withThumbnail: request.withThumbnail,
    durationSeconds: request.durationSeconds,
    quality: request.quality,
  });

  const definition = productionModeDefault(request.mode);

  // Clips are budgeted per CONTENT ITEM, not per variant. Recomposing a 9:16
  // item to 4:5 reuses the generated footage — that reuse is the entire reason
  // format adaptation is cheap, and pricing clips per variant would erase it.
  //
  // The baseline count is the mode's MINIMUM, not the midpoint of its range.
  // Each mode's target cost band is calibrated against its baseline
  // composition: Fast at zero clips is stills plus editor motion, which is what
  // makes €0.20–0.60 achievable at all. Using the midpoint put a 90-cent
  // generated clip into every Fast reel and pushed all three modes out of their
  // bands — the margin test in estimator.test.ts is what caught it. Clips above
  // the baseline are the user opting to spend more, and are reserved separately
  // against `regenerationAllowance`.
  const aiVideoClips = counts.contentItems * definition.aiVideoClipsMin;
  const generatedImages = counts.contentItems * definition.generatedImagesTypical;
  const musicTracks = request.withMusic ? counts.contentItems : 0;

  // An export is a re-encode of an existing composition at another size, not a
  // fresh render. Counted separately so the estimate does not charge render
  // prices for transcodes.
  const platformExports = counts.variants;

  return {
    ...counts,
    aiVideoClips,
    generatedImages,
    musicTracks,
    platformExports,
  };
}

/**
 * Per-unit internal cost in cents, by production mode.
 *
 * These are the DEFAULTS. The brief requires them to be editable without a
 * deploy, so `cost_configuration` overrides them at runtime and anything
 * pricing a real generation must read that table. Kept here so the estimator
 * works before the table is seeded and so the values are testable in isolation.
 *
 * Calibrated against each mode's target cost band in modes.ts — the test suite
 * asserts a typical single reel lands inside its band, which is what stops a
 * casual edit here from quietly destroying the margin.
 */
const UNIT_CENTS: Readonly<Record<ProductionMode, Readonly<Record<string, number>>>> = {
  fast: { script: 1, storyboard: 1, image: 2, videoClip: 90, voiceover: 3, music: 4, thumbnail: 1, render: 4, export: 1 },
  hybrid: { script: 2, storyboard: 2, image: 5, videoClip: 95, voiceover: 6, music: 8, thumbnail: 2, render: 10, export: 2 },
  cinematic: { script: 4, storyboard: 4, image: 9, videoClip: 140, voiceover: 12, music: 12, thumbnail: 4, render: 25, export: 4 },
};

export function estimateBatch(request: EstimateRequest): ModeEstimate {
  const work = computeWork(request);
  const prices = UNIT_CENTS[request.mode];

  // Render cost scales with duration: a 60s video is not the same work as a 10s
  // one. Rounded up per unit so the estimate is never optimistic.
  const renderCents = Math.ceil((prices.render ?? 0) * Math.max(1, request.durationSeconds / 15));

  const rows: { stage: string; units: number; cents: number }[] = [
    { stage: "Scripts", units: work.scripts, cents: work.scripts * (prices.script ?? 0) },
    { stage: "Storyboards", units: work.storyboards, cents: work.storyboards * (prices.storyboard ?? 0) },
    { stage: "Generated images", units: work.generatedImages, cents: work.generatedImages * (prices.image ?? 0) },
    { stage: "AI video clips", units: work.aiVideoClips, cents: work.aiVideoClips * (prices.videoClip ?? 0) },
    { stage: "Voiceovers", units: work.voiceovers, cents: work.voiceovers * (prices.voiceover ?? 0) },
    { stage: "Music", units: work.musicTracks, cents: work.musicTracks * (prices.music ?? 0) },
    { stage: "Thumbnails", units: work.thumbnails, cents: work.thumbnails * (prices.thumbnail ?? 0) },
    { stage: "Compositions", units: work.renders, cents: work.renders * renderCents },
    { stage: "Platform exports", units: work.platformExports, cents: work.platformExports * (prices.export ?? 0) },
  ];

  // Publishing is absent on purpose: it is an API call to a platform with no
  // provider bill behind it, and charging credits for it would be charging for
  // nothing.
  const nonZero = rows.filter((row) => row.units > 0);
  const internalCents = nonZero.reduce((sum, row) => sum + row.cents, 0);

  return {
    mode: request.mode,
    work,
    breakdown: nonZero.map((row) => ({
      stage: row.stage,
      units: row.units,
      credits: centsToCredits(row.cents),
    })),
    credits: centsToCredits(internalCents),
    internalCents,
  };
}

/** Estimates the same request under every mode, for the mode selector. */
export function estimateAllModes(
  request: Omit<EstimateRequest, "mode">,
): readonly ModeEstimate[] {
  return PRODUCTION_MODE_DEFAULTS.map((definition) =>
    estimateBatch({ ...request, mode: definition.id }),
  );
}

/** Compares an estimate against a balance, for the pre-generation confirmation. */
export function compareToBalance(estimate: ModeEstimate, available: number): BalanceComparison {
  const balanceAfter = available - estimate.credits;
  return {
    estimate,
    available,
    balanceAfter,
    affordable: balanceAfter >= 0,
    // Zero when affordable, so the UI can render "you need N more" without a
    // negative number that reads as a balance.
    shortfall: balanceAfter >= 0 ? 0 : -balanceAfter,
  };
}

/**
 * The staged execution gates.
 *
 * Each stage is separately runnable and separately priced, so a user can stop
 * after any of them. `plan` is the default because it is nearly free and
 * because the expensive stages should never be the thing that runs by accident.
 */
export const GENERATION_GATES = [
  {
    id: "plan",
    label: "Generate campaign plan only",
    produces: "Strategy, concepts and hooks",
    /** Fraction of the full estimate this gate spends, in percent. */
    shareOfCostPercent: 2,
  },
  { id: "scripts", label: "Generate concepts and scripts", produces: "A timed script per item", shareOfCostPercent: 5 },
  { id: "storyboards", label: "Generate storyboards", produces: "Shot lists and visual prompts", shareOfCostPercent: 8 },
  { id: "preview", label: "Generate preview assets", produces: "One still per shot, no video", shareOfCostPercent: 20 },
  { id: "media", label: "Generate final media", produces: "Every clip, voiceover and track", shareOfCostPercent: 85 },
  { id: "render", label: "Render complete batch", produces: "Finished, validated exports", shareOfCostPercent: 100 },
] as const;

export type GenerationGateId = (typeof GENERATION_GATES)[number]["id"];

/** The safe default the brief mandates. */
export const DEFAULT_GATE: GenerationGateId = "plan";

/**
 * Credits a single gate spends.
 *
 * A share of the full estimate rather than a separate price table, because the
 * gates are cumulative prefixes of the same pipeline and two tables would drift
 * apart. Rounded up so a gate never under-quotes.
 */
export function creditsForGate(estimate: ModeEstimate, gate: GenerationGateId): number {
  const definition = GENERATION_GATES.find((entry) => entry.id === gate);
  if (!definition) throw new Error(`Unknown generation gate "${gate}".`);
  return Math.ceil((estimate.credits * definition.shareOfCostPercent) / 100);
}

/** Above this many variants, the UI must demand explicit confirmation. */
export const CONFIRMATION_THRESHOLD_VARIANTS = 25;

export function requiresConfirmation(work: EstimateWork): boolean {
  return work.variants >= CONFIRMATION_THRESHOLD_VARIANTS;
}

/**
 * The sentence shown before an expensive batch runs.
 *
 * States job counts, credit cost and what happens to unused credits. It does
 * not promise reach, performance or completion time — none of which are known.
 */
export function confirmationSummary(estimate: ModeEstimate, available: number): string {
  const { work } = estimate;
  const parts = [
    `This will create ${work.totalJobs.toLocaleString("en-US")} jobs, including ${work.aiVideoClips.toLocaleString("en-US")} AI video clips and ${work.renders.toLocaleString("en-US")} compositions.`,
    `${estimate.credits.toLocaleString("en-US")} Production Credits will be reserved before anything runs, leaving ${(available - estimate.credits).toLocaleString("en-US")}.`,
    "Unused credits are returned automatically when the batch finishes.",
  ];
  if (work.publishJobs > 0) {
    parts.splice(
      1,
      0,
      `It will also create ${work.publishJobs.toLocaleString("en-US")} publishing jobs, which cost no credits.`,
    );
  }
  return parts.join(" ");
}
