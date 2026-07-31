import type { AspectRatio, Platform } from "@/types/database";

/**
 * Batch planning arithmetic.
 *
 * This module answers "what exactly will this request create, and what will it
 * cost?" before anything runs. It is pure and exhaustively tested because the
 * numbers it produces are the ones a user sees in a confirmation dialog — a wrong
 * count here either surprises someone with a bill or silently under-generates.
 *
 * All money is integer cents. All durations are integer milliseconds. No floats
 * anywhere in the accumulation path: adding 0.07 three thousand times does not
 * produce 210.
 */

export type PlanRequest = {
  concepts: number;
  hooksPerConcept: number;
  platforms: readonly Platform[];
  ratios: readonly AspectRatio[];
  languages: readonly string[];
  /** Authorised accounts the output will be routed to. */
  accountCount: number;
  /** Whether each variant needs its own voiceover. */
  withVoiceover: boolean;
  /** Whether each variant needs a generated thumbnail. */
  withThumbnail: boolean;
  /** Target duration per video, used for render-minute estimates. */
  durationSeconds: number;
  quality: Quality;
};

export type Quality = "draft" | "standard" | "high";

export type PlanCounts = {
  concepts: number;
  hooks: number;
  /** One content item per concept×hook×language — the editable unit. */
  contentItems: number;
  /** One variant per item×platform×ratio — the publishable unit. */
  variants: number;
  scripts: number;
  storyboards: number;
  images: number;
  videos: number;
  voiceovers: number;
  thumbnails: number;
  renders: number;
  /** Publishing jobs, which multiply by account rather than by format. */
  publishJobs: number;
  totalJobs: number;
};

export type CostEstimate = {
  counts: PlanCounts;
  /** Per-stage breakdown in cents, so the UI can show where the money goes. */
  breakdown: readonly { stage: string; units: number; cents: number }[];
  totalCents: number;
  credits: number;
  /**
   * Null unless the provider supplies real throughput data.
   *
   * The brief allows a processing-time range "only when based on real provider
   * data". A mock provider has no throughput, so this stays null and the UI must
   * omit the estimate rather than inventing one.
   */
  estimatedMinutes: { low: number; high: number } | null;
};

/** Guard rails. A request beyond these is refused rather than truncated silently. */
export const PLAN_LIMITS = {
  maxConcepts: 100,
  maxHooksPerConcept: 10,
  maxLanguages: 20,
  maxAccounts: 500,
  /** Above this, the UI must require explicit confirmation. */
  confirmationThresholdVariants: 25,
  /** Hard ceiling on a single batch, to bound blast radius. */
  maxVariants: 5000,
} as const;

/**
 * Unit prices in cents.
 *
 * These are the product's own credit prices, NOT provider costs — provider cost is
 * recorded per run in `generation_runs.cost_cents` from the provider's response.
 * Presenting an estimate as though it were the measured provider bill would be a
 * fabricated number.
 */
const UNIT_CENTS: Readonly<Record<Quality, Readonly<Record<string, number>>>> = {
  draft: { script: 1, storyboard: 1, image: 2, video: 20, voiceover: 3, thumbnail: 1, render: 4 },
  standard: { script: 2, storyboard: 2, image: 5, video: 60, voiceover: 6, thumbnail: 2, render: 10 },
  high: { script: 4, storyboard: 4, image: 12, video: 180, voiceover: 12, thumbnail: 4, render: 25 },
};

/** One credit is one cent of list price. Kept explicit so it can diverge later. */
const CENTS_PER_CREDIT = 1;

export type PlanError = {
  field: keyof PlanRequest;
  message: string;
};

