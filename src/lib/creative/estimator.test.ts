/**
 * @vitest-environment node
 *
 * Pure arithmetic — no database, no provider. These are the numbers a user is
 * shown before they commit and the numbers the server reserves against, so the
 * properties asserted here are the ones that turn into money.
 */
import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_THRESHOLD_VARIANTS,
  DEFAULT_GATE,
  GENERATION_GATES,
  compareToBalance,
  computeWork,
  confirmationSummary,
  creditsForGate,
  estimateAllModes,
  estimateBatch,
  requiresConfirmation,
  type EstimateRequest,
} from "./estimator";
import { CENTS_PER_PRODUCTION_CREDIT, productionModeDefault } from "./modes";
import { PLAN_DEFAULTS, formatPlanPrice, planCapacity } from "./plans";
import type { ProductionMode } from "./types";

function request(overrides: Partial<EstimateRequest> = {}): EstimateRequest {
  return {
    mode: "fast",
    concepts: 1,
    hooksPerConcept: 1,
    platforms: ["instagram"],
    ratios: ["9:16"],
    languages: ["en"],
    accountCount: 0,
    withVoiceover: true,
    withThumbnail: false,
    withMusic: true,
    durationSeconds: 20,
    quality: "standard",
    ...overrides,
  };
}

const MODES: readonly ProductionMode[] = ["fast", "hybrid", "cinematic"];

describe("work counting", () => {
  it("scales AI clips by content item, not by variant", () => {
    // Recomposing 9:16 to 4:5 reuses the generated footage. Pricing clips per
    // variant would erase the entire reason format adaptation is cheap.
    const oneFormat = computeWork(request({ mode: "hybrid", ratios: ["9:16"] }));
    const threeFormats = computeWork(
      request({ mode: "hybrid", ratios: ["9:16", "4:5", "1:1"] }),
    );

    expect(threeFormats.variants).toBe(oneFormat.variants * 3);
    expect(threeFormats.aiVideoClips).toBe(oneFormat.aiVideoClips);
  });

  it("gives Fast fewer clips than Cinematic for the same batch", () => {
    const fast = computeWork(request({ mode: "fast" }));
    const cinematic = computeWork(request({ mode: "cinematic" }));
    expect(fast.aiVideoClips).toBeLessThan(cinematic.aiVideoClips);
  });

  it("omits music entirely when it was not asked for", () => {
    expect(computeWork(request({ withMusic: false })).musicTracks).toBe(0);
  });

  it("does not multiply renders by account count", () => {
    // Routing one variant to twelve accounts is twelve publishing jobs, not
    // twelve renders. Conflating them turns a small batch into a large bill.
    const none = computeWork(request({ accountCount: 0 }));
    const twelve = computeWork(request({ accountCount: 12 }));

    expect(twelve.renders).toBe(none.renders);
    expect(twelve.publishJobs).toBe(none.variants * 12);
  });
});

describe("cost estimation", () => {
  it("prices the modes in ascending order for an identical batch", () => {
    const [fast, hybrid, cinematic] = MODES.map(
      (mode) => estimateBatch(request({ mode })).credits,
    );
    expect(fast).toBeLessThan(hybrid!);
    expect(hybrid).toBeLessThan(cinematic!);
  });

  it("keeps a single reel inside its mode's target cost band", () => {
    // The margin guard. If a mode's per-reel cost drifts out of the band the
    // plan prices were built from, the product loses money on every reel and
    // nothing else in the system notices.
    for (const mode of MODES) {
      const definition = productionModeDefault(mode);
      const single = estimateBatch(request({ mode }));
      expect(single.internalCents).toBeLessThanOrEqual(definition.targetCostCentsHigh);
    }
  });

  it("never charges credits for publishing", () => {
    // Publishing is an API call to a platform with no provider bill behind it.
    const withAccounts = estimateBatch(request({ accountCount: 50 }));
    const without = estimateBatch(request({ accountCount: 0 }));

    expect(withAccounts.credits).toBe(without.credits);
    expect(withAccounts.breakdown.some((row) => /publish/i.test(row.stage))).toBe(false);
  });

  it("returns only integers", () => {
    const estimate = estimateBatch(request({ concepts: 7, hooksPerConcept: 3, durationSeconds: 37 }));
    expect(Number.isInteger(estimate.credits)).toBe(true);
    expect(Number.isInteger(estimate.internalCents)).toBe(true);
    for (const row of estimate.breakdown) {
      expect(Number.isInteger(row.credits)).toBe(true);
      expect(Number.isInteger(row.units)).toBe(true);
    }
  });

  it("omits zero-unit stages rather than listing them at zero", () => {
    const estimate = estimateBatch(request({ withVoiceover: false, withMusic: false }));
    expect(estimate.breakdown.every((row) => row.units > 0)).toBe(true);
    expect(estimate.breakdown.some((row) => row.stage === "Voiceovers")).toBe(false);
  });

  it("grows with the batch", () => {
    const small = estimateBatch(request({ concepts: 1 }));
    const large = estimateBatch(request({ concepts: 20 }));
    expect(large.credits).toBeGreaterThan(small.credits);
  });

  it("prices every mode for the selector", () => {
    const all = estimateAllModes(request());
    expect(all).toHaveLength(3);
    expect(all.map((estimate) => estimate.mode)).toEqual(["fast", "hybrid", "cinematic"]);
  });
});

