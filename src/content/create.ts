import type { AspectRatio, GenerationMode, Platform } from "@/types/database";

/**
 * Create-page copy and option sets.
 *
 * The examples are readable, never inserted. Pre-filling the composer with an example
 * submits words the user did not write and skews their first campaign.
 */

export const createCopy = {
  heading: "What do you want to create?",
  body: "Describe the campaign, or point Virally at a URL, a document or existing footage. Nothing is generated until you confirm — the default is to produce plans first.",
  promptLabel: "Campaign brief",
  promptHint:
    "What it is about, who it is for, and what you want out of it. Specific beats clever.",
  submitLabel: "Generate campaign plan",
  examplesLabel: "For example",
  examples: [
    "Create a 7-day campaign about why deep-sea animals glow. Target curious people aged 18–34. Create three hooks per concept. Produce Instagram Reels, TikTok videos and YouTube Shorts. Use a cinematic documentary style.",
    "Turn our pricing page into ten short videos that each answer one objection.",
    "Cut this month's podcast into vertical clips for TikTok and Shorts.",
  ],
} as const;

export const GENERATION_MODES: readonly {
  id: GenerationMode;
  label: string;
  detail: string;
}[] = [
  { id: "quick", label: "Quick create", detail: "One idea, minimal configuration." },
  { id: "campaign", label: "Campaign", detail: "Several concepts across a date range." },
  { id: "repurpose", label: "Repurpose", detail: "Turn existing footage into short-form." },
  { id: "product", label: "Product campaign", detail: "Organic and ad content for a product." },
  { id: "account_launch", label: "Account launch", detail: "A launch kit and a first content plan." },
  { id: "batch_studio", label: "Batch studio", detail: "Many structured variants at once." },
];

export const SOURCE_KINDS = [
  { id: "prompt", label: "Prompt", detail: "Describe it in words", available: true },
  { id: "website", label: "Website URL", detail: "Ground it in a real page", available: true },
  { id: "product", label: "Product URL", detail: "A specific product page", available: true },
  { id: "document", label: "Document", detail: "PDF or text file", available: false },
  { id: "video", label: "Existing video", detail: "Cut it into short-form", available: false },
  { id: "audio", label: "Audio or podcast", detail: "Transcribe and clip", available: false },
  { id: "library", label: "Library asset", detail: "Something already uploaded", available: false },
] as const;

export const PLATFORM_OPTIONS: readonly { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "facebook", label: "Facebook" },
];

export const RATIO_OPTIONS: readonly { id: AspectRatio; label: string; detail: string }[] = [
  { id: "9:16", label: "9:16", detail: "Reels, TikTok, Shorts" },
  { id: "4:5", label: "4:5", detail: "Feed video" },
  { id: "1:1", label: "1:1", detail: "Square feed" },
  { id: "16:9", label: "16:9", detail: "YouTube landscape" },
  { id: "4:3", label: "4:3", detail: "Legacy landscape" },
];

export const QUALITY_OPTIONS = [
  { id: "draft", label: "Draft", detail: "Cheapest. For reviewing structure." },
  { id: "standard", label: "Standard", detail: "Balanced cost and fidelity." },
  { id: "high", label: "High", detail: "Highest fidelity, highest cost." },
] as const;

/**
 * Campaign length, in days.
 *
 * Persisted as a real date range on the campaign (`starts_on` / `ends_on`), so
 * this is a scheduling decision rather than a label — the calendar and the
 * publishing plan both read it.
 */
export const LENGTH_OPTIONS: readonly { id: string; label: string; days: number }[] = [
  { id: "3", label: "3 days", days: 3 },
  { id: "7", label: "7 days", days: 7 },
  { id: "14", label: "14 days", days: 14 },
  { id: "30", label: "30 days", days: 30 },
];

export const DEFAULT_LENGTH_DAYS = 7;

/**
 * Tone of voice. Written to `campaign_briefs.tone` and passed to the language
 * provider, so choosing one changes the generated output rather than only the
 * form state.
 */
export const TONE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "confident", label: "Confident" },
  { id: "conversational", label: "Conversational" },
  { id: "authoritative", label: "Authoritative" },
  { id: "playful", label: "Playful" },
  { id: "cinematic", label: "Cinematic" },
  { id: "educational", label: "Educational" },
];

/** Primary goal. Written to `campaigns.objective`. */
export const GOAL_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "product_awareness", label: "Product awareness" },
  { id: "audience_growth", label: "Audience growth" },
  { id: "engagement", label: "Engagement" },
  { id: "conversions", label: "Conversions" },
  { id: "education", label: "Education" },
  { id: "launch", label: "Launch" },
];

/**
 * Quick templates.
 *
 * A template configures the STRUCTURE of a campaign — length, concept count,
 * formats, goal — and lists what a good brief for that shape should cover. It
 * deliberately does not write the brief.
 *
 * That restraint is the same rule the examples follow: inserting prose the user
 * did not write means submitting words they did not choose, and for a first
 * campaign it anchors the whole output on our phrasing rather than their
 * product. So the template supplies the scaffolding and the user supplies the
 * substance.
 */
