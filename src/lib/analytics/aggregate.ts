/**
 * Analytics aggregation.
 *
 * Two rules run through everything here:
 *
 * 1. `null` is not zero. Platforms expose different metric subsets, so a missing
 *    figure must stay missing all the way to the chart. Coercing it to 0 draws a line
 *    at the bottom of the graph and tells the user their content got no views, which
 *    is a different and false claim from "this platform does not report views".
 *
 * 2. No cross-platform normalisation without stated methodology. A TikTok view and a
 *    YouTube view are different events with different thresholds; summing them
 *    produces an authoritative-looking number that means nothing.
 */

export type MetricKey =
  | "views"
  | "reach"
  | "impressions"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "clicks"
  | "followersGained";

export type DailyPoint = {
  day: string;
  values: Partial<Record<MetricKey, number | null>>;
};

export type SeriesPoint = { day: string; value: number | null };

/**
 * A metric summed over a period.
 *
 * `coverage` is what makes the total interpretable: 3 of 30 days reporting is not the
 * same as 30 of 30, and a UI showing only the sum cannot tell the difference.
 */
export type MetricTotal = {
  key: MetricKey;
  /** Null when no day in the range reported the metric at all. */
  total: number | null;
  /** Days that reported a value. */
  reportingDays: number;
  /** Days in the range. */
  totalDays: number;
  /** True when at least one day is missing, so the total understates reality. */
  partial: boolean;
};

export function sumMetric(points: readonly DailyPoint[], key: MetricKey): MetricTotal {
  let total: number | null = null;
  let reportingDays = 0;

  for (const point of points) {
    const value = point.values[key];
    if (value === null || value === undefined) continue;
    total = (total ?? 0) + value;
    reportingDays += 1;
  }

  return {
    key,
    total,
    reportingDays,
    totalDays: points.length,
    partial: reportingDays > 0 && reportingDays < points.length,
  };
}

/**
 * Period-over-period comparison.
 *
 * Returns null rather than a percentage when the previous period reported nothing.
 * "Up 100%" from a base of zero is meaningless, and "up ∞%" is worse.
 */
export type Comparison = {
  current: number | null;
  previous: number | null;
  /** Absolute change, null when either side is unknown. */
  delta: number | null;
  /** Change in basis points, null when the previous value is zero or unknown. */
  deltaBp: number | null;
  direction: "up" | "down" | "flat" | "unknown";
};

