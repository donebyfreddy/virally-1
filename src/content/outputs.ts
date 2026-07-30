import type { Provenance } from "./provenance";

export type OutputKind =
  | "vertical-video"
  | "square"
  | "carousel"
  | "thumbnail"
  | "landscape-video"
  | "written";

export type OutputItem = {
  id: string;
  kind: OutputKind;
  ratio: "9:16" | "4:5" | "1:1" | "16:9" | "4:3";
  title: string;
  campaign: string;
  platform: string;
  /** Present only where a verified figure exists. */
  result?: string;
  note: string;
  provenance: Provenance;
};

export const outputWall = {
  id: "outputs",
  eyebrow: "Output range",
  headline: "What comes out the other end.",
  body: "Every item below is labelled with where it came from. Nothing here is presented as customer work unless it is.",
  legend: [
    { status: "verified", label: "Customer output" },
    { status: "internal-demo", label: "Internal demonstration" },
    { status: "illustrative", label: "Illustrative placeholder" },
  ],
} as const;

/**
 * [REAL OUTPUT LIBRARY REQUIRED]
 *
 * These are internal demonstrations and illustrative placeholders. No handle,
 * avatar, view count or customer name is invented — where a real figure would
 * go, the field is simply absent. Add `provenance: { status: "verified", … }`
 * with a source and date when genuine work is cleared for use.
 */
export const outputItems: readonly OutputItem[] = [
  { id: "o1", kind: "vertical-video", ratio: "9:16", title: "Bioluminescence cold open", campaign: "Deep sea", platform: "Reels", note: "28s cut, hook B, end-card CTA.", provenance: { status: "internal-demo" } },
  { id: "o2", kind: "thumbnail", ratio: "16:9", title: "Why the deep glows", campaign: "Deep sea", platform: "YouTube", note: "Thumbnail variant, high-contrast type.", provenance: { status: "internal-demo" } },
  { id: "o3", kind: "carousel", ratio: "1:1", title: "Five creatures that make light", campaign: "Deep sea", platform: "Instagram", note: "Six-slide carousel with a final CTA slide.", provenance: { status: "internal-demo" } },
  { id: "o4", kind: "vertical-video", ratio: "9:16", title: "Anglerfish explainer", campaign: "Deep sea", platform: "TikTok", note: "Same script, hook C, faster cut rhythm.", provenance: { status: "illustrative" } },
  { id: "o5", kind: "landscape-video", ratio: "16:9", title: "Long-form cut", campaign: "Deep sea", platform: "YouTube", note: "Extended edit with chapters retained.", provenance: { status: "internal-demo" } },
  { id: "o6", kind: "square", ratio: "4:5", title: "Feed still, localised", campaign: "Deep sea", platform: "Facebook", note: "Spanish caption, recomposed for 4:5.", provenance: { status: "illustrative" } },
  { id: "o7", kind: "written", ratio: "4:3", title: "Script, hook B", campaign: "Deep sea", platform: "Draft", note: "Scene list, voiceover and caption timings.", provenance: { status: "internal-demo" } },
  { id: "o8", kind: "vertical-video", ratio: "9:16", title: "Loop-point test", campaign: "Deep sea", platform: "Reels", note: "Final frame rhymes with the first.", provenance: { status: "illustrative" } },
  { id: "o9", kind: "thumbnail", ratio: "16:9", title: "Alternate thumbnail", campaign: "Deep sea", platform: "YouTube", note: "Subject-left composition for A/B.", provenance: { status: "internal-demo" } },
] as const;
