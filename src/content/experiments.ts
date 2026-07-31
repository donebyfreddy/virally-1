/**
 * Experiments copy.
 *
 * The result vocabulary is the important part of this file. The schema's
 * confidence enum ends at `enough_observations`, not `significant` — it refuses
 * to claim statistical significance, and this copy keeps that refusal. Virally
 * increases the number of legitimate variations you can test; it does not certify
 * a winner, and the words on this page must not imply otherwise.
 *
 * Consequences that follow, and that the page implements:
 *
 *   - No lift figure. A ratio between two measured sums is arithmetic the reader
 *     would take for a result, and `experiments` carries no baseline period,
 *     no variance and no sample-size record to qualify it with.
 *   - No progress bar against `min_observations`. That column has no unit in the
 *     schema, so a gauge drawn against it would be inventing one. The number is
 *     stated; the only bar on this page measures the test window, which is
 *     defined by two timestamps.
 *   - "Leading" rather than "winner", and only for the two confidence states that
 *     already assert a held direction.
 */

export const experimentsCopy = {
  title: "Experiments",
  body: "Each experiment holds one variable constant across its variants — a hook, a thumbnail, a posting time — so a difference in performance is attributable to that variable. Results report how much evidence exists, never a declared winner.",

  searchPlaceholder: "Search experiments",

  filters: {
    status: "Status",
    variable: "Variable",
    campaign: "Campaign",
  },

  kpis: {
    total: "Experiments",
    running: "Running",
    concluded: "Concluded",
    variants: "Variants",
  },

  /**
   * The three groups the list is split into.
   *
   * Grouped rather than sorted: "what is running" and "what finished" are read for
   * different reasons, and a single list ordered by date interleaves them.
   */
  groups: {
    active: {
      title: "Running",
      description: "Tests currently collecting observations, including paused ones.",
    },
    concluded: {
      title: "Concluded",
      description: "Tests that have stopped. The result state is what the evidence supported.",
    },
    draft: {
      title: "Not started",
      description: "Configured but never started, so nothing has been measured yet.",
    },
  },

  hypothesisLabel: "Hypothesis",

  fields: {
    primaryMetric: "Primary metric",
    secondaryMetric: "Secondary metric",
    variants: "Variants",
    minObservations: "Observation minimum",
    started: "Started",
    concluded: "Concluded",
    updated: "Updated",
    window: "Test window",
  },

  /** The variant-versus-variant comparison. */
  comparison: {
    heading: "Measured per variant",
    /** States exactly what the bars are made of, so no reader has to assume. */
    basis: "Summed from the newest metrics snapshot of each published post.",
    views: "Views",
    engagements: "Engagement",
    controlLabel: "Control",
    leadingLabel: "Leading",
    /** Only ever attached to a state that already asserts a held direction. */
    leadingExplains:
      "Ahead on the measure shown. Not a significance claim and not a declared winner.",
    unlinked: "No content variant linked yet",
    unpublished: "Nothing published yet",
    unreported: "Not reported",
    noVariants: "No variants defined for this experiment yet.",
    postCount: (posts: number) =>
      posts === 1 ? "1 published post" : `${posts.toLocaleString("en-US")} published posts`,
    /**
     * Said when the configured metric is not one of the two counters this page
     * aggregates. It states what is being shown rather than implying the
     * configured metric was measured.
     */
    metricMismatch: (configured: string, shown: string) =>
      `Configured primary metric: ${configured}. The bars below are measured in ${shown.toLowerCase()}, which is what this workspace aggregates per post.`,
  },

  window: {
    /** Used in the progress bar's accessible name, not rendered visually. */
    label: "Test window elapsed",
    /** A started test with no `ends_at`: there is no length to draw a bar against. */
    noEnd: "Started, with no end date set",
  },

  /** `min_observations` is nullable, and its unit is not defined by the schema. */
  noObservationTarget: "Not configured",

  /** `experiments.status`, in the order the filter offers them. */
  statuses: [
    { id: "running", label: "Running" },
    { id: "paused", label: "Paused" },
    { id: "concluded", label: "Concluded" },
    { id: "draft", label: "Draft" },
    { id: "abandoned", label: "Abandoned" },
  ],

  /** `experiments.variable` — the thing held constant across variants. */
  variables: [
    { id: "hook", label: "Hook" },
    { id: "first_frame", label: "First frame" },
    { id: "duration", label: "Duration" },
    { id: "caption", label: "Caption" },
    { id: "cta", label: "Call to action" },
    { id: "thumbnail", label: "Thumbnail" },
    { id: "voice", label: "Voice" },
    { id: "music", label: "Music" },
    { id: "platform", label: "Platform" },
    { id: "account", label: "Account" },
    { id: "posting_time", label: "Posting time" },
  ],

  empty: {
    title: "No experiments yet",
    body: "An experiment compares variants of the same content — different hooks, thumbnails or posting times — once those variants have published.",
  },

  noMatches: {
    title: "No experiments match those filters",
    body: "Nothing in this workspace matches the current combination.",
  },

  truncated: (shown: number, total: number) =>
    `Showing ${shown} of ${total.toLocaleString("en-US")}. Narrow the filters to find older experiments.`,
} as const;

