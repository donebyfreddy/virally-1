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
 *
 * No eyebrows. §16 deletes them from the authenticated app: "ACCOUNT NETWORK"
 * above "Your account network." said the same words twice, and the top bar's
 * breadcrumb already states where the user is.
 */

import type { AccountSlotStatus, Platform } from "@/types/database";

export const authorisationBoundary =
  "Connect accounts through official authorisation flows. Virally never asks for your social passwords.";

export const creationBoundary =
  "Virally prepares the material for a new account. You register it yourself using the platform's own app or website — Virally does not create social accounts.";

export const accountsPage = {
  // A page title, not a statement. 28–32px `app-title`, so it has to survive
  // being read at that size next to a KPI strip.
  heading: "Accounts",
  intro: "Every account you publish through, and every slot still available to you.",

  /**
   * KPI strip. Labels only — every figure is queried.
   *
   * Sentence case: at five tiles across the grid each caption gets ~130px, and
   * the uppercase `.app-label` truncated "Reconnection required" to an ellipsis.
   */
  kpis: {
    connected: "Connected accounts",
    healthy: "Healthy",
    reconnect: "Reconnection required",
    scheduled: "Scheduled posts",
    limit: "Account limit",
  },

  kpiDetail: {
    healthyNone: "Nothing publishable yet",
    healthyAll: "All publishable",
    reconnectNone: "Nothing to reconnect",
    noneConnected: "No live authorisation yet",
    slotsAvailable: (available: number) =>
      available === 1 ? "1 slot available" : `${available} slots available`,
    slotsFull: "No slots available",
  },

  /** The actionable half, and the reason it leads the page. */
  attention: {
    heading: "Needs your attention",
    body: "An account in one of these states cannot publish until someone acts on it.",
    chip: "Action needed",
    openSlot: "Open slot",
    /**
     * Why there is no reconnect button. No authorisation route exists on this
     * deployment yet, so a control here would 404 — and the connector table at the
     * bottom of the page is where the real reason lives.
     */
    reconnectRoute: "Reconnecting runs through the platform's own authorisation flow.",
    reconnectLink: "See connector state",
  },

  accounts: {
    heading: "Accounts and slots",
    tableCaption: "Every account slot in this workspace",
    clearFilters: "Clear filters",
    gridLabel: "Account slots",
    reachWindowNote: (days: number) =>
      `Reach counts posts published in the last ${days} days, taken from each post's most recent metrics sync.`,
  },

  columns: {
    account: "Account",
    platform: "Platform",
    brand: "Brand",
    followers: "Followers",
    lastSync: "Last sync",
    health: "State",
    scheduled: "Scheduled",
    reach: "Reach",
    // Named rather than blank: an empty `<th>` leaves the column unlabelled for
    // anyone navigating the table with a screen reader.
    actions: "Actions",
  },

  /** Filters. Each option carries the slot statuses it means, so the page's SQL
   *  predicate and the label the user picked cannot drift apart. */
  stateOptions: [
    { id: "connected", label: "Connected", statuses: ["connected"] },
    {
      id: "attention",
      label: "Needs attention",
      statuses: ["reconnection_required", "limited_permissions"],
    },
    {
      id: "preparing",
      label: "Being prepared",
      statuses: [
        "planning",
        "launch_kit_ready",
        "awaiting_manual_creation",
        "awaiting_connection",
        "connecting",
      ],
    },
    // No "archived" option: archived slots are excluded from this list entirely
    // and get their own section, so offering it here would produce two places
    // showing the same rows under different headings.
    { id: "paused", label: "Paused or disconnected", statuses: ["suspended_by_user", "disconnected"] },
  ] as const satisfies readonly {
    id: string;
    label: string;
    statuses: readonly AccountSlotStatus[];
  }[],

  capacity: {
    heading: "Available capacity",
    body: "Each empty slot is one more account this plan allows. Nothing is charged for an unused slot.",
    gridLabel: "Empty account slots",
  },

  unslotted: {
    heading: "Accounts without a slot",
    body: "Connected but no slot represents them, so they are absent from the list above. This should not happen; it is shown rather than hidden because a publishable account must never be invisible.",
    unnamed: "Unnamed account",
  },

  archived: {
    heading: "Archived slots",
    body: "Released capacity. The launch material is kept, and the slot number stays reserved so past references still resolve.",
  },

  platforms: {
    heading: "Platforms",
    body: "What each connector can do on this deployment, and what the platform requires before it can.",
    missingEnv: "Missing environment variables",
  },

  readOnlyNotice:
    "Your role can view this network but cannot claim slots or connect accounts. An admin or owner can.",

  empty: {
    title: "No accounts yet",
    body: "Prepare an account to generate its launch material, or connect an account you already manage.",
  },

  noMatches: {
    title: "No accounts match those filters",
    body: "Nothing in this workspace matches the current combination.",
  },

  /** Nullable metric fallback. Rendered as an em dash; this is the sr-only half. */
  notReported: "Not reported",
  neverSynced: "Never synced",
  noAction: "No action available",
} as const;

export const slotActions = {
  prepare: "Prepare account",
  viewKit: "View launch kit",
  markRegistered: "I registered this account",
  archive: "Archive slot",
} as const;

export const emptySlot = {
  label: "Empty slot",
  body: "Prepare a new account, or connect one you already manage.",
} as const;

/**
 * Copy for the launch form.
 *
 * `submit` names what the button does — it prepares material and claims a slot. It
 * deliberately does not say "Create account", which would describe something this
 * product does not do.
 */
export const launchPage = {
  heading: "Prepare an account",
  intro:
    "Virally will generate names, usernames, a bio, a profile image concept, five content pillars, twenty hooks, a first thirty-post plan and a setup checklist. Then you register the account on the platform and authorise it here.",
  consumesSlot:
    "Submitting this form claims one account slot. Opening the form does not — you can leave without using capacity.",
  submit: "Prepare launch kit",
  submitting: "Preparing launch kit",
  back: "Back to accounts",
  formHeading: "About this account",
  mockNotice:
    "No generation provider is configured, so this launch kit will be deterministic demo material, labelled as such.",
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
    brand: {
      label: "Brand",
      hint: "Which brand this account belongs to.",
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

  slotLabel: (slotNumber: number) => `Slot ${String(slotNumber).padStart(2, "0")}`,
  notPreparedTitle: "No launch kit for this slot",
  notPreparedYet:
    "This slot has no launch kit yet. It was claimed but the material was not generated — the most likely cause is a provider failure recorded on the slot.",
  planCaption: "The first thirty posts, with the content pillar and opening hook for each.",
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
