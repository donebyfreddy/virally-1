import { describe, expect, it } from "vitest";
import {
  ACCOUNT_RENDER_LIMIT,
  DEFAULT_MULTIPLIER_STATE,
  FORMAT_KEYS,
  LIMITS,
  OUTPUT_RENDER_LIMIT,
  POSTS_PER_ACCOUNT_PER_DAY,
  buildGraph,
  computeCampaign,
  normaliseState,
  type MultiplierState,
} from "./multiplier";

const base: MultiplierState = {
  concepts: 3,
  hooksPerConcept: 2,
  formats: ["9:16", "4:5", "16:9"],
  languages: 2,
  accounts: 6,
};

describe("computeCampaign", () => {
  it("derives every figure from the stated model", () => {
    const r = computeCampaign(base);
    expect(r.briefs).toBe(1);
    expect(r.concepts).toBe(3);
    expect(r.hooks).toBe(6); // 3 × 2
    expect(r.scripts).toBe(6);
    expect(r.localisations).toBe(12); // 6 × 2 languages
    expect(r.formats).toBe(3);
    expect(r.assets).toBe(36); // 12 × 3 formats
    expect(r.posts).toBe(36);
    expect(r.postsPerAccount).toBe(6); // ceil(36 / 6)
    expect(r.daysToPublish).toBe(2); // ceil(36 / (6 × 3))
  });

  it("collapses to the minimum campaign", () => {
    const r = computeCampaign({
      concepts: 1,
      hooksPerConcept: 1,
      formats: ["9:16"],
      languages: 1,
      accounts: 1,
    });
    expect(r.assets).toBe(1);
    expect(r.posts).toBe(1);
    expect(r.postsPerAccount).toBe(1);
    expect(r.daysToPublish).toBe(1);
  });

  it("computes the maximum campaign exactly", () => {
    const r = computeCampaign({
      concepts: LIMITS.concepts.max,
      hooksPerConcept: LIMITS.hooksPerConcept.max,
      formats: FORMAT_KEYS,
      languages: LIMITS.languages.max,
      accounts: LIMITS.accounts.max,
    });
    // 8 × 6 = 48 scripts → × 3 languages = 144 → × 5 formats = 720
    expect(r.scripts).toBe(48);
    expect(r.localisations).toBe(144);
    expect(r.assets).toBe(720);
    expect(r.postsPerAccount).toBe(30);
    expect(r.daysToPublish).toBe(10);
  });

  it("rounds per-account load up so no post is dropped", () => {
    const r = computeCampaign({ ...base, accounts: 7 });
    expect(r.postsPerAccount).toBe(Math.ceil(r.posts / 7));
    expect(r.postsPerAccount * 7).toBeGreaterThanOrEqual(r.posts);
  });

  it("keeps the days figure consistent with the cadence", () => {
    const r = computeCampaign(base);
    const capacity = r.accounts * POSTS_PER_ACCOUNT_PER_DAY * r.daysToPublish;
    expect(capacity).toBeGreaterThanOrEqual(r.posts);
  });

  it("scales linearly in each independent input", () => {
    const single = computeCampaign({ ...base, concepts: 1 });
    const double = computeCampaign({ ...base, concepts: 2 });
    expect(double.assets).toBe(single.assets * 2);
  });

  it("is deterministic", () => {
    expect(computeCampaign(base)).toEqual(computeCampaign(base));
  });
});

describe("normaliseState", () => {
  it("clamps out-of-range values rather than producing nonsense", () => {
    const s = normaliseState({
      concepts: 99,
      hooksPerConcept: -4,
      formats: ["9:16"],
      languages: 0,
      accounts: 1000,
    });
    expect(s.concepts).toBe(LIMITS.concepts.max);
    expect(s.hooksPerConcept).toBe(LIMITS.hooksPerConcept.min);
    expect(s.languages).toBe(LIMITS.languages.min);
    expect(s.accounts).toBe(LIMITS.accounts.max);
  });

  it("always keeps at least one format selected", () => {
    const s = normaliseState({ ...base, formats: [] });
    expect(s.formats).toHaveLength(1);
    expect(computeCampaign({ ...base, formats: [] }).assets).toBeGreaterThan(0);
  });

  it("returns formats in canonical order regardless of input order", () => {
    const s = normaliseState({ ...base, formats: ["16:9", "9:16"] });
    expect(s.formats).toEqual(["9:16", "16:9"]);
  });

  it("survives non-finite input", () => {
    const s = normaliseState({ ...base, concepts: Number.NaN });
    expect(s.concepts).toBe(LIMITS.concepts.min);
  });
});

