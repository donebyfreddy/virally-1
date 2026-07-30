/**
 * ACCOUNT NETWORK COPY.
 *
 * All strings for the accounts surfaces live here, not in JSX. Two of them are
 * compliance text rather than marketing text and are quoted verbatim from the
 * frontend design reference, §11:
 *
 *   - `authorisationBoundary` — must appear wherever accounts are discussed.
 *   - `creationBoundary` — states the limit Virally declines to cross.
 *
 * Neither may be softened, shortened for layout, or moved into a tooltip. An e2e
 * test asserts the first is rendered on the accounts screen.
 */

import type { Platform } from "@/types/database";

export const authorisationBoundary =
  "Connect accounts through official authorisation flows. Virally never asks for your social passwords.";

export const creationBoundary =
  "Virally prepares the material for a new account. You register it yourself using the platform's own app or website — Virally does not create social accounts.";

export const accountsPage = {
  eyebrow: "ACCOUNT NETWORK",
  heading: "Your account network.",
  intro:
    "Every account you operate through Virally, and every slot still available to you. A slot is capacity in your plan — it is not a social account until you have registered one and authorised it.",
  slotsHeading: "Slots",
  archivedHeading: "Archived slots",
  archivedIntro:
    "Released capacity. The launch material is kept, and the slot number stays reserved so past references still resolve.",
  unslottedHeading: "Accounts without a slot",
  unslottedIntro:
    "These accounts are connected but no slot represents them, so they are not visible in the grid above. This should not happen; it is shown rather than hidden because a publishable account must never be invisible.",
  attentionHeading: "Needs your attention",
  readOnlyNotice:
    "Your role can view this network but cannot claim slots or connect accounts. An admin or owner can.",
  usageUnavailable:
    "The slot limit could not be read for this workspace, so the plan default is shown. Treat the number below as indicative.",
  emptyNetwork:
    "No slots in use yet. Prepare an account to generate its launch material, or connect an account you already manage.",
} as const;

export const slotActions = {
  prepare: "Prepare account",
  connect: "Connect account",
  viewKit: "View launch kit",
  markRegistered: "I registered this account",
  archive: "Archive slot",
  upgrade: "Raise account limit",
} as const;

export const emptySlot = {
  label: "Empty account slot",
  body: "Prepare a new account or connect an account you already manage.",
} as const;

/**
 * Copy for the launch form.
 *
 * `submit` names what the button does — it prepares material and claims a slot. It
 * deliberately does not say "Create account", which would describe something this
 * product does not do.
 */
export const launchPage = {
  eyebrow: "PREPARE ACCOUNT",
  heading: "Prepare a new account.",
  intro:
    "Virally will generate names, usernames, a bio, a profile image concept, five content pillars, twenty hooks, a first thirty-post plan and a setup checklist. Then you register the account on the platform and authorise it here.",
  consumesSlot:
    "Submitting this form claims one account slot. Opening the form does not — you can leave without using capacity.",
  submit: "Prepare launch kit",
  submitting: "Preparing launch kit",
  back: "Back to accounts",
  fields: {
    platform: {
      label: "Platform",
      hint: "Which platform this account will live on. It decides the setup steps and what can be published.",
    },
    niche: {
      label: "Niche or subject",
      hint: "What the account is about. This drives every generated suggestion, so be specific.",
    },
    displayLabel: {
      label: "Internal label",
      hint: "Optional. What you will call this slot inside Virally, e.g. “Science ES”.",
    },
    language: {
      label: "Primary language",
      hint: "Two-letter code, e.g. en or es.",
    },
    region: {
      label: "Country or region",
      hint: "Optional. Used for the bio and audience description.",
    },
    audience: {
      label: "Target audience",
      hint: "Optional. Who this account is for.",
    },
    objective: {
      label: "Objective",
      hint: "Optional. What this account is for.",
    },
    contentStyle: {
      label: "Content style",
      hint: "Optional. e.g. explainer, documentary, talking head.",
    },
    postingFrequency: {
      label: "Posting frequency",
      hint: "Optional. e.g. three times a week.",
    },
  },
} as const;

/**
 * Error copy, keyed on the `?error=` value the server actions redirect with.
 *
 * Capacity and permission are separate entries because they have different
 * remedies, and collapsing them into one "something went wrong" is what makes a
 * limit feel like a bug.
 */
export const accountErrors: Readonly<Record<string, string>> = {
  limit:
    "That would exceed your account slot limit. Archive an unused slot, or raise the limit for this workspace.",
  permission: "Your role cannot claim slots or connect accounts in this workspace.",
  claim: "The slot could not be claimed. Nothing was created and no capacity was used.",
  generation:
    "The launch material could not be generated. The slot is held for you in planning — open it to try again, or archive it to release the capacity.",
  save: "The launch material was generated but could not be saved. The slot is held for you in planning.",
  connected:
    "This slot has a connected account. Disconnect the account first — archiving it now would leave an account that can publish but is not shown anywhere.",
  platform: "Choose one of the supported platforms.",
  niche: "Describe the niche in a few words so the suggestions have something to work from.",
};

export const PLATFORM_LABELS: Readonly<Record<Platform, string>> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
};

export const launchKitPage = {
  preparedNotice: (slotNumber: number) =>
    `Launch kit ready in slot ${slotNumber}. Nothing has been registered on the platform yet — the next step is yours.`,

  /**
   * The handoff statement, required by §3 of the product spec.
   *
   * "Prepared this account" means prepared the *material* for it. The second
   * sentence is what stops the first from being read as "created it", so the two
   * must never be separated or shown one without the other.
   */
  handoffTitle: "Virally has prepared this account.",
  handoffBody:
    "Complete the platform registration using the official application or website, then return here to connect it.",

  eyebrow: "LAUNCH KIT",
  notPreparedYet:
    "This slot has no launch kit yet. It was claimed but the material was not generated — the most likely cause is a provider failure recorded on the slot.",
  sections: {
    names: "Account name ideas",
    usernames: "Username candidates",
    usernamesNote:
      "Suggestions only. Virally cannot check availability on any platform — check each one as you go and take the first that is free.",
    identity: "Profile",
    bio: "Bio",
    description: "Profile description",
    voice: "Brand voice",
    audience: "Audience",
    visual: "Profile image concept",
    cover: "Cover image concept",
    pillars: "Content pillars",
    hooks: "Opening hooks",
    plan: "First thirty posts",
    checklist: "Setup checklist",
    checklistNote:
      "Every step here is one you perform yourself, in the platform's own app or website.",
  },
  actions: {
    copy: "Copy account details",
    copied: "Copied",
    download: "Download launch kit",
  },
  demoLabel: "Demo data",
  demoExplanation:
    "This material was produced by the deterministic mock provider because no generation provider is configured. It is consistent and usable as a starting point, but it is not model output.",
} as const;
