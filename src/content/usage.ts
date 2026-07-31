/**
 * Usage-page copy.
 *
 * No figure lives here. Every number on the page is read from the credit ledger
 * at request time; a hardcoded example in copy would eventually contradict the
 * real data sitting next to it.
 *
 * Two vocabulary rules this file enforces:
 *
 *   - "Production Credits" only. `lib/content/plan.ts` counts a second,
 *     unrelated unit (cents of list price, roughly 25x smaller), and the page
 *     never shows it. One screen showing two things both called a credit is
 *     worse than showing one.
 *   - Never "cost" in currency. Internal provider cost is our margin — see the
 *     header of src/lib/creative/usage.ts — so a campaign's spend is stated in
 *     credits and nothing on this page converts it to money.
 */
export const usageCopy = {
  heading: "Usage",
  body: "Every figure here is a sum of the append-only credit ledger. Nothing is a cached counter, so any number on this page can be traced back to the entries listed at the bottom of it.",

  availableLabel: "Available",
  availableDetail: "Spendable now",
  reservedLabel: "Reserved",
  reservedDetail: "Held for work in flight",
  usedLabel: "Used this period",
  includedLabel: "Granted this period",
  includedDetail: "Renewals and top-ups",

  consumptionHeading: "Consumption against grant",
  consumptionHint:
    "Used as a share of everything granted this period. A period with no grant shows the used figure alone rather than a bar out of zero.",

  trendHeading: "Credits by month",
  trendHint: "Six months of ledger entries, grouped by the month they occurred in.",
  noTrendTitle: "No ledger history yet",
  noTrendBody: "A month appears here as soon as it has a grant, a top-up or a generation charge.",

  campaignsHeading: "Credits by campaign",
  campaignsHint:
    "Settled generation charges, attributed through the reservation that authorised them. Work still running is under Reserved rather than here.",
  campaignsUnattributed: "Not attributed to a campaign",
  noCampaignsTitle: "No charges to attribute yet",
  noCampaignsBody: "A campaign appears here once one of its generation runs has settled.",

  generationsHeading: "Generations this period",
  generationsHint: "Provider runs started this period, by the kind of media they produce.",
  noGenerationsTitle: "Nothing generated yet",
  noGenerationsBody:
    "Generation runs appear here as soon as a campaign produces its first image, clip or voiceover.",

  planHeading: "Plan",
  planNoSubscription:
    "No subscription row exists for this organisation yet, so there is no plan, period or grant to report.",
  planUnconfigured:
    "The subscription is recorded as unconfigured: no billing provider is connected, so nothing renews and no grant is scheduled.",
  planCodeLabel: "Plan",
  planStatusLabel: "Status",
  planPeriodLabel: "Billing period",
  planIncludedLabel: "Credits per period",
  planPriceLabel: "Price",

  limitsHeading: "Account and publishing limits",
  limitsHint:
    "Resolved the way the server resolves them: a workspace override first, then the plan default. A limit that is not configured is not enforced, and is shown as not reported rather than as zero.",
  slotsLabel: "Account slots in use",
  slotsHint: "Licensed capacity for connected accounts. Archived slots keep their number and do not count.",
  generationLimitLabel: "Monthly generation limit",
  generationLimitNone: "No generation limit is configured, so generation is bounded by credits alone.",
  publishLimitLabel: "Monthly publish limit",
  publishLimitNone: "No publish limit is configured, so publishing is bounded by your connected accounts.",
  publishedLabel: "Published this period",

  reservationsHeading: "Currently reserved",
  reservationsHint:
    "Credits held for work that is already running. They are not spent — whatever the work does not use is returned automatically, and an abandoned batch releases its hold when it expires.",

  ledgerHeading: "Credit ledger",
  ledgerHint:
    "The ledger is append-only: corrections arrive as new entries rather than by editing history.",
  ledgerCap: (shown: number) =>
    `Showing the ${shown} most recent entries. Older entries still count towards the balance above.`,
  noLedgerTitle: "No ledger entries",
  noLedgerBody: "Grants, reservations and generation charges will appear here.",

  topUpHeading: "Top up",
  topUpLabel: "Top up credits",
  topUpHint: "Credits bought as a top-up never expire at the end of a period.",
  /**
   * Stated rather than hidden, for the same reason the team page states its
   * disabled invite: buying credits is a real capability of this role, and the
   * control belongs on the page, disabled and explained.
   */
  topUpUnavailable:
    "Buying credits needs a billing provider connected to this organisation. None is, so checkout is disabled rather than taking a payment it cannot complete.",
  noTopUpsTitle: "No packages available",
  noTopUpsBody: "Top-up packages are configured per deployment and none is available yet.",

  unmeteredTitle: "No provider configured",
  unmeteredBody:
    "MAGNIFIC_API_KEY is not set, so generation runs against a deterministic mock and reserves nothing. The figures below are real ledger entries; they simply have nothing to record yet.",

  /** Reservation purposes, in the user's vocabulary rather than the schema's. */
  purposeLabels: {
    campaign_batch: "Campaign batch",
    single_generation: "Single generation",
    regeneration: "Regeneration",
  } as Readonly<Record<string, string>>,

  /** Generation kinds, in the user's vocabulary rather than the schema's. */
  kindLabels: {
    image: "Images",
    video: "Video clips",
    audio: "Voice and audio",
  } as Readonly<Record<string, string>>,

  /** Subscription states, from the `subscriptions.status` CHECK constraint. */
  subscriptionStatusLabels: {
    active: "Active",
    trialing: "Trialing",
    past_due: "Past due",
    cancelled: "Cancelled",
    paused: "Paused",
    unconfigured: "Unconfigured",
  } as Readonly<Record<string, string>>,
} as const;
