export type Cta = {
  label: string;
  href: string;
};

export type MarketingSection = {
  id: string;
  eyebrow?: string;
  headline: string;
  body: string;
  primaryCta?: Cta;
  secondaryCta?: Cta;
};

/**
 * All marketing copy lives here. Components receive typed props and contain no
 * strings of their own, so wording can change without touching presentation.
 */

export const hero = {
  id: "hero",
  eyebrow: "AI content operating system",
  /** Rendered as three lines; kept as an array so the break is content, not markup. */
  headlineLines: ["One idea.", "Every format.", "Every channel."],
  body: "Virally turns a single brief into scripts, videos, images and platform-ready campaigns—then helps you publish, test and improve them.",
  primaryCta: { label: "Start creating", href: "/app" },
  secondaryCta: { label: "Watch the workflow", href: "#workflow" },
  trustPoints: [
    "Review before publishing",
    "Secure account connections",
    "No passwords shared",
  ],
} as const;

/**
 * The deterministic hero demonstration. Typed verbatim by the orchestration
 * timeline — never generated, never randomised, so every visitor and every
 * screenshot sees the same thing.
 */
export const heroDemo = {
  fieldLabel: "Campaign brief",
  fieldHint:
    "Describe the idea, the audience, the style and how often you want to post.",
  shortcutHint: "⌘ + ↵",
  prompt: `Create a 7-day campaign about why deep-sea animals glow.

Audience:
Curious people aged 18–34.

Style:
Fast cinematic documentary.

Platforms:
Instagram, TikTok, YouTube Shorts and Facebook.

Frequency:
Three posts per day.`,
  /** What the brief resolves to once parsed. Shown as structured chips. */
  parsed: [
    { label: "Topic", value: "Deep-sea bioluminescence" },
    { label: "Duration", value: "7 days" },
    { label: "Audience", value: "18–34, curiosity-led" },
    { label: "Style", value: "Fast cinematic documentary" },
    { label: "Cadence", value: "3 posts / day" },
  ],
  concepts: [
    { id: "c1", label: "Why the deep glows" },
    { id: "c2", label: "Creatures that make light" },
    { id: "c3", label: "Light as a language" },
  ],
  outputs: [
    { id: "o1", concept: "c1", format: "9:16", kind: "Reel", platform: "Instagram", hook: "Hook A" },
    { id: "o2", concept: "c1", format: "9:16", kind: "Short", platform: "YouTube", hook: "Hook B" },
    { id: "o3", concept: "c2", format: "9:16", kind: "Video", platform: "TikTok", hook: "Hook A" },
    { id: "o4", concept: "c2", format: "1:1", kind: "Carousel", platform: "Facebook", hook: "Hook C" },
    { id: "o5", concept: "c3", format: "4:5", kind: "Post", platform: "Instagram", hook: "Hook B" },
    { id: "o6", concept: "c3", format: "16:9", kind: "Landscape", platform: "YouTube", hook: "Hook A" },
  ],
  campaignLabel: "DEEP SEA / 7 DAYS",
  scheduledCount: 21,
  channelCount: 4,
  /** Honest framing for the demonstration itself. */
  disclosure: "Product demonstration. Scripted, not a live generation.",
} as const;

export type HeroOutput = (typeof heroDemo.outputs)[number];
