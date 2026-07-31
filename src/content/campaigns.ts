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
  eyebrow: "CAMPAIGNS",
  title: "Every campaign, and where it has reached.",
  body: "A campaign moves through ten stages from brief to learning. This list shows where each one is, what it has produced and what is waiting on a person.",
  tableCaption: "Campaigns in this workspace",

  truncated: (shown: number, total: number) =>
    `Showing the ${shown} most recently updated of ${total.toLocaleString("en-US")}. Narrow the filters to find older campaigns.`,

  empty: {
    title: "No campaigns yet.",
    body: "A campaign starts from a brief — a few sentences about what you want and who it is for. Virally plans it first, so you see what will be produced and what it costs before anything is generated.",
  },

  noMatches: {
    title: "No campaigns match those filters.",
    body: "Nothing in this workspace matches the current combination. Clearing the filters will show everything again.",
  },
} as const;

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
