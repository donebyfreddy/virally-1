import type { Provenance } from "./provenance";

export type EvidenceBlock = {
  id: string;
  /** The figure itself, pre-formatted — these are not animated. */
  figure: string;
  label: string;
  explanation: string;
  provenance: Provenance;
};

/**
 * S3 — the content bottleneck.
 *
 * Two of the three blocks are ARITHMETIC, not research: the multiplication of
 * concepts by hooks by formats by platforms is verifiable by the reader and
 * needs no citation. That is deliberate — a self-evident calculation is
 * stronger evidence on a marketing page than a statistic nobody checks.
 *
 * The third is a time estimate and is marked illustrative. If you want to
 * present it as research, attach a real source, URL and date and change the
 * provenance to `verified`. Do not invent a citation.
 */
export const bottleneck = {
  id: "bottleneck",
  eyebrow: "The bottleneck",
  headline: "Your best idea should not die in one format.",
  body: "One concept can become dozens of useful experiments—but manually rewriting, editing, resizing, scheduling and tracking every version makes consistent output impossible.",
  /** The tile that splits, and what it splits into. */
  sourceLabel: "One finished video",
  splits: [
    { id: "s1", ratio: "9:16", label: "Reels / Shorts / TikTok" },
    { id: "s2", ratio: "4:5", label: "Feed video" },
    { id: "s3", ratio: "1:1", label: "Square + carousel" },
    { id: "s4", ratio: "16:9", label: "Landscape / YouTube" },
    { id: "s5", ratio: "4:3", label: "Legacy + display" },
  ],
  closing:
    "Each version needs its own framing, caption placement, safe areas, hook and thumbnail. Do that by hand and the number of experiments you can run is capped by your editing time, not by your ideas.",
} as const;

export const evidenceBlocks: readonly EvidenceBlock[] = [
  {
    id: "multiplication",
    figure: "60",
    label: "Assets from a single concept",
    explanation:
      "3 hooks × 5 formats × 4 platforms. Simple multiplication — and the reason manual adaptation stops being viable almost immediately.",
    provenance: { status: "internal-demo" },
  },
  {
    id: "coverage",
    figure: "1 of 60",
    label: "What one manual export covers",
    explanation:
      "Publishing a single 9:16 cut to one channel tests one hook, one format and one audience. Every conclusion drawn from it rests on one data point.",
    provenance: { status: "internal-demo" },
  },
  {
    id: "time",
    figure: "~6 hrs",
    label: "To adapt one concept by hand",
    explanation:
      "Reframing, re-captioning, re-cutting and scheduling every version of one idea across four channels. Illustrative estimate — attach measured data before presenting this as research.",
    provenance: { status: "illustrative" },
  },
] as const;
