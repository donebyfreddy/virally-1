import type { MetricFormat } from "@/lib/format";
import type { Provenance } from "./provenance";

export type ProofMetric = {
  id: string;
  label: string;
  value: number;
  format: MetricFormat;
  /** One short line explaining what the figure counts. */
  note: string;
  provenance: Provenance;
};

/**
 * S2 — the capability ledger.
 *
 * Two rows. The first states what the system provably does today: these are
 * facts about the product, not outcomes, so they need no external source. The
 * second carries volume figures.
 *
 * The volume figures below are ILLUSTRATIVE samples supplied for layout, not
 * measurements. Replace `status: "illustrative"` with a `verified` entry —
 * source, URL and date — once real telemetry exists, and the count-ups switch
 * on automatically.
 */

export type CapabilityFact = {
  id: string;
  label: string;
  value: string;
  note: string;
};

export const capabilityFacts: readonly CapabilityFact[] = [
  {
    id: "formats",
    label: "Output formats",
    value: "5 + custom",
    note: "9:16, 4:5, 1:1, 16:9, 4:3 and custom sizes, each recomposed rather than cropped.",
  },
  {
    id: "channels",
    label: "Connected channels",
    value: "4 live",
    note: "Instagram, TikTok, YouTube and Facebook through official authorisation flows.",
  },
  {
    id: "review",
    label: "Publishing model",
    value: "Review first",
    note: "Nothing reaches an account until you approve it. Permissions are revocable.",
  },
  {
    id: "credentials",
    label: "Account access",
    value: "OAuth only",
    note: "Virally never asks for, stores or transmits your social passwords.",
  },
] as const;

export const volumeMetrics: readonly ProofMetric[] = [
  {
    id: "campaigns",
    label: "Campaigns generated",
    value: 12480,
    format: "count",
    note: "Briefs turned into a full campaign plan.",
    provenance: { status: "illustrative" },
  },
  {
    id: "assets",
    label: "Assets produced",
    value: 386000,
    format: "compact",
    note: "Scripts, videos, images, voiceovers and thumbnails.",
    provenance: { status: "illustrative" },
  },
  {
    id: "accounts",
    label: "Connected accounts",
    value: 3140,
    format: "count",
    note: "Authorised through official platform flows.",
    provenance: { status: "illustrative" },
  },
  {
    id: "posts",
    label: "Posts published",
    value: 91200,
    format: "compact",
    note: "Approved by a human before going out.",
    provenance: { status: "illustrative" },
  },
] as const;

export const proofSection = {
  id: "proof",
  eyebrow: "What the system does",
  headline: "A production line, not a prompt box.",
  body: "Virally is measured by what it can put on a channel, in the right shape, with your approval. These are the parts of that claim you can check.",
} as const;
