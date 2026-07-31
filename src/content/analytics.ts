/**
 * Analytics copy.
 */

export const RANGE_OPTIONS: readonly { id: string; label: string; days: number }[] = [
  { id: "7", label: "7 days", days: 7 },
  { id: "28", label: "28 days", days: 28 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "12 months", days: 365 },
];

export const analyticsCopy = {
  eyebrow: "ANALYTICS",
  title: "What the content actually did.",
  body: "Reach, engagement and retention across every connected account. Figures come from each platform's own reporting, synced on a schedule — so they lag the platform's live dashboard slightly and will never exceed it.",

  empty: {
    title: "No performance data yet.",
    body: "Analytics appear once content has been published to a connected account and a metrics sync has run. Nothing is charted before then, because a chart of sample numbers would misrepresent an account that has published nothing.",
  },

  noPlatformData: "No per-platform data in this range.",
  noAccountData:
    "No per-account data yet. Account performance is attributed once published posts have been synced.",

  /**
   * Retention deliberately reports its own absence rather than drawing an
   * averaged curve. A retention curve is per-post; averaging across posts that
   * have no samples would produce a plausible shape with nothing behind it.
   */
  noRetention:
    "Retention needs a per-post watch curve, which platforms return only for video posts once they have enough views. No post in this workspace has one yet.",

  retentionPending: (count: number) =>
    `${count.toLocaleString("en-US")} ${count === 1 ? "post has" : "posts have"} a stored retention curve. The curve chart is part of the analytics phase and is not rendered yet — the data is captured and will not need re-syncing.`,
} as const;