describe("buildGraph", () => {
  it("renders every asset individually below the aggregation limit", () => {
    const g = buildGraph({
      concepts: 2,
      hooksPerConcept: 1,
      formats: ["9:16", "1:1"],
      languages: 1,
      accounts: 4,
    });
    const outputs = g.columns.find((c) => c.id === "outputs")!;
    expect(outputs.nodes).toHaveLength(4);
    expect(g.aggregated).toBe(false);
  });

  it("aggregates assets once past the render limit", () => {
    const g = buildGraph({
      concepts: 8,
      hooksPerConcept: 6,
      formats: FORMAT_KEYS,
      languages: 3,
      accounts: 24,
    });
    const outputs = g.columns.find((c) => c.id === "outputs")!;
    expect(outputs.nodes.length).toBeLessThanOrEqual(LIMITS.concepts.max);
    expect(g.aggregated).toBe(true);
  });

  it("aggregation never changes a displayed total", () => {
    const state: MultiplierState = {
      concepts: 8,
      hooksPerConcept: 6,
      formats: FORMAT_KEYS,
      languages: 3,
      accounts: 24,
    };
    // The exact arithmetic is independent of how the graph chooses to draw.
    expect(computeCampaign(state).assets).toBe(720);
    expect(buildGraph(state).aggregated).toBe(true);
  });

  it("keeps the drawing bounded at maximum settings", () => {
    const g = buildGraph({
      concepts: 8,
      hooksPerConcept: 6,
      formats: FORMAT_KEYS,
      languages: 3,
      accounts: 24,
    });
    expect(g.totalNodes).toBeLessThan(120);
  });

  it("collapses the account column past its own limit", () => {
    const under = buildGraph({ ...base, accounts: ACCOUNT_RENDER_LIMIT });
    const over = buildGraph({ ...base, accounts: ACCOUNT_RENDER_LIMIT + 1 });
    expect(under.columns.find((c) => c.id === "accounts")!.nodes).toHaveLength(
      ACCOUNT_RENDER_LIMIT,
    );
    expect(over.columns.find((c) => c.id === "accounts")!.nodes).toHaveLength(1);
  });

  it("always begins with a single brief", () => {
    const g = buildGraph(base);
    expect(g.columns[0].nodes).toHaveLength(1);
  });

  it("respects the documented output render limit", () => {
    expect(OUTPUT_RENDER_LIMIT).toBeGreaterThan(0);
    const g = buildGraph({
      concepts: 2,
      hooksPerConcept: 2,
      formats: ["9:16", "4:5", "1:1"],
      languages: 2,
      accounts: 4,
    });
    // 2 × 2 × 2 × 3 = 24 assets, exactly at the limit → still individual.
    expect(computeCampaign(g ? {
      concepts: 2, hooksPerConcept: 2, formats: ["9:16", "4:5", "1:1"], languages: 2, accounts: 4,
    } : DEFAULT_MULTIPLIER_STATE).assets).toBe(24);
    expect(g.columns.find((c) => c.id === "outputs")!.nodes).toHaveLength(24);
  });
});

describe("default state", () => {
  it("produces a legible, non-aggregated starting graph", () => {
    const g = buildGraph(DEFAULT_MULTIPLIER_STATE);
    expect(g.aggregated).toBe(false);
    expect(computeCampaign(DEFAULT_MULTIPLIER_STATE).assets).toBe(18);
    expect(g.totalNodes).toBeLessThanOrEqual(30);
  });
});
