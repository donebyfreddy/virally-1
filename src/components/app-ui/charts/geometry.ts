/**
 * Chart geometry.
 *
 * Pure functions, no React and no DOM, so the scales can be unit-tested and so
 * a server component can compute a path without pulling a charting library into
 * the client bundle. Nothing here reads a token — colour is applied by the
 * component, geometry is applied here.
 */

export type Point = { x: number; y: number };

export type Series = {
  /** Stable identity. Colour is assigned from this, never from array position. */
  id: string;
  label: string;
  points: readonly Point[];
};

export type Plot = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
};

export type Scale = {
  x: (value: number) => number;
  y: (value: number) => number;
  domain: { minX: number; maxX: number; minY: number; maxY: number };
  inner: { width: number; height: number; left: number; top: number };
};

/**
 * Builds the value → pixel mapping.
 *
 * The y domain always starts at zero for count and rate measures. A truncated
 * baseline exaggerates variation — a 2% change looks like a collapse — and this
 * chart system is used for performance reporting where that would be actively
 * misleading. Callers needing a non-zero floor must say so explicitly.
 */
export function buildScale(
  series: readonly Series[],
  plot: Plot,
  options: { zeroBaseline?: boolean } = {},
): Scale {
  const { zeroBaseline = true } = options;
  const all = series.flatMap((s) => s.points);

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);

  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const maxX = xs.length > 0 ? Math.max(...xs) : 1;
  const rawMinY = ys.length > 0 ? Math.min(...ys) : 0;
  const rawMaxY = ys.length > 0 ? Math.max(...ys) : 1;

  const minY = zeroBaseline ? Math.min(0, rawMinY) : rawMinY;
  // A flat series would otherwise produce a zero-height domain and divide by
  // zero; giving it a nominal top draws the line along the baseline instead.
  const maxY = rawMaxY === minY ? minY + 1 : rawMaxY;

  const left = plot.padding.left;
  const top = plot.padding.top;
  const width = Math.max(1, plot.width - plot.padding.left - plot.padding.right);
  const height = Math.max(1, plot.height - plot.padding.top - plot.padding.bottom);

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  return {
    x: (value) => left + ((value - minX) / spanX) * width,
    y: (value) => top + height - ((value - minY) / spanY) * height,
    domain: { minX, maxX, minY, maxY },
    inner: { width, height, left, top },
  };
}

/** A polyline path. Straight segments — a smoothed curve invents data points. */
export function linePath(points: readonly Point[], scale: Scale): string {
  if (points.length === 0) return "";
  return points
    .map((p, index) => `${index === 0 ? "M" : "L"}${scale.x(p.x).toFixed(2)},${scale.y(p.y).toFixed(2)}`)
    .join(" ");
}

/** The same path closed to the baseline, for an area fill under a line. */
export function areaPath(points: readonly Point[], scale: Scale): string {
  if (points.length === 0) return "";
  const baseline = scale.y(Math.max(0, scale.domain.minY));
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  return [
    linePath(points, scale),
    `L${scale.x(last.x).toFixed(2)},${baseline.toFixed(2)}`,
    `L${scale.x(first.x).toFixed(2)},${baseline.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/**
 * Y-axis tick values.
 *
 * Rounded to a human step (1/2/5 × a power of ten) rather than dividing the
 * range into equal parts, which produces axis labels like "3,847".
 */
export function yTicks(scale: Scale, count = 4): readonly number[] {
  const { minY, maxY } = scale.domain;
  const rawStep = (maxY - minY) / count;
  if (rawStep <= 0) return [minY];

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const niceStep = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  const ticks: number[] = [];
  for (let value = Math.ceil(minY / niceStep) * niceStep; value <= maxY; value += niceStep) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks.length > 0 ? ticks : [minY, maxY];
}

/**
 * The index of the point nearest a pixel x — the crosshair's lookup.
 *
 * Nearest by x only, not euclidean distance: the crosshair reports "the value at
 * this moment in time", so a pointer high above a low point should still select
 * that point's column.
 */
export function nearestIndex(
  points: readonly Point[],
  pixelX: number,
  scale: Scale,
): number {
  if (points.length === 0) return -1;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.abs(scale.x(point.x) - pixelX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
