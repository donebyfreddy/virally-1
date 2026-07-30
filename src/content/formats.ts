import type { FormatKey } from "@/lib/multiplier";

export type FormatDefinition = {
  key: FormatKey;
  label: string;
  pixels: string;
  usedFor: string;
  /** How the composition is rebuilt for this ratio, not merely cropped. */
  recomposition: {
    subject: string;
    caption: string;
    safeArea: string;
    cta: string;
    runtime: string;
  };
  /** Subject position as a percentage of the frame, drives the demo diagram. */
  subject: { x: number; y: number; size: number };
  /** Caption band position and width, also percentages. */
  caption: { y: number; width: number };
};

export const formatEngine = {
  id: "formats",
  eyebrow: "Format engine",
  headline: "Designed again for every format.",
  body: "Virally rebuilds the composition around each platform instead of applying a blind crop.",
  explanation:
    "A blind crop takes a 16:9 frame, cuts the sides off and hopes the subject was in the middle. Recomposition moves the subject, repositions the caption, respects the platform's own safe areas and re-places the call to action — so a vertical cut is a vertical edit, not a damaged horizontal one.",
  selectorLabel: "Output format",
} as const;

export const formats: readonly FormatDefinition[] = [
  {
    key: "9:16",
    label: "9:16",
    pixels: "1080 × 1920",
    usedFor: "Reels · Shorts · TikTok",
    recomposition: {
      subject: "Raised to the upper third, clear of the caption stack",
      caption: "Full-width, two lines maximum, above the interface furniture",
      safeArea: "Bottom 22% reserved for platform UI",
      cta: "End card, last 2 seconds",
      runtime: "Trimmed to 28s for completion rate",
    },
    subject: { x: 50, y: 34, size: 46 },
    caption: { y: 62, width: 84 },
  },
  {
    key: "4:5",
    label: "4:5",
    pixels: "1080 × 1350",
    usedFor: "Feed video · Feed image",
    recomposition: {
      subject: "Centred with headroom for the feed crop preview",
      caption: "Two-line band, inset from the edges",
      safeArea: "Top 8% clear of the profile overlay",
      cta: "Caption-first, in-post",
      runtime: "Full length, feed autoplay",
    },
    subject: { x: 50, y: 42, size: 52 },
    caption: { y: 72, width: 78 },
  },
  {
    key: "1:1",
    label: "1:1",
    pixels: "1080 × 1080",
    usedFor: "Square · Carousel",
    recomposition: {
      subject: "Centred, tighter framing to survive the square cut",
      caption: "Single line, high contrast",
      safeArea: "Even margins for carousel pagination",
      cta: "Final slide",
      runtime: "Split across slides",
    },
    subject: { x: 50, y: 45, size: 56 },
    caption: { y: 78, width: 72 },
  },
  {
    key: "16:9",
    label: "16:9",
    pixels: "1920 × 1080",
    usedFor: "YouTube · Landscape",
    recomposition: {
      subject: "Off-centre on the left third, room for supporting detail",
      caption: "Lower third, narrow measure",
      safeArea: "Right edge clear of the player controls",
      cta: "End screen with subscribe window",
      runtime: "Extended cut, chapters retained",
    },
    subject: { x: 34, y: 48, size: 44 },
    caption: { y: 80, width: 46 },
  },
  {
    key: "4:3",
    label: "4:3",
    pixels: "1440 × 1080",
    usedFor: "Legacy · Display",
    recomposition: {
      subject: "Centred, wider margin to tolerate letterboxing",
      caption: "Compact band, no full-bleed text",
      safeArea: "5% border on all sides",
      cta: "Static overlay",
      runtime: "Full length",
    },
    subject: { x: 50, y: 46, size: 50 },
    caption: { y: 79, width: 62 },
  },
] as const;