export const TEMPLATES: readonly {
  id: string;
  label: string;
  /** Human-readable range, e.g. "7–14 days". Display only. */
  range: string;
  days: number;
  concepts: number;
  goal: string;
  /** What the brief needs to cover for this template to produce good output. */
  covers: readonly string[];
}[] = [
  {
    id: "product-launch",
    label: "Product launch",
    range: "7–14 days",
    days: 14,
    concepts: 5,
    goal: "launch",
    covers: ["What the product is", "Who it is for", "The one thing it does better", "Launch date"],
  },
  {
    id: "feature-spotlight",
    label: "Feature spotlight",
    range: "5–10 days",
    days: 7,
    concepts: 3,
    goal: "product_awareness",
    covers: ["The feature", "The problem it removes", "Who noticed the problem most"],
  },
  {
    id: "customer-testimonial",
    label: "Customer testimonial",
    range: "5–7 days",
    days: 7,
    concepts: 3,
    goal: "conversions",
    covers: ["Who the customer is", "What changed for them", "A number if you have one"],
  },
  {
    id: "how-it-works",
    label: "How it works",
    range: "5–7 days",
    days: 7,
    concepts: 4,
    goal: "education",
    covers: ["The steps, in order", "What the user has to do", "What happens automatically"],
  },
];

/** Right-hand plan column. */
export const planSummaryCopy = {
  heading: "Plan summary",
  intro: "Virally plans first, then generates. This is what the campaign will include.",
  readyLabel: "Ready to plan",
  readyDetail: "No generation has started yet.",
  blockedLabel: "Not ready",
  whyHeading: "Why plan first?",
  whyBody:
    "The plan is deterministic, so you can see exactly what will be produced, how it will be scheduled and what it will cost before any generation begins. Nothing is charged until you approve it.",
  whyLink: "How planning works",
} as const;

/**
 * Brief and shape copy — the card titles and group labels of the left column.
 *
 * The reference design carries an "Auto / Recommended" format chip. It is not
 * implemented here: choosing formats automatically requires a real rule that
 * maps connected platforms to ratios, and until that rule exists the chip would
 * be a control that changes nothing. A visible affordance that does not work is
 * worse than its absence, so the formats are chosen explicitly for now.
 */
export const briefPanelCopy = {
  heading: "Brief",
  audienceHeading: "Audience and tone",
  shapeHeading: "Output shape",
  attachLabel: "Attach brief",
  urlLabel: "Add URL",
  uploadLabel: "Upload file",
  enhanceLabel: "Enhance brief",
  sourcesLabel: "Sources and tools",
  /* Disabled controls need a stated reason, or they read as broken rather than
     unbuilt. */
  sourcesHint: "Not accepted yet. Describe the source in the brief for now.",
  formatsHeading: "Formats",
  channelsHeading: "Channels",
  volumeHeading: "Volume and schedule",
  includeHeading: "Include",
  templatesHeading: "Start from a structure",
  templatesHint: "Templates set the shape — you write the brief.",
  recentHeading: "Recent campaigns",
  recentHint: "Pick up where you left off.",
} as const;

/**
 * Production-mode selector copy.
 *
 * The mode labels, descriptions and credit prices are NOT here — they come from
 * `production_modes` (seeded from src/lib/creative/modes.ts), because the brief
 * requires them to be editable without a deploy. Duplicating them as copy
 * constants would create a second set of prices that silently disagrees with the
 * one the ledger charges against.
 */
export const productionModeCopy = {
  heading: "Production mode",
  hint: "How each reel is assembled. This is the single biggest driver of cost — everything else scales the count, this scales the price per item.",
  creditsSuffix: "per reel",
  compositionHeading: "What it assembles",
  batchLabel: "This batch",
} as const;

/**
 * Credit-balance copy for the plan rail.
 *
 * `reservedNote` explains a number that is otherwise alarming: a user who sees
 * credits missing from their balance needs to know they are held, not spent, and
 * that they come back.
 */
export const creditCopy = {
  heading: "Production Credits",
  availableLabel: "Available",
  estimateLabel: "This batch",
  afterLabel: "After reservation",
  reservedLabel: "Currently reserved",
  reservedNoteTitle: "Held, not spent",
  reservedNote:
    "Reserved credits are held for work already running. Whatever the batch does not use is returned automatically.",
  shortfallHeading: "Not enough credits",
  shortfallBody:
    "Reduce the number of concepts, hooks or formats, choose a cheaper production mode, or run an earlier stage only.",
  reservationNoteTitle: "How reservation works",
  reservationNote:
    "Credits are reserved before generation starts, so a batch cannot begin work it cannot finish. Unused credits are returned when it completes.",
  unmeteredNoteTitle: "Nothing will be charged",
  unmeteredNote:
    "No generation provider is configured, so this batch runs against the deterministic mock and costs nothing. The figures below are what it would cost with a provider configured.",
} as const;

export const costCopy = {
  heading: "What this will create",
  countsHeading: "Output",
  breakdownHeading: "Estimated credit cost",
  noTimeEstimate:
    "No processing-time estimate: it can only be given from measured provider throughput, and no AI provider is configured.",
  stageHeading: "How far to go now",
  stageHint:
    "Plans first is the safe default. Each stage is a separate, retryable step — you can stop and review after any of them.",
  confirmHeading: "Confirm this batch",
  confirmCheckboxLabel: "I have reviewed the counts above and want to proceed",
} as const;

/**
 * Stated wherever generated output appears while no provider is configured.
 *
 * Kept in one place so the wording cannot drift between surfaces — the label is a
 * factual claim about provenance, not decoration.
 */
export const demoNotice = {
  title: "Demo data",
  body: "No AI provider key is configured, so a deterministic mock produced this. It is not a real generation and does not reflect what a configured provider would produce. Everything else — the plan, the counts, scheduling and publishing state — is real.",
} as const;
