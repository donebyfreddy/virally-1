/**
 * The Multiplier's arithmetic.
 *
 * A pure function with no server, no fixtures and no invented data: every
 * figure the section displays is derived here from the visitor's own control
 * settings. If a number appears on screen it can be reproduced by hand.
 *
 * The model, stated plainly so the UI can explain itself:
 *
 *   scripts       = concepts × hooks per concept
 *   localisations = scripts × languages
 *   assets        = localisations × formats
 *   posts         = assets                      (one scheduled post per asset)
 *   per account   = ceil(posts ÷ accounts)
 *   days          = ceil(posts ÷ (accounts × posts per account per day))
 */

export const FORMAT_KEYS = ["9:16", "4:5", "1:1", "16:9", "4:3"] as const;
export type FormatKey = (typeof FORMAT_KEYS)[number];

export const LIMITS = {
  concepts: { min: 1, max: 8 },
  hooksPerConcept: { min: 1, max: 6 },
  languages: { min: 1, max: 3 },
  accounts: { min: 1, max: 24 },
} as const;

/** Publishing cadence used for the "days to publish" figure. */
export const POSTS_PER_ACCOUNT_PER_DAY = 3;

export type MultiplierState = {
  concepts: number;
  hooksPerConcept: number;
  formats: readonly FormatKey[];
  languages: number;
  accounts: number;
};

export type MultiplierResult = {
  briefs: 1;
  concepts: number;
  hooks: number;
  scripts: number;
  localisations: number;
  formats: number;
  assets: number;
  accounts: number;
  posts: number;
  postsPerAccount: number;
  daysToPublish: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Coerces any state into the supported range before computing. */
export function normaliseState(state: MultiplierState): MultiplierState {
  const formats = FORMAT_KEYS.filter((f) => state.formats.includes(f));
  return {
    concepts: clamp(state.concepts, LIMITS.concepts.min, LIMITS.concepts.max),
    hooksPerConcept: clamp(
      state.hooksPerConcept,
      LIMITS.hooksPerConcept.min,
      LIMITS.hooksPerConcept.max,
    ),
    // At least one format must remain selected, or the campaign produces
    // nothing and every downstream figure collapses to zero.
    formats: formats.length > 0 ? formats : [FORMAT_KEYS[0]],
    languages: clamp(state.languages, LIMITS.languages.min, LIMITS.languages.max),
    accounts: clamp(state.accounts, LIMITS.accounts.min, LIMITS.accounts.max),
  };
}

export function computeCampaign(input: MultiplierState): MultiplierResult {
  const state = normaliseState(input);

  const hooks = state.concepts * state.hooksPerConcept;
  const scripts = hooks;
  const localisations = scripts * state.languages;
  const formats = state.formats.length;
  const assets = localisations * formats;
  const posts = assets;
  const postsPerAccount = Math.ceil(posts / state.accounts);
  const daysToPublish = Math.ceil(
    posts / (state.accounts * POSTS_PER_ACCOUNT_PER_DAY),
  );

  return {
    briefs: 1,
    concepts: state.concepts,
    hooks,
    scripts,
    localisations,
    formats,
    assets,
    accounts: state.accounts,
    posts,
    postsPerAccount,
    daysToPublish,
  };
}

/* ------------------------------------------------------------------ graph */

export type GraphNode = {
  id: string;
  label: string;
  detail?: string;
  /** Set when this node stands in for several collapsed siblings. */
  aggregatedCount?: number;
};

export type GraphColumn = {
  id: string;
  label: string;
  nodes: readonly GraphNode[];
};

export type CampaignGraph = {
  columns: readonly GraphColumn[];
  /** True when any column was collapsed to keep the drawing legible. */
  aggregated: boolean;
  totalNodes: number;
};

/** Above these counts a column collapses into per-parent cluster nodes. */
export const OUTPUT_RENDER_LIMIT = 24;
export const ACCOUNT_RENDER_LIMIT = 12;

/**
 * Builds the drawable graph. The arithmetic above is always exact; only the
 * *drawing* aggregates, so a collapsed column never changes a displayed total.
 */
export function buildGraph(input: MultiplierState): CampaignGraph {
  const state = normaliseState(input);
  const result = computeCampaign(state);

  const conceptNodes: GraphNode[] = Array.from(
    { length: state.concepts },
    (_, i) => ({
      id: `concept-${i + 1}`,
      label: `Concept ${i + 1}`,
      detail: `${state.hooksPerConcept} hook${state.hooksPerConcept === 1 ? "" : "s"}`,
    }),
  );

  const outputTotal = result.assets;
  const outputAggregated = outputTotal > OUTPUT_RENDER_LIMIT;

  const outputNodes: GraphNode[] = outputAggregated
    ? conceptNodes.map((concept, i) => ({
        id: `outputs-${i + 1}`,
        label: `${Math.round(outputTotal / state.concepts)} assets`,
        detail: concept.label,
        aggregatedCount: Math.round(outputTotal / state.concepts),
      }))
    : Array.from({ length: outputTotal }, (_, i) => {
        const format = state.formats[i % state.formats.length];
        const conceptIndex = Math.floor(i / (outputTotal / state.concepts)) + 1;
        return {
          id: `output-${i + 1}`,
          label: format,
          detail: `Concept ${Math.min(conceptIndex, state.concepts)}`,
        };
      });

  const accountAggregated = state.accounts > ACCOUNT_RENDER_LIMIT;
  const accountNodes: GraphNode[] = accountAggregated
    ? [
        {
          id: "accounts-all",
          label: `${state.accounts} accounts`,
          detail: `${result.postsPerAccount} posts each`,
          aggregatedCount: state.accounts,
        },
      ]
    : Array.from({ length: state.accounts }, (_, i) => ({
        id: `account-${i + 1}`,
        label: `Account ${i + 1}`,
        detail: `${result.postsPerAccount} posts`,
      }));

  const columns: GraphColumn[] = [
    { id: "brief", label: "Brief", nodes: [{ id: "brief", label: "1 brief" }] },
    { id: "concepts", label: "Concepts", nodes: conceptNodes },
    { id: "outputs", label: "Assets", nodes: outputNodes },
    { id: "accounts", label: "Accounts", nodes: accountNodes },
  ];

  return {
    columns,
    aggregated: outputAggregated || accountAggregated,
    totalNodes: columns.reduce((sum, c) => sum + c.nodes.length, 0),
  };
}

/**
 * Chosen to land at 18 assets — below the aggregation limit, so a visitor's
 * first look is at individually drawn nodes rather than cluster counts. Every
 * control still has visible headroom in both directions.
 */
export const DEFAULT_MULTIPLIER_STATE: MultiplierState = {
  concepts: 3,
  hooksPerConcept: 2,
  formats: ["9:16", "4:5", "16:9"],
  languages: 1,
  accounts: 6,
};
