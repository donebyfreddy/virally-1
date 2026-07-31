/**
 * Campaigns copy and the pipeline vocabulary.
 *
 * `STAGE_LABELS` is the single place a `campaign_stage` enum value becomes
 * human-readable. The campaign list, the campaign detail pipeline and the
 * command palette all read it, so the word a user learns on one surface is the
 * same word on the next.
 */

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  brief: "Brief",
  concepts: "Concepts",
  scripts: "Scripts",
  storyboards: "Storyboards",
  assets: "Assets",
  editing: "Editing",
  approval: "Review",
  schedule: "Schedule",
  publish: "Publish",
  learn: "Learn",
};

/** The pipeline in order, so the detail page never hardcodes the sequence. */
export const STAGE_ORDER = [
  "brief",
  "concepts",
  "scripts",
  "storyboards",
  "assets",
  "editing",
  "approval",
  "schedule",
  "publish",
  "learn",
] as const;

export const campaignsCopy = {
  // A page title, not a statement. The old headline ("Every campaign, and where
  // it has reached.") was a marketing sentence set at 44px above an empty table.
  title: "Campaigns",
  body: "Plan, generate and track every content campaign.",
  tableCaption: "Campaigns in this workspace",
  gridLabel: "Campaigns",

  truncated: (shown: number, total: number) =>
    `Showing the ${shown} most recently updated of ${total.toLocaleString("en-US")}. Narrow the filters to find older campaigns.`,

  empty: {
    title: "No campaigns yet",
    // One sentence. The explanation of how planning works belongs on the Create
    // page, where the user is about to do it — not in the empty state, which they
    // are trying to get past.
    body: "Create your first campaign from a prompt, a URL or an uploaded source.",
  },

  noMatches: {
    title: "No campaigns match those filters",
    body: "Nothing in this workspace matches the current combination.",
  },

  /** KPI strip above the list. Labels only — every figure is queried. */
  kpis: {
    total: "Total campaigns",
    active: "Active",
    review: "Awaiting review",
    scheduled: "Scheduled content",
    credits: "Credits used this month",
  },

  onboardingHeading: "Start from a worked example",
  onboardingBody:
    "Each template is a filled-in brief. Open one, change the parts that are wrong, and generate.",
} as const;

/**
 * Quick-start templates shown under the empty state.
 *
 * These are the onboarding content the empty state deliberately makes room for.
 * The most common reason a new user stalls on this product is not knowing what a
 * good brief looks like, and a worked example answers that faster than any amount
 * of help text.
 *
 * Each one deep-links into /app/create with the brief prefilled, so the template
 * is a starting point the user edits rather than a preset they must accept. The
 * `outputs` line is honest about volume, because the estimate the Create page
 * shows is what actually governs the credit spend.
 */
export type CampaignTemplate = {
  id: string;
  name: string;
  summary: string;
  /** Pipeline shape in plain words — what this template actually produces. */
  outputs: string;
  href: string;
};

export const campaignTemplates: readonly CampaignTemplate[] = [
  {
    id: "product-launch",
    name: "Product launch",
    summary: "Announce one product across short video and stills, with three hook variants.",
    outputs: "3 concepts · 9 clips · 4 platform variants",
    href: "/app/create?template=product-launch",
  },
  {
    id: "url-to-reels",
    name: "URL to reels",
    summary: "Turn a blog post or landing page into a week of vertical video.",
    outputs: "5 concepts · 15 clips · 3 platform variants",
    href: "/app/create?template=url-to-reels",
  },
  {
    id: "hook-test",
    name: "Hook test",
    summary: "One script, six openings, so the first three seconds are the only variable.",
    outputs: "1 concept · 6 clips · 1 platform variant",
    href: "/app/create?template=hook-test",
  },
  {
    id: "evergreen-series",
    name: "Evergreen series",
    summary: "A recurring format scheduled across a month, from a single brief.",
    outputs: "4 concepts · 12 clips · scheduled weekly",
    href: "/app/create?template=evergreen-series",
  },
] as const;

export const campaignDetailCopy = {
  eyebrow: "CAMPAIGN",
  pipelineHeading: "Pipeline",
  pipelineHint:
    "Each stage is a separate, retryable step. A blocked stage always carries the reason it stopped.",
  outputHeading: "What this campaign has produced",
  conceptsHeading: "Concepts and hooks",
  activityHeading: "Recent activity",
  creditsHeading: "Credit usage",
  destinationsHeading: "Publishing destinations",

  notFound: {
    title: "That campaign could not be found.",
    body: "It may have been deleted, or it may belong to a different workspace. Nothing has been changed.",
  },

  noConcepts:
    "No concepts have been generated yet. The concepts stage produces them from the brief.",
  noContent:
    "No content items exist yet. Content is created once scripts and assets have been generated.",
  noDestinations:
    "No publishing destinations yet. Approved variants are assigned to connected accounts at the schedule stage.",
  noActivity: "No activity recorded for this campaign yet.",
} as const;
