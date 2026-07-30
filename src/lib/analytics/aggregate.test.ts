import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_COPY,
  HEATMAP_MIN_OBSERVATIONS,
  INSUFFICIENT_DATA_COPY,
  MIN_VIEWS_FOR_CPM,
  buildFunnel,
  buildHeatmap,
  classifyConfidence,
  compare,
  costPerMilleCents,
  engagementRateBp,
  fillDayGaps,
  formatBp,
  formatCompact,
  formatCount,
  resolveRange,
  sumMetric,
  toSeries,
  type DailyPoint,
} from "./aggregate";

describe("null is not zero", () => {
  // The rule the whole module exists to protect: a metric the platform never
  // reported must not be drawn as a zero.
  it("returns null when no day reported the metric", () => {
    const points: DailyPoint[] = [{ day: "2026-08-01", values: {} }, { day: "2026-08-02", values: {} }];
    expect(sumMetric(points, "views").total).toBeNull();
  });

  it("sums only reporting days and flags a partial total", () => {
    const points: DailyPoint[] = [
      { day: "2026-08-01", values: { views: 100 } },
      { day: "2026-08-02", values: {} },
      { day: "2026-08-03", values: { views: 50 } },
    ];
    const total = sumMetric(points, "views");
    expect(total.total).toBe(150);
    expect(total.reportingDays).toBe(2);
    expect(total.totalDays).toBe(3);
    // Without this flag a UI cannot tell 2-of-3 coverage from complete coverage.
    expect(total.partial).toBe(true);
  });

  it("does not flag a complete total as partial", () => {
    const points: DailyPoint[] = [
      { day: "2026-08-01", values: { views: 10 } },
      { day: "2026-08-02", values: { views: 20 } },
    ];
    expect(sumMetric(points, "views").partial).toBe(false);
  });

  it("treats a real zero as data, distinct from missing", () => {
    const points: DailyPoint[] = [{ day: "2026-08-01", values: { views: 0 } }];
    const total = sumMetric(points, "views");
    expect(total.total).toBe(0);
    expect(total.reportingDays).toBe(1);
  });

  it("renders missing values as an em dash, never as 0", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCompact(null)).toBe("—");
    expect(formatBp(null)).toBe("—");
    expect(formatCount(0)).toBe("0");
  });

  it("preserves gaps when extracting a series", () => {
    const points: DailyPoint[] = [
      { day: "2026-08-01", values: { views: 5 } },
      { day: "2026-08-02", values: {} },
    ];
    expect(toSeries(points, "views")).toEqual([
      { day: "2026-08-01", value: 5 },
      { day: "2026-08-02", value: null },
    ]);
  });
});

describe("fillDayGaps", () => {
  it("inserts missing days as null, not zero", () => {
    // A chart that omits days compresses a two-week gap into one pixel.
    const filled = fillDayGaps([{ day: "2026-08-01", values: { views: 10 } }], "2026-08-01", "2026-08-04");
    expect(filled).toHaveLength(4);
    expect(filled[1]?.values.views).toBeUndefined();
    expect(toSeries(filled, "views")[1]?.value).toBeNull();
  });

  it("keeps existing days intact", () => {
    const filled = fillDayGaps(
      [{ day: "2026-08-02", values: { views: 7 } }],
      "2026-08-01",
      "2026-08-03",
    );
    expect(filled[1]?.values.views).toBe(7);
  });

  it("returns the input unchanged for an invalid range", () => {
    const points: DailyPoint[] = [{ day: "2026-08-01", values: {} }];
    expect(fillDayGaps(points, "2026-08-05", "2026-08-01")).toBe(points);
    expect(fillDayGaps(points, "not-a-date", "2026-08-01")).toBe(points);
  });
});

