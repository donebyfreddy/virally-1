export type UseCase = {
  id: string;
  role: string;
  value: string;
  workflow: readonly string[];
  exampleCampaign: string;
  /** Interface preview rows — what this role's workspace emphasises. */
  preview: readonly { label: string; value: string }[];
  conversionMessage: string;
};

export const useCases = {
  id: "use-cases",
  eyebrow: "Who it is for",
  headline: "Pick the shape of your operation.",
  body: "The pipeline is the same. What changes is how many brands, languages and approvals sit on top of it.",
  selectorLabel: "Role",
} as const;

export const roles: readonly UseCase[] = [
  {
    id: "creator",
    role: "Creator",
    value: "Turn one idea into a consistent publishing system.",
    workflow: [
      "Record or write one idea",
      "Generate three concepts and several hooks",
      "Adapt to every format you publish in",
      "Approve, schedule and review results",
    ],
    exampleCampaign: "A single explainer becomes a week of posts across four channels.",
    preview: [
      { label: "Workspaces", value: "1" },
      { label: "Accounts", value: "1–4" },
      { label: "Approvals", value: "Self" },
      { label: "Emphasis", value: "Cadence and hooks" },
    ],
    conversionMessage:
      "Stop choosing between making content and publishing it consistently.",
  },
  {
    id: "agency",
    role: "Agency",
    value: "Operate client brands without mixing assets, approvals or analytics.",
    workflow: [
      "Separate workspace per client",
      "Brand-locked assets and voice",
      "Client review before anything publishes",
      "Per-client reporting",
    ],
    exampleCampaign: "Six client brands, each with its own pillars, tone and approval chain.",
    preview: [
      { label: "Workspaces", value: "Per client" },
      { label: "Accounts", value: "Grouped by brand" },
      { label: "Approvals", value: "Client sign-off" },
      { label: "Emphasis", value: "Separation and audit" },
    ],
    conversionMessage:
      "Take on more clients without adding an editor for each one.",
  },
  {
    id: "growth",
    role: "Growth team",
    value: "Generate and test creative variations without rebuilding every campaign manually.",
    workflow: [
      "Define the hypothesis, not the asset list",
      "Generate structured variants of one concept",
      "Publish across formats and accounts",
      "Read retention against variant, not vibes",
    ],
    exampleCampaign: "One value proposition, twelve hooks, tested across three formats.",
    preview: [
      { label: "Workspaces", value: "1–3" },
      { label: "Accounts", value: "By channel" },
      { label: "Approvals", value: "Team review" },
      { label: "Emphasis", value: "Experiment volume" },
    ],
    conversionMessage:
      "Run the number of experiments your hypothesis actually needs.",
  },
  {
    id: "network",
    role: "Media network",
    value: "Coordinate legitimate multi-account publishing with account-level visibility.",
    workflow: [
      "Group accounts by region, language and vertical",
      "Route approved content to the right accounts",
      "Track publishing status per account",
      "Compare performance across the network",
    ],
    exampleCampaign: "One editorial concept localised into three languages across twenty-four accounts.",
    preview: [
      { label: "Workspaces", value: "Many" },
      { label: "Accounts", value: "Grouped by region" },
      { label: "Approvals", value: "Role-based" },
      { label: "Emphasis", value: "Coverage and logging" },
    ],
    conversionMessage:
      "Coordinate a network without spreadsheets holding it together.",
  },
] as const;
