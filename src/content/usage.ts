/**
 * Usage-page copy.
 *
 * No figure lives here. Every number on the page is read from the ledger at
 * request time; a hardcoded example in copy would eventually contradict the
 * real data sitting next to it.
 */
export const usageCopy = {
  eyebrow: "Account",
  heading: "Usage",
  body: "Every figure below is a sum of the credit ledger and the generation runs behind it. Nothing here is a cached counter, so it can always be reconciled against the entries listed at the bottom of this page.",

  availableLabel: "Available",
  reservedLabel: "Reserved",
  usedLabel: "Used this period",
  includedLabel: "Granted this period",

  consumptionHeading: "Consumption against grant",

  reservationsHeading: "Currently reserved",
  reservationsHint:
    "Credits held for work that is already running. They are not spent — whatever the work does not use is returned automatically, and an abandoned batch releases its hold when it expires.",

  generationsHeading: "Generations this period",
  noGenerationsTitle: "NOTHING GENERATED YET",
  noGenerationsBody:
    "Generation runs appear here as soon as a campaign produces its first image, clip or voiceover.",

  ledgerHeading: "Credit ledger",
  ledgerHint:
    "The last 25 entries. The balance above is the sum of every entry in this ledger, which is append-only — corrections are added as new entries rather than by editing history.",
  noLedgerTitle: "NO LEDGER ENTRIES",
  noLedgerBody: "Grants, reservations and generation charges will appear here.",

  unmeteredTitle: "NO PROVIDER CONFIGURED",
  unmeteredBody:
    "MAGNIFIC_API_KEY is not set, so generation runs against a deterministic mock and costs nothing. The figures below are real ledger entries; they simply have nothing to record yet.",

  /** Reservation purposes, in the user's vocabulary rather than the schema's. */
  purposeLabels: {
    campaign_batch: "Campaign batch",
    single_generation: "Single generation",
    regeneration: "Regeneration",
  } as Readonly<Record<string, string>>,
} as const;
