import { describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  computeCounts,
  confirmationSummary,
  estimateCost,
  formatCents,
  requiresConfirmation,
  validatePlanRequest,
  type PlanRequest,
} from "./plan";

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    concepts: 1,
    hooksPerConcept: 1,
    platforms: ["instagram"],
    ratios: ["9:16"],
    languages: ["en"],
    accountCount: 1,
    withVoiceover: false,
    withThumbnail: false,
    durationSeconds: 15,
    quality: "standard",
    ...overrides,
  };
}

describe("computeCounts", () => {
  it("computes the trivial case", () => {
    const counts = computeCounts(request());
    expect(counts.contentItems).toBe(1);
    expect(counts.variants).toBe(1);
  });

  it("multiplies concepts by hooks by languages for content items", () => {
    const counts = computeCounts(
      request({ concepts: 20, hooksPerConcept: 5, languages: ["en", "es"] }),
    );
    // A hook in another language is a different script, so a different item.
    expect(counts.hooks).toBe(100);
    expect(counts.contentItems).toBe(200);
  });

  it("multiplies items by platforms by ratios for variants", () => {
    const counts = computeCounts(
      request({
        concepts: 20,
        hooksPerConcept: 3,
        platforms: ["instagram", "tiktok", "youtube"],
        ratios: ["9:16"],
      }),
    );
    expect(counts.contentItems).toBe(60);
    expect(counts.variants).toBe(180);
  });

  it("does NOT multiply renders by account count", () => {
    // The regression this guards: routing one variant to many accounts must create
    // publishing jobs, not additional renders. Getting this wrong turns
    // "100 videos to 12 accounts" into 1,200 renders and a bill nobody agreed to.
    const one = computeCounts(request({ concepts: 10, accountCount: 1 }));
    const twelve = computeCounts(request({ concepts: 10, accountCount: 12 }));

    expect(twelve.variants).toBe(one.variants);
    expect(twelve.renders).toBe(one.renders);
    expect(twelve.videos).toBe(one.videos);
    expect(twelve.publishJobs).toBe(one.publishJobs * 12);
  });

  it("keeps scripts and storyboards per item, not per variant", () => {
    // This is what makes format adaptation cheap: a 4:5 cut reuses the 9:16 script.
    const counts = computeCounts(
      request({ concepts: 5, ratios: ["9:16", "4:5", "1:1", "16:9"] }),
    );
    expect(counts.contentItems).toBe(5);
    expect(counts.scripts).toBe(5);
    expect(counts.storyboards).toBe(5);
    expect(counts.variants).toBe(20);
  });

  it("adds voiceovers per item and thumbnails per variant", () => {
    const counts = computeCounts(
      request({
        concepts: 4,
        ratios: ["9:16", "1:1"],
        withVoiceover: true,
        withThumbnail: true,
      }),
    );
    // One voiceover serves every ratio of the same item; a thumbnail does not.
    expect(counts.voiceovers).toBe(4);
    expect(counts.thumbnails).toBe(8);
  });

  it("omits voiceovers and thumbnails when not requested", () => {
    const counts = computeCounts(request({ withVoiceover: false, withThumbnail: false }));
    expect(counts.voiceovers).toBe(0);
    expect(counts.thumbnails).toBe(0);
  });

  it("handles the brief's headline scenario", () => {
    // "100 videos, 20 concepts, 5 hooks per concept, 4 platforms."
    const counts = computeCounts(
      request({
        concepts: 20,
        hooksPerConcept: 5,
        platforms: ["instagram", "tiktok", "youtube", "facebook"],
        ratios: ["9:16"],
        accountCount: 4,
      }),
    );
    expect(counts.contentItems).toBe(100);
    expect(counts.variants).toBe(400);
    expect(counts.publishJobs).toBe(1600);
  });

  it("truncates fractional input rather than producing fractional jobs", () => {
    const counts = computeCounts(request({ concepts: 3.7, hooksPerConcept: 2.9 }));
    expect(Number.isInteger(counts.contentItems)).toBe(true);
    expect(counts.contentItems).toBe(6);
  });
});

