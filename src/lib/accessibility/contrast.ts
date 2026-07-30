/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Used by the kitchen sink to render measured ratios on screen and by
 * `contrast.test.ts` to fail the build if a token pairing regresses. Contrast
 * claims in this project are computed, never estimated.
 */

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Invalid hex colour: ${hex}`);
  }

  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ] as const;
}

function linearize(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = "AAA" | "AA" | "AA-large" | "fail";

/**
 * `large` covers text at 18.66px bold or 24px regular and above.
 * Non-text UI components and graphical objects use the same 3:1 floor as
 * large text.
 */
export function contrastLevel(ratio: number, large = false): ContrastLevel {
  if (large) {
    if (ratio >= 4.5) return "AAA";
    if (ratio >= 3) return "AA-large";
    return "fail";
  }
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}