describe("compare", () => {
  it("computes an absolute and relative change", () => {
    const result = compare(150, 100);
    expect(result.delta).toBe(50);
    expect(result.deltaBp).toBe(5000);
    expect(result.direction).toBe("up");
  });

  it("returns null percentage growth from a zero base", () => {
    // "+100%" from zero is meaningless and "+∞%" is worse. The absolute change is the
    // only honest figure.
    const result = compare(50, 0);
    expect(result.delta).toBe(50);
    expect(result.deltaBp).toBeNull();
    expect(result.direction).toBe("up");
  });

  it("reports unknown when either side is missing", () => {
    expect(compare(null, 100).direction).toBe("unknown");
    expect(compare(100, null).direction).toBe("unknown");
    expect(compare(null, null).deltaBp).toBeNull();
  });

  it("detects a decline and a flat period", () => {
    expect(compare(80, 100).direction).toBe("down");
    expect(compare(100, 100).direction).toBe("flat");
    expect(compare(100, 100).deltaBp).toBe(0);
  });
});

describe("engagementRateBp", () => {
  it("computes basis points", () => {
    expect(engagementRateBp(50, 1000)).toBe(500);
    expect(formatBp(500)).toBe("5.00%");
  });

  it("returns null rather than 0% for a missing or zero denominator", () => {
    // "0% engagement" asserts nobody engaged; a missing denominator means unknown.
    expect(engagementRateBp(10, null)).toBeNull();
    expect(engagementRateBp(10, 0)).toBeNull();
    expect(engagementRateBp(null, 1000)).toBeNull();
  });

  it("preserves a genuine zero engagement rate", () => {
    expect(engagementRateBp(0, 1000)).toBe(0);
  });
});

describe("formatCompact", () => {
  it("abbreviates at sensible thresholds", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1500)).toBe("1.5K");
    expect(formatCompact(15_000)).toBe("15K");
    expect(formatCompact(1_500_000)).toBe("1.5M");
    expect(formatCompact(2_400_000_000)).toBe("2.4B");
  });

  it("handles negatives, which followers-lost produces", () => {
    expect(formatCompact(-1500)).toBe("-1.5K");
  });
});

describe("buildFunnel", () => {
  it("computes conversion against the previous stage", () => {
    const funnel = buildFunnel([
      { id: "generated", label: "Generated", count: 100 },
      { id: "approved", label: "Approved", count: 80 },
      { id: "published", label: "Published", count: 40 },
    ]);
    expect(funnel[0]?.conversionBp).toBeNull();
    expect(funnel[1]?.conversionBp).toBe(8000);
    expect(funnel[2]?.conversionBp).toBe(5000);
  });

  it("breaks the chain at an unknown stage rather than carrying a value forward", () => {
    // Carrying the last known value forward would silently overstate conversion.
    const funnel = buildFunnel([
      { id: "generated", label: "Generated", count: 100 },
      { id: "approved", label: "Approved", count: null },
      { id: "published", label: "Published", count: 40 },
    ]);
    expect(funnel[1]?.conversionBp).toBeNull();
    expect(funnel[2]?.conversionBp).toBeNull();
  });

  it("returns null conversion when the previous stage is zero", () => {
    const funnel = buildFunnel([
      { id: "a", label: "A", count: 0 },
      { id: "b", label: "B", count: 5 },
    ]);
    expect(funnel[1]?.conversionBp).toBeNull();
  });
});

describe("buildHeatmap", () => {
  it("groups by weekday and hour", () => {
    // 2026-08-03 is a Monday.
    const cells = buildHeatmap([
      { publishedAt: new Date("2026-08-03T09:00:00Z"), value: 100 },
      { publishedAt: new Date("2026-08-10T09:00:00Z"), value: 200 },
      { publishedAt: new Date("2026-08-04T18:00:00Z"), value: 50 },
    ]);
    const monday9 = cells.find((cell) => cell.dayOfWeek === 1 && cell.hour === 9);
    expect(monday9?.postCount).toBe(2);
    expect(monday9?.averageValue).toBe(150);
  });

  it("reports the post count so thin cells can be suppressed", () => {
    // A heatmap that colours one lucky post as the best hour is actively misleading.
    const cells = buildHeatmap([{ publishedAt: new Date("2026-08-03T09:00:00Z"), value: 9999 }]);
    expect(cells[0]?.postCount).toBe(1);
    expect(cells[0]?.postCount).toBeLessThan(HEATMAP_MIN_OBSERVATIONS);
  });

  it("averages only reporting posts and returns null when none report", () => {
    const cells = buildHeatmap([
      { publishedAt: new Date("2026-08-03T09:00:00Z"), value: null },
      { publishedAt: new Date("2026-08-10T09:00:00Z"), value: null },
    ]);
    expect(cells[0]?.postCount).toBe(2);
    expect(cells[0]?.averageValue).toBeNull();
  });

  it("returns cells in a stable order", () => {
    const cells = buildHeatmap([
      { publishedAt: new Date("2026-08-08T20:00:00Z"), value: 1 },
      { publishedAt: new Date("2026-08-03T05:00:00Z"), value: 1 },
    ]);
    expect(cells[0]?.dayOfWeek).toBeLessThanOrEqual(cells[1]?.dayOfWeek ?? 7);
  });
});

