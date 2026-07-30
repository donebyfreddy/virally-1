import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS,
  PLATFORM_SAFE_AREAS,
  RATIO_DIMENSIONS,
  cropToPixels,
  planAdaptation,
  ratioValue,
  viableRatios,
} from "./format";

const LANDSCAPE = { width: 1920, height: 1080 };
const VERTICAL = { width: 1080, height: 1920 };
const SQUARE = { width: 1080, height: 1080 };

describe("ratioValue", () => {
  it("computes the canonical ratios", () => {
    expect(ratioValue("16:9")).toBeCloseTo(16 / 9, 3);
    expect(ratioValue("9:16")).toBeCloseTo(9 / 16, 3);
    expect(ratioValue("1:1")).toBe(1);
    expect(ratioValue("4:5")).toBeCloseTo(0.8, 3);
  });

  it("uses supplied dimensions for a custom ratio", () => {
    expect(ratioValue("custom", { width: 2000, height: 500 })).toBe(4);
  });
});

describe("planAdaptation — no crop when ratios match", () => {
  it("keeps the whole frame for an identical ratio", () => {
    const plan = planAdaptation({ source: LANDSCAPE, targetRatio: "16:9" });
    expect(plan.cropped).toBe(false);
    expect(plan.retainedArea).toBeCloseTo(1, 3);
    expect(plan.warnings).toEqual([]);
  });

  it("does not report a crop from floating-point noise", () => {
    // Without a tolerance, 1920x1080 → 16:9 reports a crop because of float division.
    const plan = planAdaptation({ source: { width: 1919, height: 1079 }, targetRatio: "16:9" });
    expect(plan.cropped).toBe(false);
  });

  it("keeps the whole frame for square to square", () => {
    expect(planAdaptation({ source: SQUARE, targetRatio: "1:1" }).cropped).toBe(false);
  });
});