/** Validates a request. Returns every problem, not just the first. */
export function validatePlanRequest(request: PlanRequest): readonly PlanError[] {
  const errors: PlanError[] = [];

  if (!Number.isInteger(request.concepts) || request.concepts < 1) {
    errors.push({ field: "concepts", message: "At least one concept is required." });
  } else if (request.concepts > PLAN_LIMITS.maxConcepts) {
    errors.push({
      field: "concepts",
      message: `A single request is limited to ${PLAN_LIMITS.maxConcepts} concepts. Split it into several campaigns.`,
    });
  }

  if (!Number.isInteger(request.hooksPerConcept) || request.hooksPerConcept < 1) {
    errors.push({ field: "hooksPerConcept", message: "At least one hook per concept is required." });
  } else if (request.hooksPerConcept > PLAN_LIMITS.maxHooksPerConcept) {
    errors.push({
      field: "hooksPerConcept",
      message: `A concept is limited to ${PLAN_LIMITS.maxHooksPerConcept} hook variants.`,
    });
  }

  if (request.platforms.length === 0) {
    errors.push({ field: "platforms", message: "Select at least one platform." });
  }
  if (request.ratios.length === 0) {
    errors.push({ field: "ratios", message: "Select at least one aspect ratio." });
  }
  if (request.languages.length === 0) {
    errors.push({ field: "languages", message: "Select at least one language." });
  } else if (request.languages.length > PLAN_LIMITS.maxLanguages) {
    errors.push({ field: "languages", message: `Limited to ${PLAN_LIMITS.maxLanguages} languages.` });
  }

  if (!Number.isInteger(request.accountCount) || request.accountCount < 0) {
    errors.push({ field: "accountCount", message: "Account count cannot be negative." });
  } else if (request.accountCount > PLAN_LIMITS.maxAccounts) {
    errors.push({ field: "accountCount", message: `Limited to ${PLAN_LIMITS.maxAccounts} accounts.` });
  }

  if (!Number.isFinite(request.durationSeconds) || request.durationSeconds <= 0) {
    errors.push({ field: "durationSeconds", message: "Duration must be greater than zero." });
  }

  // Only meaningful once the individual dimensions are valid; otherwise the
  // product of garbage produces a confusing second error.
  if (errors.length === 0) {
    const { variants } = computeCounts(request);
    if (variants > PLAN_LIMITS.maxVariants) {
      errors.push({
        field: "concepts",
        message: `This combination produces ${variants.toLocaleString("en-US")} variants, above the ${PLAN_LIMITS.maxVariants.toLocaleString("en-US")} limit for one request. Reduce concepts, formats or languages.`,
      });
    }
  }

  return errors;
}

/**
 * The multiplication.
 *
 * `contentItems = concepts × hooks × languages` — a hook in another language is a
 * different script, so it is a different editable item.
 *
 * `variants = contentItems × platforms × ratios` — the same item recomposed. Note
 * that accounts do NOT multiply variants: routing one variant to twelve accounts
 * creates twelve publishing jobs, not twelve renders. Conflating the two is the
 * mistake that turns "100 videos to 12 accounts" into 1,200 renders and a bill
 * nobody agreed to.
 */
export function computeCounts(request: PlanRequest): PlanCounts {
  const concepts = Math.max(0, Math.trunc(request.concepts));
  const hooks = concepts * Math.max(0, Math.trunc(request.hooksPerConcept));
  const languages = Math.max(0, request.languages.length);

  const contentItems = hooks * languages;
  const variants = contentItems * request.platforms.length * request.ratios.length;

  // Scripts and storyboards belong to the item, not the variant: recomposing 9:16
  // to 4:5 reuses the script. This is the whole reason format adaptation is cheap.
  const scripts = contentItems;
  const storyboards = contentItems;

  // One generated establishing image per storyboard, plus one per variant that
  // needs a distinct first frame.
  const images = contentItems;
  const videos = variants;
  const voiceovers = request.withVoiceover ? contentItems : 0;
  const thumbnails = request.withThumbnail ? variants : 0;
  const renders = variants;

  const publishJobs = variants * Math.max(0, Math.trunc(request.accountCount));

  const totalJobs =
    scripts + storyboards + images + videos + voiceovers + thumbnails + renders + publishJobs;

  return {
    concepts,
    hooks,
    contentItems,
    variants,
    scripts,
    storyboards,
    images,
    videos,
    voiceovers,
    thumbnails,
    renders,
    publishJobs,
    totalJobs,
  };
}

