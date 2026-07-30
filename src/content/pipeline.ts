export type PipelineAct = {
  id: string;
  /** Two-digit act number, part of the content not the presentation. */
  number: string;
  title: string;
  summary: string;
  body: string;
  /** Rows shown in the act's visualisation panel. */
  rows: readonly { label: string; value: string }[];
};

/**
 * S4 — the five acts.
 *
 * The right panel follows ONE campaign — the same deep-sea brief from the hero
 * — through every stage. Five unrelated illustrations would be five features;
 * one object traversing five stations is a system.
 */
export const pipeline = {
  id: "workflow",
  eyebrow: "The pipeline",
  headline: "Five stages, one campaign.",
  body: "The same brief you saw in the hero, followed all the way from intent to measured result.",
  skipLabel: "Skip the pipeline sequence",
} as const;

export const pipelineActs: readonly PipelineAct[] = [
  {
    id: "strategy",
    number: "01",
    title: "Strategy",
    summary: "Turn intent into a campaign plan.",
    body: "Virally reads your brief, source video, document or URL and returns content pillars, angles, a posting cadence and a per-channel plan. Everything is editable before anything is generated.",
    rows: [
      { label: "Input", value: "1 brief · 41 words" },
      { label: "Pillars", value: "3 identified" },
      { label: "Cadence", value: "3 posts / day · 7 days" },
      { label: "Plan", value: "21 slots mapped" },
    ],
  },
  {
    id: "create",
    number: "02",
    title: "Create",
    summary: "Generate hooks, scripts, scenes, voice and media.",
    body: "Each pillar becomes concepts, each concept becomes hooks, and each hook becomes a script with scenes, voiceover, captions and a thumbnail. You review the writing before a frame is rendered.",
    rows: [
      { label: "Concepts", value: "3" },
      { label: "Hooks", value: "12 variants" },
      { label: "Scripts", value: "12 drafted" },
      { label: "Voice + captions", value: "Generated" },
    ],
  },
  {
    id: "adapt",
    number: "03",
    title: "Adapt",
    summary: "Recompose every asset for each format and platform.",
    body: "Not a crop. Framing, subject position, caption width, safe areas, CTA placement and runtime are rebuilt for each ratio, so a 16:9 edit does not arrive on Reels with its subject off-screen.",
    rows: [
      { label: "Formats", value: "9:16 · 4:5 · 1:1 · 16:9" },
      { label: "Assets", value: "48 recomposed" },
      { label: "Safe areas", value: "Per platform" },
      { label: "Thumbnails", value: "12 generated" },
    ],
  },
  {
    id: "distribute",
    number: "04",
    title: "Distribute",
    summary: "Assign approved content to authorised accounts.",
    body: "Content is routed to the accounts you have connected through official authorisation flows, grouped by brand, language or region. Nothing publishes until it is approved, and permissions can be revoked at any time.",
    rows: [
      { label: "Accounts", value: "6 authorised" },
      { label: "Approvals", value: "Required" },
      { label: "Scheduled", value: "21 posts" },
      { label: "Credentials", value: "OAuth only" },
    ],
  },
  {
    id: "learn",
    number: "05",
    title: "Learn",
    summary: "Use performance data to improve the next generation.",
    body: "Retention curves, hook performance and completion rates feed back into the next brief, so the following campaign starts from what actually held attention rather than from a guess.",
    rows: [
      { label: "Signals", value: "Retention · completion" },
      { label: "Compared", value: "12 hook variants" },
      { label: "Winner", value: "Hook B · 41% completion" },
      { label: "Next brief", value: "Seeded automatically" },
    ],
  },
] as const;
