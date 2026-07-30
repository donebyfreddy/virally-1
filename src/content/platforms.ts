export type PlatformStatus = "live" | "coming-later";

export type Platform = {
  id: string;
  name: string;
  accountType: string;
  status: PlatformStatus;
  formats: string;
};

export const channelNetwork = {
  id: "channels",
  eyebrow: "Authorised account network",
  headline: "Operate every brand from one place.",
  body: "Group accounts by brand, language, region or campaign. Assign approved content, watch publishing status and compare performance without mixing anyone's assets together.",
  /** Required language. Do not soften or shorten this. */
  authorisation:
    "Connect accounts through official authorisation flows. Virally never asks for your social passwords.",
  capabilities: [
    "Group accounts by brand, language, region or campaign",
    "Assign campaigns to specific accounts",
    "Separate editor, reviewer and publisher roles",
    "Review account health before publishing",
    "Schedule content and track publishing status",
    "Compare performance across accounts",
    "Revoke publishing permissions at any time",
    "Every account action is logged",
  ],
} as const;

export const platforms: readonly Platform[] = [
  {
    id: "instagram",
    name: "Instagram",
    accountType: "Professional accounts",
    status: "live",
    formats: "9:16 · 4:5 · 1:1",
  },
  {
    id: "tiktok",
    name: "TikTok",
    accountType: "Business accounts",
    status: "live",
    formats: "9:16",
  },
  {
    id: "youtube",
    name: "YouTube",
    accountType: "Channels",
    status: "live",
    formats: "9:16 · 16:9",
  },
  {
    id: "facebook",
    name: "Facebook",
    accountType: "Pages",
    status: "live",
    formats: "9:16 · 1:1 · 16:9",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    accountType: "Company pages",
    status: "coming-later",
    formats: "1:1 · 16:9",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    accountType: "Business accounts",
    status: "coming-later",
    formats: "9:16 · 2:3",
  },
] as const;

/**
 * The account-creation boundary, stated explicitly.
 *
 * Virally produces a launch kit a human then uses to create an account
 * themselves. It does not create consumer social accounts, and nothing in this
 * section may imply otherwise.
 */
export const launchKit = {
  heading: "Launching a new account?",
  body: "Virally generates an account launch kit: username ideas, a bio, profile image concepts, content pillars, a first 30-post plan and a visual identity, plus a manual setup checklist.",
  boundary:
    "You create and verify the account yourself on the platform. Virally does not create social accounts on your behalf, and does not automate signup, verification or engagement.",
  items: [
    "Username ideas",
    "Bio and positioning",
    "Profile image concepts",
    "Content pillars",
    "First 30-post plan",
    "Visual identity",
    "Manual setup checklist",
  ],
} as const;