describe("validatePlanRequest", () => {
  it("accepts a valid request", () => {
    expect(validatePlanRequest(request())).toEqual([]);
  });

  it("rejects zero or fractional concepts", () => {
    expect(validatePlanRequest(request({ concepts: 0 }))).toHaveLength(1);
    expect(validatePlanRequest(request({ concepts: -1 }))).toHaveLength(1);
    expect(validatePlanRequest(request({ concepts: 1.5 }))).toHaveLength(1);
  });

  it("rejects empty platform, ratio and language selections", () => {
    expect(validatePlanRequest(request({ platforms: [] }))[0]?.field).toBe("platforms");
    expect(validatePlanRequest(request({ ratios: [] }))[0]?.field).toBe("ratios");
    expect(validatePlanRequest(request({ languages: [] }))[0]?.field).toBe("languages");
  });

  it("reports every problem at once, not just the first", () => {
    // A form that surfaces one error per submit makes a six-field mistake into six
    // round-trips.
    const errors = validatePlanRequest(request({ concepts: 0, platforms: [], ratios: [] }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("enforces the per-request ceilings", () => {
    expect(validatePlanRequest(request({ concepts: PLAN_LIMITS.maxConcepts + 1 }))).toHaveLength(1);
    expect(
      validatePlanRequest(request({ hooksPerConcept: PLAN_LIMITS.maxHooksPerConcept + 1 })),
    ).toHaveLength(1);
  });

  it("refuses a combination that exceeds the variant ceiling", () => {
    const errors = validatePlanRequest(
      request({
        concepts: 100,
        hooksPerConcept: 10,
        platforms: ["instagram", "tiktok", "youtube", "facebook"],
        ratios: ["9:16", "4:5", "1:1"],
        languages: ["en", "es", "fr"],
      }),
    );
    expect(errors).toHaveLength(1);
    // The message must state the real number so the user knows how far over it is.
    expect(errors[0]?.message).toMatch(/variants/);
    expect(errors[0]?.message).toMatch(/36,000|\d{2},\d{3}/);
  });

  it("does not pile a ceiling error on top of invalid dimensions", () => {
    const errors = validatePlanRequest(request({ concepts: 0, hooksPerConcept: 0 }));
    expect(errors.every((error) => !error.message.includes("variants"))).toBe(true);
  });

  it("rejects non-positive duration", () => {
    expect(validatePlanRequest(request({ durationSeconds: 0 }))).toHaveLength(1);
    expect(validatePlanRequest(request({ durationSeconds: Number.NaN }))).toHaveLength(1);
  });

  it("allows zero accounts — generating without publishing is legitimate", () => {
    expect(validatePlanRequest(request({ accountCount: 0 }))).toEqual([]);
  });
});

describe("estimateCost", () => {
  it("returns integer cents only", () => {
    const estimate = estimateCost(request({ concepts: 7, durationSeconds: 37 }));
    expect(Number.isInteger(estimate.totalCents)).toBe(true);
    for (const row of estimate.breakdown) {
      expect(Number.isInteger(row.cents)).toBe(true);
    }
  });

  it("scales with quality", () => {
    const draft = estimateCost(request({ concepts: 10, quality: "draft" }));
    const standard = estimateCost(request({ concepts: 10, quality: "standard" }));
    const high = estimateCost(request({ concepts: 10, quality: "high" }));

    expect(draft.totalCents).toBeLessThan(standard.totalCents);
    expect(standard.totalCents).toBeLessThan(high.totalCents);
  });

  it("scales with duration", () => {
    const short = estimateCost(request({ concepts: 5, durationSeconds: 15 }));
    const long = estimateCost(request({ concepts: 5, durationSeconds: 60 }));
    expect(long.totalCents).toBeGreaterThan(short.totalCents);
  });

  it("omits zero-unit stages from the breakdown", () => {
    // A row reading "Voiceovers — 0 — $0.00" is noise in a cost dialog.
    const estimate = estimateCost(request({ withVoiceover: false, withThumbnail: false }));
    expect(estimate.breakdown.some((row) => row.stage === "Voiceovers")).toBe(false);
    expect(estimate.breakdown.every((row) => row.units > 0)).toBe(true);
  });

  it("charges nothing for publishing", () => {
    // Publishing is a platform API call with no provider bill behind it.
    const withAccounts = estimateCost(request({ concepts: 5, accountCount: 20 }));
    const without = estimateCost(request({ concepts: 5, accountCount: 0 }));
    expect(withAccounts.totalCents).toBe(without.totalCents);
  });

  it("returns no time estimate without real provider throughput", () => {
    // The brief permits a duration range only when based on real provider data.
    expect(estimateCost(request()).estimatedMinutes).toBeNull();
    expect(estimateCost(request(), { providerThroughput: null }).estimatedMinutes).toBeNull();
  });

  it("returns a time range when throughput is measured", () => {
    const estimate = estimateCost(request({ concepts: 40 }), {
      providerThroughput: { videoSecondsP50: 30, videoSecondsP90: 90, concurrency: 4 },
    });
    expect(estimate.estimatedMinutes).not.toBeNull();
    expect(estimate.estimatedMinutes?.high).toBeGreaterThanOrEqual(
      estimate.estimatedMinutes?.low ?? 0,
    );
  });

  it("the breakdown sums exactly to the total", () => {
    const estimate = estimateCost(
      request({ concepts: 13, hooksPerConcept: 3, withVoiceover: true, withThumbnail: true }),
    );
    const sum = estimate.breakdown.reduce((total, row) => total + row.cents, 0);
    expect(sum).toBe(estimate.totalCents);
  });
});

describe("requiresConfirmation", () => {
  it("does not demand confirmation for a small batch", () => {
    expect(requiresConfirmation(computeCounts(request({ concepts: 2 })))).toBe(false);
  });

  it("demands confirmation once the batch is large", () => {
    expect(requiresConfirmation(computeCounts(request({ concepts: 100 })))).toBe(true);
  });
});

describe("confirmationSummary", () => {
  const counts = computeCounts(
    request({
      concepts: 20,
      hooksPerConcept: 5,
      platforms: ["instagram", "tiktok", "youtube", "facebook"],
      accountCount: 4,
    }),
  );
  const summary = confirmationSummary(counts, estimateCost(request({ concepts: 20 })));

  it("states the real job and video counts", () => {
    expect(summary).toContain("400");
    expect(summary).toContain("1,600");
  });

  it("recommends reviewing before rendering", () => {
    expect(summary).toMatch(/review concepts before rendering/i);
  });

  it("promises nothing about performance", () => {
    // The honesty constraint: a confirmation dialog is not a sales pitch.
    expect(summary).not.toMatch(/viral|reach|guarantee|growth|engagement/i);
  });
});

describe("formatCents", () => {
  it("formats whole and fractional amounts", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(100000)).toBe("$1000.00");
  });

  it("never renders a negative price", () => {
    expect(formatCents(-500)).toBe("$0.00");
  });
});
