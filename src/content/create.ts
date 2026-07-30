import type { AspectRatio, GenerationMode, Platform } from "@/types/database";

/**
 * Create-page copy and option sets.
 *
 * The examples are readable, never inserted. Pre-filling the composer with an example
 * submits words the user did not write and skews their first campaign.
 */

export const createCopy = {
  eyebrow: "CREATE",
  heading: "What do you want to create?",
  body: "Describe the campaign, or point Virally at a URL, a document or existing footage. Nothing is generated until you confirm — the default is to produce plans first.",
  promptLabel: "Brief",
  promptHint:
    "What it is about, who it is for, and what you want out of it. Specific beats clever.",
  submitLabel: "Review the plan",
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

export const costCopy = {
  heading: "What this will create",
  countsHeading: "Output",
  breakdownHeading: "Estimated credit cost",
  noTimeEstimate:
    "No processing-time estimate: it can only be given from measured provider throughput, and no AI provider is configured.",
  stageHeading: "How far to go now",
  stageHint:
    "Plans first is the safe default. Each stage is a separate, retryable step — you can stop and review after any of them.",
  confirmHeading: "CONFIRM THIS BATCH",
  confirmCheckboxLabel: "I have reviewed the counts above and want to proceed",
} as const;

/**
 * Stated wherever generated output appears while no provider is configured.
 *
 * Kept in one place so the wording cannot drift between surfaces — the label is a
 * factual claim about provenance, not decoration.
 */
export const demoNotice = {
  title: "DEMO DATA",
  body: "No AI provider key is configured, so a deterministic mock produced this. It is not a real generation and does not reflect what a configured provider would produce. Everything else — the plan, the counts, scheduling and publishing state — is real.",
} as const;
