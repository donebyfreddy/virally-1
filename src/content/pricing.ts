export type PricingTier = {
  id: string;
  name: string;
  audience: string;
  /** [REAL PRICING REQUIRED] — no invented prices, ever. */
  monthly: string;
  annual: string;
  annualSaving: string | null;
  dimensions: readonly { label: string; value: string }[];
  /** One honest answer to the objection this tier actually raises. */
  objection: { question: string; answer: string };
  cta: { label: string; href: string };
  recommended: boolean;
};

export const pricing = {
  id: "pricing",
  eyebrow: "Pricing",
  headline: "Priced by how much you produce.",
  body: "Three shapes of operation. The pipeline is identical in all of them — what changes is capacity, separation and control.",
  /**
   * Pricing is not set. Placeholders are shown rather than invented figures:
   * a wrong price is the one piece of marketing copy a visitor will hold you
   * to. Replace the `monthly`, `annual` and `annualSaving` fields with real
   * amounts and the layout needs no changes.
   */
  notice:
    "Pricing is not finalised. Figures marked as required will be published before launch.",
  toggle: { monthly: "Monthly", annual: "Annual" },
} as const;

export const tiers: readonly PricingTier[] = [
  {
    id: "creator",
    name: "Creator",
    audience: "Individuals and small content operations.",
    monthly: "[PRICE REQUIRED]",
    annual: "[PRICE REQUIRED]",
    annualSaving: null,
    dimensions: [
      { label: "Monthly generation", value: "[USAGE LIMIT REQUIRED]" },
      { label: "Connected accounts", value: "Up to 4" },
      { label: "Export resolution", value: "1080p" },
      { label: "Analytics history", value: "90 days" },
      { label: "Workspaces", value: "1" },
      { label: "Approvals", value: "Self-review" },
    ],
    objection: {
      question: "Will this just produce generic content?",
      answer:
        "It produces variants of your brief, in your voice, and shows you every one before it publishes. If a hook is wrong you change the hook, not the whole campaign.",
    },
    cta: { label: "Start creating", href: "/app" },
    recommended: false,
  },
  {
    id: "studio",
    name: "Studio",
    audience: "Agencies and growth teams running several brands.",
    monthly: "[PRICE REQUIRED]",
    annual: "[PRICE REQUIRED]",
    annualSaving: null,
    dimensions: [
      { label: "Monthly generation", value: "[USAGE LIMIT REQUIRED]" },
      { label: "Connected accounts", value: "Up to 24" },
      { label: "Export resolution", value: "4K" },
      { label: "Analytics history", value: "12 months" },
      { label: "Workspaces", value: "Per brand or client" },
      { label: "Approvals", value: "Editor, reviewer, publisher" },
    ],
    objection: {
      question: "How do I keep client work separated?",
      answer:
        "Each client gets its own workspace with its own assets, voice, accounts and analytics. Nothing crosses between them, and every account action is logged.",
    },
    cta: { label: "Start creating", href: "/app" },
    recommended: true,
  },
  {
    id: "network",
    name: "Network",
    audience: "High-volume, multi-region publishing operations.",
    monthly: "[PRICE REQUIRED]",
    annual: "Contracted",
    annualSaving: null,
    dimensions: [
      { label: "Monthly generation", value: "Contracted capacity" },
      { label: "Connected accounts", value: "Custom limits" },
      { label: "Export resolution", value: "4K" },
      { label: "Analytics history", value: "Custom retention" },
      { label: "Access", value: "SSO and security controls" },
      { label: "Support", value: "Dedicated" },
    ],
    objection: {
      question: "Can our security team approve this?",
      answer:
        "Accounts connect through official authorisation flows only, no social passwords are requested or stored, permissions are revocable, and account actions are logged for audit.",
    },
    cta: { label: "Talk to sales", href: "/contact-sales" },
    recommended: false,
  },
] as const;

export const finalConversion = {
  id: "start",
  headline: "Your next campaign starts with one sentence.",
  body: "Plan it, create it, adapt it and distribute it from one system.",
  primaryCta: { label: "Start creating", href: "/app" },
  secondaryCta: { label: "Talk to sales", href: "/contact-sales" },
  /** Recomputed from the Multiplier's own function, not hardcoded. */
  exampleNote: "Example campaign, computed with the Multiplier's default settings.",
} as const;
