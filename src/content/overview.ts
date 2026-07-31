/**
 * Overview copy.
 *
 * Every "nothing here yet" string says what will populate the panel and why it is
 * currently empty. That is the difference between a page that reads as new and one
 * that reads as broken — and on this product most panels are legitimately empty
 * until a metrics sync has run, so these strings do real work.
 *
 * They are also deliberately SHORTER than the first version. A dashboard card is
 * 200px wide; a four-line paragraph explaining the epistemics of sample data was
 * longer than the card it sat in. The reasoning is right, the placement was not.
 */
export const overviewCopy = {
  title: "Overview",
  body: "What is happening, what needs attention, and what is scheduled next.",

  windowLabel: (days: number) => `Last ${days} days`,

  empty: {
    title: "Your content operation is ready",
    body: "Nothing has been created yet, so there is no performance data to show.",
  },

  noPerformance:
    "Views and engagement appear here once content has published to a connected account and a metrics sync has run.",

  noPlatformData: "Needs at least one published post with a metrics sync behind it.",

  noQueue: "Nothing is scheduled. Approved content can be scheduled from the calendar.",

  noJobs: "No generation is running or queued.",

  noAccounts: "No accounts connected yet.",

  sections: {
    performance: "Performance",
    platforms: "Platform performance",
    queue: "Publishing queue",
    generation: "Generation activity",
    funnel: "Content funnel",
    activity: "Recent activity",
    credits: "Production credits",
    accounts: "Account health",
  },

  kpis: {
    views: "Total views",
    posts: "Published posts",
    engagement: "Engagement rate",
    followers: "Followers gained",
    campaigns: "Active campaigns",
    accounts: "Connected accounts",
  },

  setupHeading: "Set up your operation",
  setupBody: "Three steps to a working content supply chain. Each one is checked automatically.",
} as const;

/**
 * First-run checklist.
 *
 * Shown under the overview's empty state so a new workspace has something to DO
 * on the page rather than a compact empty state above a screen and a half of
 * nothing. Each step's completion is read from real workspace state — a checklist
 * that ticks itself once the work is genuinely done, not a static graphic.
 *
 * Ordered by dependency, not by importance: content cannot publish without an
 * authorised account, so connecting one comes before scheduling even though
 * creating a campaign is the more appealing first click.
 */
export type SetupStep = {
  id: "campaign" | "account" | "schedule";
  title: string;
  body: string;
  action: string;
  href: string;
};

export const setupSteps: readonly SetupStep[] = [
  {
    id: "campaign",
    title: "Create a campaign",
    body: "Describe what you want in a few sentences. Virally plans it before generating, so you see the cost first.",
    action: "New campaign",
    href: "/app/create",
  },
  {
    id: "account",
    title: "Connect an account",
    body: "Authorise the accounts you publish to. Nothing is posted without an explicit schedule.",
    action: "Connect",
    href: "/app/accounts",
  },
  {
    id: "schedule",
    title: "Schedule the first post",
    body: "Approved variants are assigned to an account and a time on the calendar.",
    action: "Open calendar",
    href: "/app/calendar",
  },
] as const;
