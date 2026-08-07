import type { AspectRatio, Platform } from "@/types/database";
import type { Quality } from "./plan";
import type { ProductionMode } from "@/lib/creative/types";

/**
 * Quick Content's option vocabulary, input/output types and pure lookups.
 *
 * Split out of `quickContent.ts` because that file is `"use server"`, and a
 * server-actions file may only export async functions — a plain constant
 * array or a synchronous lookup imported from one breaks the client bundle
 * at build time (`findQuickPlatform` "doesn't exist" is the actual error;
 * Next.js strips everything that is not an action). Everything the client
 * composer needs to read without calling the server lives here instead.
 */

// --- Option vocabulary --------------------------------------------------------
//
// UI-facing option sets. Kept out of `content/create.ts` because they carry
// behaviour (a DB content_type, a default ratio, a Platform enum value or the
// absence of one) and not just labels.

export const QUICK_CONTENT_TYPES = [
  { id: "reel", label: "Reel / Short video", contentType: "short_video", hasDuration: true },
  { id: "image_post", label: "Image post", contentType: "image", hasDuration: false },
  { id: "carousel", label: "Carousel", contentType: "carousel", hasDuration: false },
  { id: "story", label: "Story", contentType: "short_video", hasDuration: true },
  { id: "long_video", label: "Long-form video", contentType: "long_video", hasDuration: true },
  { id: "ad_creative", label: "Ad creative", contentType: "short_video", hasDuration: true },
  { id: "thumbnail", label: "Thumbnail", contentType: "image", hasDuration: false },
  { id: "custom", label: "Custom", contentType: "short_video", hasDuration: true },
] as const satisfies readonly {
  id: string;
  label: string;
  contentType: "short_video" | "long_video" | "image" | "carousel" | "text";
  hasDuration: boolean;
}[];

export type QuickContentTypeId = (typeof QUICK_CONTENT_TYPES)[number]["id"];

/**
 * `dbPlatform` is null for three of these because `Platform` (the persisted
 * enum) only has four members today — see src/lib/db/enums.ts. A null here
 * means the content item is still created and still generated in full; it
 * simply gets no `content_variants` row, the same as choosing "no platform"
 * honestly should. Widening the enum is a schema change with its own
 * migration-ordering constraints (a value added by `ALTER TYPE ... ADD VALUE`
 * cannot be used in the same transaction that adds it), so it is left for a
 * follow-up rather than attempted without a database to verify it against.
 */
export const QUICK_PLATFORMS = [
  { id: "tiktok", label: "TikTok", ratio: "9:16", dbPlatform: "tiktok" },
  { id: "instagram_reels", label: "Instagram Reels", ratio: "9:16", dbPlatform: "instagram" },
  { id: "instagram_post", label: "Instagram Post", ratio: "4:5", dbPlatform: "instagram" },
  { id: "instagram_stories", label: "Instagram Stories", ratio: "9:16", dbPlatform: "instagram" },
  { id: "youtube_shorts", label: "YouTube Shorts", ratio: "9:16", dbPlatform: "youtube" },
  { id: "youtube", label: "YouTube", ratio: "16:9", dbPlatform: "youtube" },
  { id: "facebook", label: "Facebook", ratio: "1:1", dbPlatform: "facebook" },
  { id: "linkedin", label: "LinkedIn", ratio: "1:1", dbPlatform: null },
  { id: "x", label: "X", ratio: "16:9", dbPlatform: null },
  { id: "generic", label: "Generic / no platform", ratio: "9:16", dbPlatform: null },
] as const satisfies readonly {
  id: string;
  label: string;
  ratio: AspectRatio;
  dbPlatform: Platform | null;
}[];

export type QuickPlatformId = (typeof QUICK_PLATFORMS)[number]["id"];

export const QUICK_DURATIONS = [5, 10, 15, 30, 45, 60] as const;

export const QUICK_TONES = [
  { id: "educational", label: "Educational" },
  { id: "viral", label: "Viral" },
  { id: "cinematic", label: "Cinematic" },
  { id: "funny", label: "Funny" },
  { id: "professional", label: "Professional" },
  { id: "ugc", label: "UGC" },
  { id: "storytelling", label: "Storytelling" },
  { id: "promotional", label: "Promotional" },
  { id: "custom", label: "Custom" },
] as const;

export function findQuickContentType(id: string) {
  return QUICK_CONTENT_TYPES.find((entry) => entry.id === id) ?? QUICK_CONTENT_TYPES[0];
}

export function findQuickPlatform(id: string) {
  return QUICK_PLATFORMS.find((entry) => entry.id === id) ?? QUICK_PLATFORMS[QUICK_PLATFORMS.length - 1]!;
}

export function toneLabelFor(id: string): string {
  return QUICK_TONES.find((entry) => entry.id === id)?.label ?? id;
}

// Quick Content has no separate quality control — see the spec this module
// implements: production mode alone drives tier and cost. "standard" is the
// same default the campaign composer starts from.
export const QUICK_QUALITY: Quality = "standard";

// --- Input / output types ------------------------------------------------------

export type QuickContentInput = {
  prompt: string;
  contentTypeId: string;
  platformId: string;
  /** Explicit override. Falls back to the platform's default when absent. */
  ratio?: AspectRatio;
  /** Ignored for content types with `hasDuration: false`. */
  durationSeconds?: number;
  tone: string;
  productionMode: ProductionMode;
  withVoiceover: boolean;
  withMusic: boolean;
};

export type QuickContentPlanRow = {
  position: number;
  role: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type QuickContentAssetCounts = {
  generatedImages: number;
  aiVideoClips: number;
  voiceovers: number;
  musicTracks: number;
  compositions: number;
};

export type QuickContentPlan = {
  contentId: string;
  title: string;
  hook: string;
  contentTypeLabel: string;
  ratio: AspectRatio;
  durationSeconds: number | null;
  structure: readonly QuickContentPlanRow[];
  assets: QuickContentAssetCounts;
  estimatedCredits: number;
  /** True when the plan text came from the deterministic mock, not a real model. */
  isMock: boolean;
};

export type QuickActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const VALID_QUICK_RATIOS = new Set<AspectRatio>([
  "9:16",
  "4:5",
  "1:1",
  "16:9",
  "4:3",
  "3:2",
  "custom",
]);
export const VALID_QUICK_MODES = new Set<ProductionMode>(["fast", "hybrid", "cinematic"]);

/** Narrows the jsonb column back to the shape `planQuickContent` wrote. */
export function isQuickContentPlanSnapshot(
  value: unknown,
): value is Omit<QuickContentPlan, "contentId"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "assets" in value &&
    "structure" in value &&
    "estimatedCredits" in value
  );
}
