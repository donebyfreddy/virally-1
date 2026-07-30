import type { AspectRatio } from "@/types/database";

/**
 * Format adaptation.
 *
 * The brief's hard rule: "Do not perform a blind crop." Centre-cropping 16:9 to 9:16
 * throws away 68% of the frame and reliably decapitates the subject — it is the
 * single most visible way an automated tool looks automated.
 *
 * So adaptation produces a LAYOUT DECISION, not a crop rectangle alone: where the
 * subject is, what the safe areas are, and where text and the CTA go. Those overrides
 * are stored per variant (`content_variants.layout_overrides`) so a human edit
 * survives re-rendering.
 */

export type Dimensions = { width: number; height: number };

export const RATIO_DIMENSIONS: Readonly<Record<AspectRatio, Dimensions>> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "3:2": { width: 1620, height: 1080 },
  // Resolved from explicit width/height by the caller; the entry exists so the
  // record is exhaustive and a missing case is a type error.
  custom: { width: 1080, height: 1080 },
};

export function ratioValue(ratio: AspectRatio, custom?: Dimensions): number {
  if (ratio === "custom" && custom) return custom.width / custom.height;
  const dimensions = RATIO_DIMENSIONS[ratio];
  return dimensions.width / dimensions.height;
}

/**
 * Normalised subject position within the source frame, 0–1.
 *
 * Supplied by a detector, or defaulted. `y: 0.38` rather than 0.5 because faces sit
 * above centre in almost all footage — centring vertically crops foreheads.
 */
export type SubjectFocus = { x: number; y: number };

export const DEFAULT_FOCUS: SubjectFocus = { x: 0.5, y: 0.38 };

export type SafeAreaInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/**
 * Platform chrome that overlaps the frame, as a fraction of the height/width.
 *
 * These are measured allowances for where each platform draws its own UI over the
 * video — captions and CTAs must stay outside them or they sit under a like button.
 * They are approximations of a moving target, which is why they are stated as
 * generous fractions rather than pixel values implying precision.
 */
export const PLATFORM_SAFE_AREAS: Readonly<Record<string, SafeAreaInsets>> = {
  instagram: { top: 0.08, bottom: 0.2, left: 0.04, right: 0.16 },
  tiktok: { top: 0.1, bottom: 0.24, left: 0.04, right: 0.2 },
  youtube: { top: 0.06, bottom: 0.18, left: 0.04, right: 0.12 },
  facebook: { top: 0.08, bottom: 0.2, left: 0.04, right: 0.14 },
  default: { top: 0.08, bottom: 0.16, left: 0.05, right: 0.05 },
};

export type CropRect = {
  /** Source-relative crop, in normalised 0–1 units. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AdaptationPlan = {
  target: Dimensions;
  targetRatio: number;
  crop: CropRect;
  /** Whether the source had to be cropped at all. */
  cropped: boolean;
  /** Fraction of the source frame retained, 0–1. */
  retainedArea: number;
  focus: SubjectFocus;
  safeArea: SafeAreaInsets;
  /** Where captions should sit, normalised to the TARGET frame. */
  captionBox: CropRect;
  ctaBox: CropRect;
  /**
   * Raised when the adaptation is lossy enough that a human should look at it.
   * The brief requires warning rather than silently shipping a bad crop.
   */
  warnings: readonly string[];
};

/**
 * Computes the adaptation from a source frame to a target ratio.
 *
 * The crop is the largest rectangle of the target ratio that fits inside the source,
 * positioned so the subject stays inside it — then clamped to the frame so it never
 * samples outside the source.
 */