export function compare(current: number | null, previous: number | null): Comparison {
  if (current === null || previous === null) {
    return { current, previous, delta: null, deltaBp: null, direction: "unknown" };
  }

  const delta = current - previous;

  // Growth from a zero base is not a percentage. Reporting the absolute change is
  // honest; reporting "+100%" or Infinity is not.
  const deltaBp = previous === 0 ? null : Math.round((delta / previous) * 10_000);

  return {
    current,
    previous,
    delta,
    deltaBp,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

/** Extracts one metric as a series, preserving gaps. */
export function toSeries(points: readonly DailyPoint[], key: MetricKey): readonly SeriesPoint[] {
  return points.map((point) => ({ day: point.day, value: point.values[key] ?? null }));
}

/**
 * Fills missing calendar days so a chart's x-axis is evenly spaced.
 *
 * Inserted days carry `null`, never 0 — the gap is preserved, only its position is
 * made explicit. A chart that silently omits days compresses a two-week gap into one
 * pixel and misrepresents the timeline.
 */
export function fillDayGaps(
  points: readonly DailyPoint[],
  startDay: string,
  endDay: string,
): readonly DailyPoint[] {
  const byDay = new Map(points.map((point) => [point.day, point]));
  const filled: DailyPoint[] = [];

  const start = Date.parse(`${startDay}T00:00:00Z`);
  const end = Date.parse(`${endDay}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return points;

  for (let time = start; time <= end; time += 86_400_000) {
    const day = new Date(time).toISOString().slice(0, 10);
    filled.push(byDay.get(day) ?? { day, values: {} });
  }

  return filled;
}

// --- Rates -------------------------------------------------------------------

/**
 * Engagement rate in basis points.
 *
 * Returns null when the denominator is missing or zero rather than 0: "0% engagement"
 * asserts nobody engaged, while a missing denominator means we cannot tell.
 */
export function engagementRateBp(
  engagements: number | null,
  denominator: number | null,
): number | null {
  if (engagements === null || denominator === null || denominator <= 0) return null;
  return Math.round((engagements / denominator) * 10_000);
}

export function formatBp(bp: number | null, fractionDigits = 2): string {
  if (bp === null) return "—";
  return `${(bp / 100).toFixed(fractionDigits)}%`;
}

/** Formats a possibly-missing count. Never renders a missing value as "0". */
export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US");
}

/** Compact form for KPI tiles. */
export function formatCompact(value: number | null): string {
  if (value === null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}

// --- Funnel ------------------------------------------------------------------

export type FunnelStage = {
  id: string;
  label: string;
  count: number | null;
  /** Share of the previous stage, in basis points. Null at the top or when unknown. */
  conversionBp: number | null;
};

/**
 * Builds the content funnel.
 *
 * A funnel stage that is `null` breaks the chain: every downstream conversion becomes
 * null too, because a ratio against an unknown base is not computable. Carrying the
 * last known value forward would silently overstate conversion.
 */
export function buildFunnel(
  stages: readonly { id: string; label: string; count: number | null }[],
): readonly FunnelStage[] {
  return stages.map((stage, index) => {
    if (index === 0) return { ...stage, conversionBp: null };
    const previous = stages[index - 1]?.count ?? null;
    return {
      ...stage,
      conversionBp:
        stage.count === null || previous === null || previous === 0
          ? null
          : Math.round((stage.count / previous) * 10_000),
    };
  });
}

// --- Heatmap -----------------------------------------------------------------

export type HeatmapCell = {
  /** 0 = Sunday, matching Date#getUTCDay. */
  dayOfWeek: number;
  hour: number;
  postCount: number;
  /** Null when no post in this cell reported the metric. */
  averageValue: number | null;
};

/**
 * Posting-time heatmap.
 *
 * `postCount` is reported alongside the average because a cell built from one post is
 * not evidence. A heatmap that colours a single lucky post as the best hour to post is
 * actively misleading, so the UI must be able to suppress or mark thin cells.
 */
export function buildHeatmap(
  posts: readonly { publishedAt: Date; value: number | null }[],
): readonly HeatmapCell[] {
  const cells = new Map<string, { count: number; sum: number; reporting: number }>();

  for (const post of posts) {
    const dayOfWeek = post.publishedAt.getUTCDay();
    const hour = post.publishedAt.getUTCHours();
    const key = `${dayOfWeek}:${hour}`;
    const existing = cells.get(key) ?? { count: 0, sum: 0, reporting: 0 };
    cells.set(key, {
      count: existing.count + 1,
      sum: existing.sum + (post.value ?? 0),
      reporting: existing.reporting + (post.value === null ? 0 : 1),
    });
  }

  const result: HeatmapCell[] = [];
  for (const [key, value] of cells) {
    const [dayPart, hourPart] = key.split(":");
    result.push({
      dayOfWeek: Number(dayPart),
      hour: Number(hourPart),
      postCount: value.count,
      averageValue: value.reporting === 0 ? null : Math.round(value.sum / value.reporting),
    });
  }

  return result.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hour - b.hour);
}

/** Minimum observations before a heatmap cell is worth acting on. */
export const HEATMAP_MIN_OBSERVATIONS = 3;

// --- Confidence --------------------------------------------------------------

export type ConfidenceState =
  | "no_data"
  | "early_signal"
  | "inconclusive"
  | "promising"
  | "enough_observations";

/**
 * Classifies how much weight an observation deserves.
 *
 * Deliberately NOT a significance test. The brief forbids claiming statistical
 * significance without implementing a correct method, so this reports observation
 * volume and effect size in plain language and never emits a p-value.
 *
 * The thresholds are conventions for this product, not derived from a power
 * calculation — which is exactly why the vocabulary avoids implying certainty.
 */
export function classifyConfidence(options: {
  observations: number;
  /** Relative difference between variants in basis points, when comparing. */
  effectBp?: number | null;
}): ConfidenceState {
  if (options.observations === 0) return "no_data";
  if (options.observations < 10) return "early_signal";

  const effect = options.effectBp ?? null;
  if (effect === null) return options.observations >= 100 ? "enough_observations" : "inconclusive";

  // A large effect on a moderate sample is worth calling promising; a small effect on
  // the same sample is noise.
  if (Math.abs(effect) >= 2000 && options.observations >= 30) return "promising";
  if (options.observations >= 100) return "enough_observations";
  return "inconclusive";
}

export const CONFIDENCE_COPY: Readonly<Record<ConfidenceState, string>> = {
  no_data: "No data yet.",
  early_signal: "Early signal — too few observations to draw a conclusion.",
  inconclusive: "Inconclusive so far. The difference is not clearly larger than normal variation.",
  promising: "Promising. The difference is large, though more observations would confirm it.",
  enough_observations:
    "Enough observations to compare, using this product's own thresholds rather than a significance test.",
};

/** The exact wording the brief requires when a recommendation cannot be grounded. */
export const INSUFFICIENT_DATA_COPY =
  "Not enough data to make a reliable recommendation." as const;

// --- Date ranges -------------------------------------------------------------

export type RangePreset = "7d" | "30d" | "90d" | "custom";

/**
 * Resolves a preset to an inclusive day range, plus the preceding comparison window
 * of equal length so period-over-period figures compare like with like.
 */
export function resolveRange(
  preset: RangePreset,
  today: Date,
  custom?: { start: string; end: string },
): { start: string; end: string; previousStart: string; previousEnd: string; days: number } {
  const toDay = (date: Date) => date.toISOString().slice(0, 10);

  if (preset === "custom" && custom) {
    const start = Date.parse(`${custom.start}T00:00:00Z`);
    const end = Date.parse(`${custom.end}T00:00:00Z`);
    const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
    return {
      start: custom.start,
      end: custom.end,
      previousStart: toDay(new Date(start - days * 86_400_000)),
      previousEnd: toDay(new Date(start - 86_400_000)),
      days,
    };
  }

  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const endMs = Date.parse(`${toDay(today)}T00:00:00Z`);
  const startMs = endMs - (days - 1) * 86_400_000;

  return {
    start: toDay(new Date(startMs)),
    end: toDay(new Date(endMs)),
    previousStart: toDay(new Date(startMs - days * 86_400_000)),
    previousEnd: toDay(new Date(startMs - 86_400_000)),
    days,
  };
}

/**
 * Cost per thousand views.
 *
 * Null below a minimum view count: a CPM computed from 4 views is a number with no
 * meaning, and showing it invites decisions based on nothing.
 */
export const MIN_VIEWS_FOR_CPM = 1000;

export function costPerMilleCents(costCents: number, views: number | null): number | null {
  if (views === null || views < MIN_VIEWS_FOR_CPM) return null;
  return Math.round((costCents / views) * 1000);
}
