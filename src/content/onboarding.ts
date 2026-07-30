/**
 * Onboarding copy and option sets.
 *
 * Six steps, matching the specification. Everything after step 1 is skippable:
 * a first-run questionnaire that blocks access to the product is the fastest way
 * to lose a user who wanted to try it, and every answer here has a sane default.
 */

export type OnboardingOption = {
  id: string;
  label: string;
  detail: string;
};

export const ACCOUNT_TYPES: readonly OnboardingOption[] = [
  { id: "personal", label: "Personal creator brand", detail: "One identity, many channels." },
  { id: "agency", label: "Agency", detail: "Several clients, each with their own workspace." },
  { id: "company", label: "Company growth team", detail: "One brand, coordinated across a team." },
  { id: "network", label: "Multi-brand media network", detail: "Many brands and many accounts at once." },
] as const;

export const CONTENT_GOALS: readonly OnboardingOption[] = [
  { id: "organic_reach", label: "Increase organic reach", detail: "More distribution from the same idea." },
  { id: "consistency", label: "Produce content consistently", detail: "A dependable cadence instead of bursts." },
  { id: "promote_product", label: "Promote a product", detail: "Turn a product page into campaigns." },
  { id: "repurpose", label: "Repurpose existing content", detail: "Cut long footage into short-form." },
  { id: "test_ads", label: "Test advertising concepts", detail: "Many variants, measured against each other." },
  { id: "multi_channel", label: "Operate multiple channels", detail: "One plan across every platform." },
  { id: "multi_brand", label: "Grow several brands", detail: "Separate identities, shared workflow." },
] as const;

export const FORMATS: readonly OnboardingOption[] = [
  { id: "reels", label: "Instagram Reels", detail: "9:16 vertical video" },
  { id: "tiktok", label: "TikTok", detail: "9:16 vertical video" },
  { id: "shorts", label: "YouTube Shorts", detail: "9:16, under 3 minutes" },
  { id: "facebook_reels", label: "Facebook Reels", detail: "9:16 vertical video" },
  { id: "images", label: "Images", detail: "1:1, 4:5 and 9:16 stills" },
  { id: "carousels", label: "Carousels", detail: "Multi-slide posts" },
  { id: "landscape", label: "Landscape video", detail: "16:9 for YouTube" },
  { id: "text", label: "Text posts", detail: "Copy-led posts" },
] as const;

export const PLATFORMS_TO_CONNECT = [
  {
    id: "instagram",
    label: "Instagram",
    note: "Professional accounts only. Publishing requires app review.",
  },
  { id: "tiktok", label: "TikTok", note: "Direct posting requires an audited app." },
  { id: "facebook", label: "Facebook", note: "Pages, not personal profiles." },
  { id: "youtube", label: "YouTube", note: "Channel upload via official OAuth." },
] as const;

export const onboardingCopy = {
  steps: [
    { index: 1, title: "Welcome", eyebrow: "STEP 01" },
    { index: 2, title: "Brand", eyebrow: "STEP 02" },
    { index: 3, title: "Goals", eyebrow: "STEP 03" },
    { index: 4, title: "Formats", eyebrow: "STEP 04" },
    { index: 5, title: "Accounts", eyebrow: "STEP 05" },
    { index: 6, title: "First campaign", eyebrow: "STEP 06" },
  ],

  welcome: {
    heading: "What are you building with Virally?",
    body: "This shapes the defaults — how many brands you work across, and how workspaces are organised. You can change it later.",
  },
  brand: {
    heading: "Tell us about the brand.",
    body: "Only the name is required. Everything else improves the first campaign, and can be filled in later from Settings.",
    fields: {
      name: { label: "Brand name", hint: "Shown on campaigns and content." },
      website: { label: "Website", hint: "Optional. Used to ground campaigns in what you actually sell." },
      description: { label: "Description", hint: "Optional. What the brand does, in a sentence or two." },
      industry: { label: "Industry", hint: "Optional." },
      language: { label: "Main language", hint: "The language content is written in by default." },
      audience: { label: "Target audience", hint: "Optional. Who the content is for." },
      tone: { label: "Brand tone", hint: "Optional. For example: direct and technical, or warm and playful." },
      objective: { label: "Primary objective", hint: "Optional. What success looks like." },
    },
  },
  goals: {
    heading: "What should Virally help with?",
    body: "Select as many as apply.",
  },
  formats: {
    heading: "Which formats do you want?",
    body: "Select as many as apply. Each one changes how content is recomposed — not just cropped.",
  },
  accounts: {
    heading: "Connect your accounts.",
    body: "Virally publishes only to accounts you have authorised through each platform's official flow. It never asks for your social passwords.",
    skip: "Connect later",
    unavailable:
      "No platform credentials are configured on this deployment yet, so these cannot be connected. Nothing is blocked — you can connect accounts once they are set up.",
  },
  firstCampaign: {
    heading: "Describe the first campaign.",
    body: "A sentence is enough. Nothing is generated yet — this is saved as your starting brief.",
    label: "Campaign brief",
    hint: "What it is about, who it is for, and what you want out of it.",
    examplesLabel: "For example",
    // Offered as examples to read, never pre-filled — inserting one as though the
    // user wrote it would put words in their mouth and skew the first campaign.
    examples: [
      "A 7-day campaign about why deep-sea animals glow, for curious 18–34s, three hooks per concept, cinematic documentary style.",
      "Turn our pricing page into 10 short videos that each answer one objection.",
      "Cut this month's podcast into vertical clips for TikTok and Shorts.",
    ],
  },

  completion: {
    heading: "Workspace ready.",
    items: ["Brand configured", "Formats selected", "Workspace ready"],
    cta: "Open Virally",
  },

  nav: {
    back: "Back",
    next: "Continue",
    skip: "Skip this step",
    finish: "Finish setup",
    progress: (current: number, total: number) => `Step ${current} of ${total}`,
  },
} as const;