describe("balance comparison", () => {
  it("reports a shortfall as a positive number, not a negative balance", () => {
    const estimate = estimateBatch(request({ mode: "cinematic", concepts: 20 }));
    const comparison = compareToBalance(estimate, 0);

    expect(comparison.affordable).toBe(false);
    expect(comparison.shortfall).toBeGreaterThan(0);
    expect(comparison.shortfall).toBe(estimate.credits);
  });

  it("treats exactly-enough as affordable", () => {
    // An off-by-one here blocks a user who can precisely afford their batch.
    const estimate = estimateBatch(request());
    const comparison = compareToBalance(estimate, estimate.credits);

    expect(comparison.affordable).toBe(true);
    expect(comparison.balanceAfter).toBe(0);
    expect(comparison.shortfall).toBe(0);
  });
});

describe("generation gates", () => {
  it("defaults to plan-only, the cheapest gate", () => {
    expect(DEFAULT_GATE).toBe("plan");
    const cheapest = [...GENERATION_GATES].sort(
      (a, b) => a.shareOfCostPercent - b.shareOfCostPercent,
    )[0];
    expect(cheapest?.id).toBe("plan");
  });

  it("charges progressively more for later gates", () => {
    const estimate = estimateBatch(request({ mode: "cinematic", concepts: 10 }));
    const costs = GENERATION_GATES.map((gate) => creditsForGate(estimate, gate.id));

    for (let i = 1; i < costs.length; i += 1) {
      expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]!);
    }
  });

  it("charges the full estimate only at the final gate", () => {
    const estimate = estimateBatch(request({ concepts: 5 }));
    expect(creditsForGate(estimate, "render")).toBe(estimate.credits);
    expect(creditsForGate(estimate, "plan")).toBeLessThan(estimate.credits);
  });

  it("rejects an unknown gate rather than defaulting to a price", () => {
    const estimate = estimateBatch(request());
    // @ts-expect-error — deliberately outside the union, to prove a crafted
    // form body cannot silently select a cost.
    expect(() => creditsForGate(estimate, "free")).toThrow();
  });
});

describe("confirmation gate", () => {
  it("demands confirmation above the variant threshold", () => {
    const below = computeWork(request({ concepts: 1, hooksPerConcept: 1 }));
    expect(requiresConfirmation(below)).toBe(false);

    const above = computeWork(request({ concepts: 20, hooksPerConcept: 3 }));
    expect(above.variants).toBeGreaterThanOrEqual(CONFIRMATION_THRESHOLD_VARIANTS);
    expect(requiresConfirmation(above)).toBe(true);
  });

  it("states counts, cost and the refund rule, and promises nothing else", () => {
    const estimate = estimateBatch(request({ concepts: 10, accountCount: 3 }));
    const summary = confirmationSummary(estimate, 1000);

    expect(summary).toContain("Production Credits will be reserved");
    expect(summary).toContain("returned automatically");
    expect(summary).toContain("publishing jobs, which cost no credits");
    // No promises about reach, performance or completion time.
    expect(summary).not.toMatch(/viral|reach|guarantee|minutes/i);
  });
});

describe("plans", () => {
  it("prices Network as contact-sales, never as free", () => {
    const network = PLAN_DEFAULTS.find((plan) => plan.code === "network");
    expect(network?.priceCents).toBeNull();
    expect(network?.requiresContact).toBe(true);
    expect(formatPlanPrice(null)).toBe("Custom");
    expect(formatPlanPrice(null)).not.toContain("0");
  });

  it("gives every listed plan a real price", () => {
    for (const plan of PLAN_DEFAULTS.filter((entry) => !entry.requiresContact)) {
      expect(plan.priceCents).toBeGreaterThan(0);
    }
  });

  it("emphasises exactly one plan", () => {
    expect(PLAN_DEFAULTS.filter((plan) => plan.emphasised)).toHaveLength(1);
    expect(PLAN_DEFAULTS.find((plan) => plan.emphasised)?.code).toBe("growth");
  });

  it("computes capacity from mode prices rather than hardcoded copy", () => {
    const modeCredits = {
      fast: productionModeDefault("fast").productionCredits,
      hybrid: productionModeDefault("hybrid").productionCredits,
      cinematic: productionModeDefault("cinematic").productionCredits,
    };

    // The brief's stated capacities, which must follow from the prices rather
    // than being asserted independently of them.
    expect(planCapacity(60, modeCredits)).toEqual({
      fastReels: 60,
      hybridReels: 10,
      cinematicReels: 2,
    });
    expect(planCapacity(220, modeCredits)).toEqual({
      fastReels: 220,
      hybridReels: 36,
      cinematicReels: 9,
    });
    expect(planCapacity(750, modeCredits)).toEqual({
      fastReels: 750,
      hybridReels: 125,
      cinematicReels: 31,
    });
  });

  it("never coalesces an unlimited entitlement to zero", () => {
    // A null limit means unlimited. Reading it as 0 inverts the meaning and
    // turns the most generous plan into the most restricted one.
    const agency = PLAN_DEFAULTS.find((plan) => plan.code === "agency");
    const brands = agency?.entitlements.find((entry) => entry.key === "brands");
    expect(brands?.limitValue).toBeNull();
    expect(brands?.enabled).toBe(true);
  });

  it("prices each plan's credits above the cost of what they buy", () => {
    for (const plan of PLAN_DEFAULTS.filter((entry) => entry.priceCents !== null)) {
      const creditCostCents = plan.includedCredits * CENTS_PER_PRODUCTION_CREDIT;
      expect(plan.priceCents!).toBeGreaterThan(creditCostCents * 0.5);
    }
  });
});