describe("classifyConfidence", () => {
  it("never claims statistical significance", () => {
    // The brief forbids a significance claim without a correct method, so the
    // vocabulary itself must avoid implying one.
    for (const copy of Object.values(CONFIDENCE_COPY)) {
      expect(copy).not.toMatch(/significant|p-value|p <|confidence interval/i);
    }
  });

  it("reports no data for an empty sample", () => {
    expect(classifyConfidence({ observations: 0 })).toBe("no_data");
  });

  it("calls a tiny sample an early signal", () => {
    expect(classifyConfidence({ observations: 5, effectBp: 9000 })).toBe("early_signal");
  });

  it("calls a large effect on a moderate sample promising", () => {
    expect(classifyConfidence({ observations: 40, effectBp: 3000 })).toBe("promising");
  });

  it("calls a small effect on a moderate sample inconclusive", () => {
    expect(classifyConfidence({ observations: 40, effectBp: 200 })).toBe("inconclusive");
  });

  it("reaches enough observations on a large sample", () => {
    expect(classifyConfidence({ observations: 500, effectBp: 100 })).toBe("enough_observations");
  });

  it("states its thresholds are the product's own", () => {
    expect(CONFIDENCE_COPY.enough_observations).toMatch(/rather than a significance test/i);
  });

  it("provides the exact insufficient-data wording the brief requires", () => {
    expect(INSUFFICIENT_DATA_COPY).toBe("Not enough data to make a reliable recommendation.");
  });
});

describe("resolveRange", () => {
  const today = new Date("2026-08-30T12:00:00Z");

  it("resolves presets inclusively", () => {
    const range = resolveRange("7d", today);
    expect(range.end).toBe("2026-08-30");
    expect(range.start).toBe("2026-08-24");
    expect(range.days).toBe(7);
  });

  it("produces a previous window of equal length that does not overlap", () => {
    // Comparing 30 days against 7 would make every trend meaningless.
    const range = resolveRange("30d", today);
    expect(range.previousEnd).toBe("2026-07-31");
    expect(range.previousStart).toBe("2026-07-02");

    const currentStart = Date.parse(`${range.start}T00:00:00Z`);
    const previousEnd = Date.parse(`${range.previousEnd}T00:00:00Z`);
    expect(previousEnd).toBeLessThan(currentStart);

    const previousDays =
      Math.round((previousEnd - Date.parse(`${range.previousStart}T00:00:00Z`)) / 86_400_000) + 1;
    expect(previousDays).toBe(range.days);
  });

  it("handles 90 days", () => {
    expect(resolveRange("90d", today).days).toBe(90);
  });

  it("supports a custom range and mirrors its length backwards", () => {
    const range = resolveRange("custom", today, { start: "2026-08-01", end: "2026-08-10" });
    expect(range.days).toBe(10);
    expect(range.previousEnd).toBe("2026-07-31");
    expect(range.previousStart).toBe("2026-07-22");
  });
});

describe("costPerMilleCents", () => {
  it("computes CPM above the minimum view count", () => {
    expect(costPerMilleCents(5000, 10_000)).toBe(500);
  });

  it("returns null below the minimum, rather than a meaningless figure", () => {
    // A CPM from 4 views invites decisions based on nothing.
    expect(costPerMilleCents(5000, 4)).toBeNull();
    expect(costPerMilleCents(5000, MIN_VIEWS_FOR_CPM - 1)).toBeNull();
  });

  it("returns null when views are unknown", () => {
    expect(costPerMilleCents(5000, null)).toBeNull();
  });
});
