/**
 * Overview copy.
 *
 * Every "nothing here yet" string says what will populate the panel and why it
 * is currently empty. That is the difference between a page that reads as new
 * and one that reads as broken — and on this product most panels are legitimately
 * empty until a metrics sync has run, so these strings do real work.
 */
export const overviewCopy = {
  eyebrow: "OVERVIEW",

  windowLabel: (days: number) => `LAST ${days} DAYS`,

  empty: {
    title: "Your content operation is ready.",
    body: "Nothing has been created yet, so there is no performance data to show. Create a campaign, connect a channel, or upload footage you already have.",
  },

  noPerformance:
    "Views, engagement and follower growth appear here once content has been published to a connected account and a metrics sync has run. Nothing is charted yet — a chart filled with sample numbers would misrepresent an account that has published nothing.",

  noPlatformData:
    "Platform distribution needs at least one published post with a metrics sync behind it.",

  noQueue:
    "Nothing is scheduled. Approved content can be scheduled from the calendar or from a campaign.",

  noJobs: "No generation is running or queued.",
} as const;