export function estimateCost(
  request: PlanRequest,
  options: { providerThroughput?: ProviderThroughput | null } = {},
): CostEstimate {
  const counts = computeCounts(request);
  const prices = UNIT_CENTS[request.quality];

  // Render price scales with duration: a 60-second video is not the same work as a
  // 10-second one. Rounded up per unit so the estimate is never optimistic.
  const renderUnitCents = Math.ceil(
    (prices.render ?? 0) * Math.max(1, request.durationSeconds / 15),
  );
  const videoUnitCents = Math.ceil(
    (prices.video ?? 0) * Math.max(1, request.durationSeconds / 15),
  );

  const rows: { stage: string; units: number; cents: number }[] = [
    { stage: "Scripts", units: counts.scripts, cents: counts.scripts * (prices.script ?? 0) },
    { stage: "Storyboards", units: counts.storyboards, cents: counts.storyboards * (prices.storyboard ?? 0) },
    { stage: "Images", units: counts.images, cents: counts.images * (prices.image ?? 0) },
    { stage: "Video generation", units: counts.videos, cents: counts.videos * videoUnitCents },
    { stage: "Voiceovers", units: counts.voiceovers, cents: counts.voiceovers * (prices.voiceover ?? 0) },
    { stage: "Thumbnails", units: counts.thumbnails, cents: counts.thumbnails * (prices.thumbnail ?? 0) },
    { stage: "Rendering", units: counts.renders, cents: counts.renders * renderUnitCents },
  ];

  // Publishing costs no credits — it is an API call to a platform, and charging for
  // it would be charging for something with no provider bill behind it.
  const breakdown = rows.filter((row) => row.units > 0);
  const totalCents = breakdown.reduce((sum, row) => sum + row.cents, 0);

  return {
    counts,
    breakdown,
    totalCents,
    credits: Math.ceil(totalCents / CENTS_PER_CREDIT),
    estimatedMinutes: options.providerThroughput
      ? estimateMinutes(counts, options.providerThroughput)
      : null,
  };
}

/** Measured provider throughput. Absent for the mock provider, by design. */
export type ProviderThroughput = {
  /** Median seconds to generate one video, from observed runs. */
  videoSecondsP50: number;
  videoSecondsP90: number;
  /** How many jobs the worker pool runs at once. */
  concurrency: number;
};

function estimateMinutes(
  counts: PlanCounts,
  throughput: ProviderThroughput,
): { low: number; high: number } {
  const concurrency = Math.max(1, Math.trunc(throughput.concurrency));
  const waves = Math.ceil(counts.videos / concurrency);
  return {
    low: Math.max(1, Math.ceil((waves * throughput.videoSecondsP50) / 60)),
    high: Math.max(1, Math.ceil((waves * throughput.videoSecondsP90) / 60)),
  };
}

/** True when the batch is large enough to demand an explicit confirmation step. */
export function requiresConfirmation(counts: PlanCounts): boolean {
  return counts.variants >= PLAN_LIMITS.confirmationThresholdVariants;
}

/**
 * What the user is shown before an expensive batch runs.
 *
 * Deliberately does not promise reach or performance — it states job counts, credit
 * cost and the review recommendation, which are the three facts that matter.
 */
export function confirmationSummary(counts: PlanCounts, estimate: CostEstimate): string {
  const parts = [
    `This operation will create ${counts.totalJobs.toLocaleString("en-US")} jobs, including ${counts.videos.toLocaleString("en-US")} video generations and ${counts.renders.toLocaleString("en-US")} renders.`,
    `Estimated cost is ${formatCents(estimate.totalCents)} in generation credits.`,
    "Jobs run in controlled batches. Review concepts before rendering to avoid unnecessary cost.",
  ];
  if (counts.publishJobs > 0) {
    parts.splice(
      1,
      0,
      `It will also create ${counts.publishJobs.toLocaleString("en-US")} publishing jobs across your selected accounts.`,
    );
  }
  return parts.join(" ");
}

export function formatCents(cents: number): string {
  const safe = Math.max(0, Math.trunc(cents));
  return `$${(safe / 100).toFixed(2)}`;
}

/**
 * The staged execution order lives in `src/lib/creative/estimator.ts` as
 * `GENERATION_GATES`, not here.
 *
 * It moved because a gate now has to know what fraction of the estimate it
 * spends, which is what the credit reservation is sized from. Two lists — one
 * naming the stages and one pricing them — drifted the moment they disagreed on
 * an id ("script" against "scripts"), and the consequence was a batch reserving
 * plan-level credits for a full render.
 */