export function planAdaptation(options: {
  source: Dimensions;
  targetRatio: AspectRatio;
  customTarget?: Dimensions;
  focus?: SubjectFocus;
  platform?: string;
}): AdaptationPlan {
  const focus = clampFocus(options.focus ?? DEFAULT_FOCUS);
  const target =
    options.targetRatio === "custom" && options.customTarget
      ? options.customTarget
      : RATIO_DIMENSIONS[options.targetRatio];

  const sourceRatio = options.source.width / options.source.height;
  const targetRatio = target.width / target.height;

  let cropWidth = 1;
  let cropHeight = 1;

  // Within a small tolerance the ratios match and nothing is cropped. Without the
  // tolerance, floating-point noise makes 1920x1080 → 16:9 report as a crop.
  const RATIO_TOLERANCE = 0.005;

  if (Math.abs(sourceRatio - targetRatio) > RATIO_TOLERANCE) {
    if (sourceRatio > targetRatio) {
      // Source is wider: keep full height, narrow the width.
      cropWidth = targetRatio / sourceRatio;
    } else {
      // Source is taller: keep full width, shorten the height.
      cropHeight = sourceRatio / targetRatio;
    }
  }

  // Centre the crop on the subject, then clamp so it stays inside the frame.
  const x = clamp(focus.x - cropWidth / 2, 0, 1 - cropWidth);
  const y = clamp(focus.y - cropHeight / 2, 0, 1 - cropHeight);

  const crop: CropRect = { x, y, width: cropWidth, height: cropHeight };
  const retainedArea = cropWidth * cropHeight;
  const cropped = retainedArea < 1 - RATIO_TOLERANCE;

  const safeArea = PLATFORM_SAFE_AREAS[options.platform ?? "default"] ?? PLATFORM_SAFE_AREAS.default;

  const warnings: string[] = [];

  // Below half the frame retained, a crop is a reframe and deserves review.
  if (retainedArea < 0.5) {
    warnings.push(
      `Only ${Math.round(retainedArea * 100)}% of the source frame is kept. Check that the subject is still framed correctly, or supply a version shot for this ratio.`,
    );
  }

  // No "subject fell outside the crop" warning, because it cannot happen. Clamping
  // `x` to [0, 1 - cropWidth] provably keeps the focus point inside the crop:
  //   - if f - w/2 < 0 then x = 0 and f < w/2 < w, so f is in [0, w]
  //   - if f - w/2 > 1 - w then x = 1 - w and f <= 1 <= x + w
  //   - otherwise x = f - w/2 and f is exactly centred
  // An earlier draft warned on this condition; it was unreachable code pretending to
  // be a safety net. The invariant is asserted in format.test.ts instead.

  // Landscape source to vertical target is the worst case and worth naming.
  if (sourceRatio > 1.3 && targetRatio < 0.8) {
    warnings.push(
      "This is a landscape source adapted to a vertical format. A re-shot or re-composed version usually performs better than a crop.",
    );
  }

  return {
    target,
    targetRatio,
    crop,
    cropped,
    retainedArea,
    focus,
    safeArea,
    captionBox: captionBoxFor(safeArea),
    ctaBox: ctaBoxFor(safeArea),
    warnings,
  };
}

/**
 * Caption placement inside the safe area.
 *
 * Sits in the lower third but above the platform's bottom chrome — the position that
 * reads while still leaving the subject visible.
 */
function captionBoxFor(safeArea: SafeAreaInsets): CropRect {
  const left = safeArea.left;
  const width = 1 - safeArea.left - safeArea.right;
  const height = 0.18;
  const top = 1 - safeArea.bottom - height;
  return { x: left, y: Math.max(safeArea.top, top), width, height };
}

/** CTA sits just above the caption block. */
function ctaBoxFor(safeArea: SafeAreaInsets): CropRect {
  const caption = captionBoxFor(safeArea);
  const height = 0.09;
  return {
    x: caption.x,
    y: Math.max(safeArea.top, caption.y - height - 0.02),
    width: caption.width,
    height,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clampFocus(focus: SubjectFocus): SubjectFocus {
  return { x: clamp(focus.x, 0, 1), y: clamp(focus.y, 0, 1) };
}

/** Converts a normalised crop to source pixels, for a renderer that needs them. */
export function cropToPixels(crop: CropRect, source: Dimensions): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  // Rounded to even numbers: most H.264 encoders reject odd dimensions or silently
  // pad them.
  const width = makeEven(Math.round(crop.width * source.width));
  const height = makeEven(Math.round(crop.height * source.height));

  // Origin and size are rounded independently, so `x + width` can land one pixel past
  // the source edge — which makes a renderer sample outside the frame and produce a
  // black column. Clamping the origin is what keeps the rectangle inside.
  const x = Math.min(Math.round(crop.x * source.width), Math.max(0, source.width - width));
  const y = Math.min(Math.round(crop.y * source.height), Math.max(0, source.height - height));

  return { x, y, width, height };
}

function makeEven(value: number): number {
  return value % 2 === 0 ? value : value - 1;
}

/**
 * Which ratios a given source can reach without an unacceptable crop.
 *
 * Used by the studio to show honestly which formats a piece of footage supports,
 * rather than offering all five and producing three bad ones.
 */
export function viableRatios(
  source: Dimensions,
  minimumRetainedArea = 0.5,
): readonly AspectRatio[] {
  const candidates: AspectRatio[] = ["9:16", "4:5", "1:1", "16:9", "4:3", "3:2"];
  return candidates.filter((ratio) => {
    const plan = planAdaptation({ source, targetRatio: ratio });
    return plan.retainedArea >= minimumRetainedArea;
  });
}