/**
 * How each confidence state is presented.
 *
 * Every state carries a word and an icon as well as a tint, so the result is
 * legible without hue. Note that nothing here is coloured success-green except the
 * state that genuinely has enough data — "promising" stays informational, because
 * an early positive signal presented in green is read as a conclusion.
 *
 * `icon` is a key rather than a component: this file is data, and the page maps the
 * key to a real icon. Text glyphs were used here before; at 12px a "◐" is
 * indistinguishable from a rendering artefact.
 */
export type ConfidenceIcon = "collecting" | "partial" | "equal" | "rising" | "complete";

export const CONFIDENCE_PRESENTATION: Readonly<
  Record<
    string,
    {
      label: string;
      icon: ConfidenceIcon;
      /** Chip classes. Canonical tokens only, each pair measured for its floor. */
      classes: string;
      explains: string;
      /** Whether this state supports pointing at a leading variant. */
      allowsLeader: boolean;
    }
  >
> = {
  no_data: {
    label: "Collecting data",
    icon: "collecting",
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
    explains:
      "No observations recorded yet. Results appear once the variants have published and a metrics sync has run.",
    allowsLeader: false,
  },
  early_signal: {
    label: "Early signal",
    icon: "partial",
    classes: "bg-[var(--info-soft)] text-[color:var(--info)]",
    explains:
      "There is a difference between variants, but not enough observations to rely on it. Early signals reverse often.",
    allowsLeader: false,
  },
  inconclusive: {
    label: "Inconclusive",
    icon: "equal",
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
    explains:
      "The variants performed close enough that the difference is not attributable to the variable being tested.",
    allowsLeader: false,
  },
  promising: {
    label: "Promising",
    icon: "rising",
    classes: "bg-[var(--info-soft)] text-[color:var(--info)]",
    explains:
      "One variant is ahead and the trend has held. This is not a significance claim — treat it as a direction to test further, not a result.",
    allowsLeader: true,
  },
  enough_observations: {
    label: "Enough observations",
    icon: "complete",
    classes: "bg-[var(--success-soft)] text-[color:var(--success)]",
    explains:
      "The experiment reached its configured observation minimum. That means the measurement is stable, not that the result is statistically significant.",
    allowsLeader: true,
  },
};

/**
 * How each `experiments.status` value is presented.
 *
 * Only `running` is tinted. On a page of a dozen cards the one thing a reader
 * scans for is what is live, and tinting the other four spends the attention on
 * states that need none.
 */
export const EXPERIMENT_STATUS_PRESENTATION: Readonly<
  Record<string, { label: string; classes: string }>
> = {
  draft: {
    label: "Draft",
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-muted)]",
  },
  running: {
    label: "Running",
    classes: "bg-[var(--brand-soft)] text-[color:var(--brand-ink)]",
  },
  paused: {
    label: "Paused",
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  concluded: {
    label: "Concluded",
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-secondary)]",
  },
  abandoned: {
    label: "Abandoned",
    classes: "bg-[var(--surface-muted)] text-[color:var(--text-muted)]",
  },
};

export const VARIABLE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  experimentsCopy.variables.map((option) => [option.id, option.label]),
);

/**
 * Which stored counter an experiment's free-text primary metric corresponds to.
 *
 * `experiments.primary_metric` is `text`, written by whatever created the
 * experiment, so it cannot be trusted to name a column. This resolves the cases
 * that are unambiguous and returns null otherwise — and when it returns null the
 * page says which counter it is actually showing instead of quietly relabelling
 * one metric as another.
 */
export function resolvePrimaryMetric(metric: string): "views" | "engagements" | null {
  const normalised = metric.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (/\bviews?\b|\bplays?\b/.test(normalised)) return "views";
  if (/\bengagements?\b|\blikes?\b|\bcomments?\b|\bshares?\b|\bsaves?\b/.test(normalised)) {
    return "engagements";
  }
  return null;
}
