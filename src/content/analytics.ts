/**
 * ANALYTICS COPY.
 *
 * The page renders real aggregates only, so most of the strings here exist to
 * explain an ABSENCE: which table a figure comes from, why a panel is missing,
 * and what will populate it. §16's honesty rules make those sentences part of the
 * design rather than filler — a chart of plausible sample numbers would be a
 * worse product than a stated gap.
 *
 * Two panels the analytics brief lists are deliberately absent, and the reason is
 * recorded next to the copy rather than in a commit message:
 *
 *   - A weekday × hour publishing heatmap. `analytics_daily` is keyed on `day`
 *     with no hour dimension, and `content_metrics.captured_at` is the hour the
 *     metrics SYNC ran, not the hour the post went out. An hour axis would have
 *     to be invented. What IS supported is the day grid below: one cell per day,
 *     from `analytics_daily.posts_published`.
 *   - Cost-performance analysis. Every cost column in the schema
 *     (`generation_runs.cost_cents`, `provider_runs.actual_internal_cents`,
 *     `usage_events.provider_cost_cents`, `campaigns.actual_cost_cents`) is
 *     internal provider cost — our margin, not the customer's price — and
 *     `src/lib/creative/usage.ts` keeps it off customer surfaces on purpose. The
 *     customer-facing unit is credits, and `credit_ledger` is scoped to the
 *     ORGANISATION with no workspace, campaign or content attribution, so
 *     credits cannot be divided by workspace-scoped views without misattributing
 *     spend from every other workspace in the organisation.
 */

export const RANGE_OPTIONS: readonly { id: string; label: string; days: number }[] = [
  { id: "7", label: "7 days", days: 7 },
  { id: "28", label: "28 days", days: 28 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "12 months", days: 365 },
];

export const DEFAULT_RANGE_DAYS = 28;

export const analyticsCopy = {
  title: "Analytics",
  body: "Reach, engagement and retention across every connected account. Figures come from each platform's own reporting, synced on a schedule, so they lag the platform's live dashboard slightly and never exceed it.",

  rangeLabel: (days: number) => (days === 365 ? "Last 12 months" : `Last ${days} days`),
  comparisonLabel: (days: number) => `vs previous ${days} days`,

  empty: {
    title: "No performance data yet",
    body: "Analytics appear once content has been published to a connected account and a metrics sync has run.",
  },

  kpis: {
    views: "Views",
    reach: "Reach",
    engagements: "Engagements",
    followers: "Followers gained",
    posts: "Posts published",
    completion: "Avg completion",
  },

  /**
   * Only the completion tile carries a caption.
   *
   * `KpiCard` has one slot under the figure and the other five tiles spend it on
   * their period delta, which is the more useful fact. Completion has no delta —
   * an em dash cannot be compared with anything — so its slot says why instead.
   */
  completionExplains: "Share of the video watched, averaged.",
  completionMissing: "No platform reported a completion rate.",

  noPrior: "no prior data",

  performance: {
    heading: "Performance over time",
    note: "One point per day the rollup holds. A missing day is a day the sync has not covered, not a zero.",
  },

  engagement: {
    heading: "Engagement rate",
    note: "Averaged per day across the accounts in scope, as reported by each platform.",
    missing:
      "No day in this range carries an engagement rate. Platforms report it per post, and the rollup stores it once at least one synced post has one.",
  },

  cadence: {
    heading: "Publishing cadence",
    note: "One cell per day, each showing its exact count. A cell with no rollup row is a day the sync has not covered — it is not a day with zero posts.",
    caption: "Posts published per day",
    /**
     * Three states, not a five-step colour ramp.
     *
     * Every cell prints its exact number, so the tint only has to separate
     * "published", "published nothing" and "no data" — and those are the only
     * three backgrounds in the token set whose text pairing is measured
     * (`--brand-ink` on `--brand-soft` is 4.80:1; `--text-muted` on
     * `--surface-muted` is 4.67:1). A denser ramp would need a sequential scale
     * with measured ink for each step, which the palette does not have yet.
     */
    legendNone: "No data for that day",
    legendZero: "Nothing published",
    legendSome: "Posts published",
    hourNote:
      "There is no hour-of-day view. The rollup is keyed on the day, and the metrics capture time is when the sync ran rather than when the post went out — so a best-time-to-post grid would have to invent its own hour axis.",
  },

  platforms: {
    heading: "Platform comparison",
    tableCaption: "Views, reach, engagement and growth by platform",
    empty: "No per-platform data in this range.",
    columns: {
      platform: "Platform",
      posts: "Posts",
      views: "Views",
      reach: "Reach",
      engagements: "Engagements",
      followers: "Followers",
      perPost: "Views / post",
    },
  },

  accounts: {
    heading: "Account comparison",
    note: "Lifetime totals taken from each post's most recent metrics snapshot, so the date range above does not narrow this panel.",
    empty:
      "No per-account data yet. Account performance is attributed once published posts have been synced.",
    /**
     * A table rather than bars, because every measure here is nullable. A bar
     * cannot render "not reported" — it would draw a zero-length bar, which reads
     * as a measured zero.
     */
    columns: {
      account: "Account",
      posts: "Posts",
      views: "Views",
      engagements: "Engagements",
    },
  },

  content: {
    heading: "Best-performing content",
    note: "Ranked by views from each post's most recent metrics snapshot. Lifetime, not range-scoped.",
    tableCaption: "Published posts ranked by views",
    empty:
      "No published post has metrics yet. A post appears here after its first metrics sync.",
    columns: {
      title: "Content",
      views: "Views",
      engagements: "Engagements",
      completion: "Completion",
    },
    capped: (shown: number) => `The ${shown} highest-viewed posts. Others are not shown.`,
  },

  retention: {
    heading: "Retention",
    /**
     * Retention deliberately reports its own absence rather than drawing an
     * averaged curve. A retention curve is per-post; averaging across posts that
     * have no samples would produce a plausible shape with nothing behind it.
     */
    none: "Retention needs a per-post watch curve, which platforms return only for video posts once they have enough views. No post in this workspace has one yet.",
    pending: (count: number) =>
      `${count.toLocaleString("en-US")} ${count === 1 ? "post has" : "posts have"} a stored watch curve. It is drawn on the post itself rather than here, because averaging curves across posts with different sample counts produces a shape nothing measured.`,
  },

  /** Nullable metric fallback: an em dash on screen, this for a screen reader. */
  notReported: "Not reported",
  /** Distinct from the above: the measure is defined, the divisor is zero. */
  notApplicable: "Not applicable",

  /**
   * `analytics_daily.origin` separates demo rollups from real ones. They are not
   * filtered out — a demo workspace with every row hidden would show an empty
   * page and look broken — but they are never passed off as platform-reported
   * figures either.
   */
  demoNotice:
    "Some rows in this range were rolled up from demo or uploaded content rather than from a platform sync, and are included in the figures below.",

  rangeEmpty: {
    title: "No rollup rows in this range",
    body: "Nothing was synced for these dates. Widen the range, or clear the platform filter.",
  },

  gate: {
    title: "Not available to your role",
    body: "Viewing analytics requires the analytics.view permission. An administrator can change this from the Team page.",
  },
} as const;