describe("planAdaptation — crop geometry", () => {
  it("narrows the width when the source is wider than the target", () => {
    const plan = planAdaptation({ source: LANDSCAPE, targetRatio: "9:16" });
    expect(plan.crop.height).toBeCloseTo(1, 3);
    expect(plan.crop.width).toBeLessThan(1);
  });

  it("shortens the height when the source is taller than the target", () => {
    const plan = planAdaptation({ source: VERTICAL, targetRatio: "16:9" });
    expect(plan.crop.width).toBeCloseTo(1, 3);
    expect(plan.crop.height).toBeLessThan(1);
  });

  it("always produces a crop inside the source frame", () => {
    // A crop extending past the edge samples nothing and renders black bars.
    for (const source of [LANDSCAPE, VERTICAL, SQUARE, { width: 3840, height: 1080 }]) {
      for (const ratio of ["9:16", "4:5", "1:1", "16:9", "4:3", "3:2"] as const) {
        for (const focus of [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 0.5, y: 0.5 },
        ]) {
          const plan = planAdaptation({ source, targetRatio: ratio, focus });
          expect(plan.crop.x).toBeGreaterThanOrEqual(-1e-9);
          expect(plan.crop.y).toBeGreaterThanOrEqual(-1e-9);
          expect(plan.crop.x + plan.crop.width).toBeLessThanOrEqual(1 + 1e-9);
          expect(plan.crop.y + plan.crop.height).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });

  it("produces the target ratio exactly", () => {
    for (const ratio of ["9:16", "4:5", "1:1", "16:9", "4:3"] as const) {
      const plan = planAdaptation({ source: LANDSCAPE, targetRatio: ratio });
      const cropped = {
        width: plan.crop.width * LANDSCAPE.width,
        height: plan.crop.height * LANDSCAPE.height,
      };
      expect(cropped.width / cropped.height).toBeCloseTo(plan.targetRatio, 2);
    }
  });
});

describe("planAdaptation — subject preservation", () => {
  it("is not a blind centre crop", () => {
    // The rule this enforces: a centre crop decapitates the subject. A focus point
    // left of centre must move the crop left.
    const left = planAdaptation({ source: LANDSCAPE, targetRatio: "9:16", focus: { x: 0.2, y: 0.4 } });
    const centre = planAdaptation({ source: LANDSCAPE, targetRatio: "9:16", focus: { x: 0.5, y: 0.4 } });
    expect(left.crop.x).toBeLessThan(centre.crop.x);
  });

  it("defaults the subject above centre, where faces actually are", () => {
    expect(DEFAULT_FOCUS.y).toBeLessThan(0.5);
    const plan = planAdaptation({ source: LANDSCAPE, targetRatio: "16:9" });
    expect(plan.focus.y).toBeLessThan(0.5);
  });

  it("clamps a focus point outside the frame instead of producing NaN", () => {
    const plan = planAdaptation({ source: LANDSCAPE, targetRatio: "9:16", focus: { x: 5, y: -3 } });
    expect(Number.isFinite(plan.crop.x)).toBe(true);
    expect(plan.focus.x).toBe(1);
    expect(plan.focus.y).toBe(0);
  });

  it("always keeps the subject inside the crop, for every ratio and focus", () => {
    // The invariant that replaced a warning branch which could never fire: clamping
    // the crop origin to [0, 1 - size] provably retains the focus point. Asserted
    // exhaustively here so the property is guarded rather than merely argued.
    for (const source of [LANDSCAPE, VERTICAL, SQUARE, { width: 3840, height: 1080 }]) {
      for (const ratio of ["9:16", "4:5", "1:1", "16:9", "4:3", "3:2"] as const) {
        for (const fx of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
          for (const fy of [0, 0.38, 0.5, 1]) {
            const plan = planAdaptation({ source, targetRatio: ratio, focus: { x: fx, y: fy } });
            const { crop, focus } = plan;
            expect(focus.x).toBeGreaterThanOrEqual(crop.x - 1e-9);
            expect(focus.x).toBeLessThanOrEqual(crop.x + crop.width + 1e-9);
            expect(focus.y).toBeGreaterThanOrEqual(crop.y - 1e-9);
            expect(focus.y).toBeLessThanOrEqual(crop.y + crop.height + 1e-9);
          }
        }
      }
    }
  });
});

describe("planAdaptation — warnings", () => {
  it("warns when most of the frame is discarded", () => {
    const plan = planAdaptation({ source: LANDSCAPE, targetRatio: "9:16" });
    // 16:9 → 9:16 keeps about 32% of the frame.
    expect(plan.retainedArea).toBeLessThan(0.5);
    expect(plan.warnings.some((w) => /% of the source frame is kept/.test(w))).toBe(true);
  });

  it("states the real retained percentage", () => {
    const plan = planAdaptation({ source: LANDSCAPE, targetRatio: "9:16" });
    const expected = Math.round(plan.retainedArea * 100);
    expect(plan.warnings.join(" ")).toContain(`${expected}%`);
  });

  it("names the landscape-to-vertical case specifically", () => {
    const plan = planAdaptation({ source: LANDSCAPE, targetRatio: "9:16" });
    expect(plan.warnings.some((w) => /landscape source adapted to a vertical format/i.test(w))).toBe(true);
  });

  it("stays silent for a benign adaptation", () => {
    // Warning on every adaptation trains users to ignore warnings.
    const plan = planAdaptation({ source: VERTICAL, targetRatio: "4:5" });
    expect(plan.warnings).toEqual([]);
  });
});

describe("safe areas and text placement", () => {
  it("uses the platform's safe area when given one", () => {
    const tiktok = planAdaptation({ source: VERTICAL, targetRatio: "9:16", platform: "tiktok" });
    expect(tiktok.safeArea).toEqual(PLATFORM_SAFE_AREAS.tiktok);
  });

  it("falls back to the default safe area for an unknown platform", () => {
    const plan = planAdaptation({ source: VERTICAL, targetRatio: "9:16", platform: "myspace" });
    expect(plan.safeArea).toEqual(PLATFORM_SAFE_AREAS.default);
  });

  it("keeps captions clear of the platform's bottom chrome", () => {
    // Otherwise the caption renders under the like and share buttons.
    for (const platform of ["instagram", "tiktok", "youtube", "facebook"]) {
      const plan = planAdaptation({ source: VERTICAL, targetRatio: "9:16", platform });
      const captionBottom = plan.captionBox.y + plan.captionBox.height;
      expect(captionBottom).toBeLessThanOrEqual(1 - plan.safeArea.bottom + 1e-9);
    }
  });

  it("keeps captions and the CTA inside the horizontal safe area", () => {
    const plan = planAdaptation({ source: VERTICAL, targetRatio: "9:16", platform: "tiktok" });
    for (const box of [plan.captionBox, plan.ctaBox]) {
      expect(box.x).toBeGreaterThanOrEqual(plan.safeArea.left - 1e-9);
      expect(box.x + box.width).toBeLessThanOrEqual(1 - plan.safeArea.right + 1e-9);
    }
  });

  it("places the CTA above the caption without overlapping it", () => {
    const plan = planAdaptation({ source: VERTICAL, targetRatio: "9:16", platform: "instagram" });
    expect(plan.ctaBox.y + plan.ctaBox.height).toBeLessThanOrEqual(plan.captionBox.y + 1e-9);
  });
});

describe("cropToPixels", () => {
  it("produces even dimensions for codec compatibility", () => {
    // Odd dimensions make most H.264 encoders fail or silently pad.
    for (const ratio of ["9:16", "4:5", "1:1", "16:9", "4:3", "3:2"] as const) {
      const plan = planAdaptation({ source: { width: 1921, height: 1081 }, targetRatio: ratio });
      const pixels = cropToPixels(plan.crop, { width: 1921, height: 1081 });
      expect(pixels.width % 2).toBe(0);
      expect(pixels.height % 2).toBe(0);
    }
  });

  it("stays within the source bounds for every ratio, focus and odd dimension", () => {
    // Regression: rounding origin and size independently pushed x+width one pixel
    // past the edge, which makes a renderer sample outside the frame.
    for (const source of [LANDSCAPE, VERTICAL, { width: 1921, height: 1081 }, { width: 999, height: 501 }]) {
      for (const ratio of ["9:16", "4:5", "1:1", "16:9", "4:3", "3:2"] as const) {
        for (const focus of [{ x: 0, y: 0 }, { x: 0.95, y: 0.9 }, { x: 1, y: 1 }]) {
          const plan = planAdaptation({ source, targetRatio: ratio, focus });
          const pixels = cropToPixels(plan.crop, source);
          expect(pixels.x).toBeGreaterThanOrEqual(0);
          expect(pixels.y).toBeGreaterThanOrEqual(0);
          expect(pixels.x + pixels.width).toBeLessThanOrEqual(source.width);
          expect(pixels.y + pixels.height).toBeLessThanOrEqual(source.height);
        }
      }
    }
  });
});

describe("viableRatios", () => {
  it("reports vertical sources as unsuitable for wide formats", () => {
    // Offering all five ratios and producing three bad crops is the dishonest option.
    const viable = viableRatios(VERTICAL);
    expect(viable).toContain("9:16");
    expect(viable).not.toContain("16:9");
  });

  it("reports landscape sources as unsuitable for vertical formats", () => {
    const viable = viableRatios(LANDSCAPE);
    expect(viable).toContain("16:9");
    expect(viable).not.toContain("9:16");
  });

  it("finds a square source viable for most formats", () => {
    expect(viableRatios(SQUARE).length).toBeGreaterThanOrEqual(4);
  });

  it("honours a stricter threshold", () => {
    expect(viableRatios(LANDSCAPE, 0.99).length).toBeLessThan(viableRatios(LANDSCAPE, 0.5).length);
  });
});

describe("RATIO_DIMENSIONS", () => {
  it("matches its own ratio name", () => {
    const expected: Record<string, number> = {
      "9:16": 9 / 16,
      "4:5": 4 / 5,
      "1:1": 1,
      "16:9": 16 / 9,
      "4:3": 4 / 3,
      "3:2": 3 / 2,
    };
    for (const [name, ratio] of Object.entries(expected)) {
      const dimensions = RATIO_DIMENSIONS[name as keyof typeof RATIO_DIMENSIONS];
      expect(dimensions.width / dimensions.height).toBeCloseTo(ratio, 2);
    }
  });

  it("uses even pixel dimensions throughout", () => {
    for (const dimensions of Object.values(RATIO_DIMENSIONS)) {
      expect(dimensions.width % 2).toBe(0);
      expect(dimensions.height % 2).toBe(0);
    }
  });
});
