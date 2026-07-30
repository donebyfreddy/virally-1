import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastLevel, contrastRatio, relativeLuminance } from "./contrast";
import { contrastContract, palette, surfaces } from "./palette";

// Resolved from the project root: under the jsdom environment `import.meta.url`
// is not a file:// URL, so URL-relative resolution is unavailable here.
const tokensCss = readFileSync(
  resolve(process.cwd(), "src/styles/tokens.css"),
  "utf8",
);

describe("contrast maths", () => {
  it("computes the known reference ratio for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#07090d", "#ffca5c")).toBeCloseTo(
      contrastRatio("#ffca5c", "#07090d"),
      10,
    );
  });

  it("returns 1 for identical colours", () => {
    expect(contrastRatio("#1a212b", "#1a212b")).toBeCloseTo(1, 10);
  });

  it("computes sRGB luminance endpoints", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("rejects malformed hex", () => {
    expect(() => contrastRatio("not-a-colour", "#ffffff")).toThrow();
  });

  it("applies the 3:1 floor for large text and UI components", () => {
    expect(contrastLevel(3.2, true)).toBe("AA-large");
    expect(contrastLevel(3.2, false)).toBe("AA-large");
    expect(contrastLevel(4.6, false)).toBe("AA");
    expect(contrastLevel(2.9, true)).toBe("fail");
  });
});

describe("palette / tokens.css parity", () => {
  // Guards against the mirrored TS palette drifting from shipped CSS.
  it.each(Object.entries(palette))(
    "tokens.css declares %s as %s",
    (name, hex) => {
      expect(tokensCss).toContain(`--color-${name}: ${hex};`);
    },
  );
});

describe("contrast contract", () => {
  it.each(contrastContract)(
    "$note — $foreground on $background clears its floor",
    ({ foreground, background, large }) => {
      const ratio = contrastRatio(palette[foreground], palette[background]);
      const floor = large ? 3 : 4.5;
      expect(
        ratio,
        `${foreground} on ${background} measured ${ratio.toFixed(2)}:1, needs ${floor}:1`,
      ).toBeGreaterThanOrEqual(floor);
    },
  );
});

describe("surface elevation", () => {
  it("keeps every adjacent surface step perceptibly distinct", () => {
    for (let i = 1; i < surfaces.length; i += 1) {
      const ratio = contrastRatio(palette[surfaces[i - 1]], palette[surfaces[i]]);
      expect(
        ratio,
        `${surfaces[i - 1]} → ${surfaces[i]} separated by only ${ratio.toFixed(3)}`,
      ).toBeGreaterThan(1.05);
    }
  });

  it("separates the extremes of the ramp clearly", () => {
    expect(contrastRatio(palette.canvas, palette["surface-3"])).toBeGreaterThan(1.3);
  });
});

describe("the two-accent taxonomy", () => {
  it("keeps action and signal distinguishable in greyscale", () => {
    // Colour-vision safety: the pair must not rely on hue alone.
    const ratio = contrastRatio(palette.action, palette.signal);
    expect(ratio).toBeGreaterThan(1.05);
  });

  it("uses amber for the focus ring at UI contrast on every surface", () => {
    for (const surface of surfaces) {
      expect(contrastRatio(palette.focus, palette[surface])).toBeGreaterThanOrEqual(3);
    }
  });
});
