import { describe, expect, it } from "vitest";
import { buildScale, linePath, nearestIndex, yTicks, type Series } from "./geometry";

const PLOT = { width: 100, height: 100, padding: { top: 0, right: 0, bottom: 0, left: 0 } };

const series = (points: readonly [number, number][]): Series => ({
  id: "s",
  label: "S",
  points: points.map(([x, y]) => ({ x, y })),
});

describe("buildScale", () => {
  it("maps the domain onto the inner plot area", () => {
    const scale = buildScale([series([[0, 0], [10, 100]])], PLOT);
    expect(scale.x(0)).toBeCloseTo(0);
    expect(scale.x(10)).toBeCloseTo(100);
    // y is inverted: the largest value sits at the top of the plot.
    expect(scale.y(100)).toBeCloseTo(0);
    expect(scale.y(0)).toBeCloseTo(100);
  });

  it("anchors the y domain at zero so variation is not exaggerated", () => {
    // Values 98..100 must NOT fill the plot — a truncated baseline would make a
    // 2% change look like a collapse, which is the misleading-chart case.
    const scale = buildScale([series([[0, 98], [1, 100]])], PLOT);
    expect(scale.domain.minY).toBe(0);
  });

  it("honours an explicit non-zero baseline when asked", () => {
    const scale = buildScale([series([[0, 98], [1, 100]])], PLOT, { zeroBaseline: false });
    expect(scale.domain.minY).toBe(98);
  });

  it("gives a flat series a drawable domain instead of dividing by zero", () => {
    const scale = buildScale([series([[0, 5], [1, 5]])], PLOT, { zeroBaseline: false });
    expect(Number.isFinite(scale.y(5))).toBe(true);
    expect(scale.domain.maxY).toBeGreaterThan(scale.domain.minY);
  });

  it("survives an empty series without throwing", () => {
    const scale = buildScale([series([])], PLOT);
    expect(Number.isFinite(scale.x(0))).toBe(true);
    expect(Number.isFinite(scale.y(0))).toBe(true);
  });

  it("spans every series, not just the first", () => {
    const scale = buildScale(
      [series([[0, 10]]), { id: "b", label: "B", points: [{ x: 5, y: 200 }] }],
      PLOT,
    );
    expect(scale.domain.maxX).toBe(5);
    expect(scale.domain.maxY).toBe(200);
  });
});

describe("linePath", () => {
  it("moves to the first point and lines to the rest", () => {
    const scale = buildScale([series([[0, 0], [10, 10]])], PLOT);
    const path = linePath(series([[0, 0], [10, 10]]).points, scale);
    expect(path.startsWith("M")).toBe(true);
    expect(path.split("L")).toHaveLength(2);
  });

  it("returns an empty string for no points rather than an invalid path", () => {
    const scale = buildScale([series([])], PLOT);
    expect(linePath([], scale)).toBe("");
  });
});

describe("yTicks", () => {
  it("uses human step sizes rather than dividing the range evenly", () => {
    const scale = buildScale([series([[0, 0], [1, 3847]])], PLOT);
    const ticks = yTicks(scale, 4);
    // Every step must be a round number the axis can label legibly.
    const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
    expect([1, 2, 5, 10].some((m) => Math.abs(step / 10 ** Math.floor(Math.log10(step)) - m) < 1e-6)).toBe(
      true,
    );
  });

  it("always returns at least one tick", () => {
    const scale = buildScale([series([[0, 0], [1, 0]])], PLOT);
    expect(yTicks(scale).length).toBeGreaterThan(0);
  });
});

describe("nearestIndex", () => {
  it("selects by x distance so a high pointer still picks its column", () => {
    const points = series([[0, 0], [10, 100], [20, 0]]).points;
    const scale = buildScale([{ id: "s", label: "S", points }], PLOT);
    // Pixel x for the middle point, regardless of y.
    expect(nearestIndex(points, scale.x(10), scale)).toBe(1);
  });

  it("returns -1 when there is nothing to select", () => {
    const scale = buildScale([series([])], PLOT);
    expect(nearestIndex([], 0, scale)).toBe(-1);
  });
});
