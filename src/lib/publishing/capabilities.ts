import type { AspectRatio, Platform } from "@/types/database";

/**
 * Platform capability validation.
 *
 * Runs before a publish plan is created, so a user is told "TikTok will not accept
 * a 16:9 video" while they can still change it — rather than discovering it as 400
 * failed jobs.
 *
 * Capability data is DATA, loaded from `platform_capabilities`, not constants in this
 * file. The brief is explicit that a single universal capability set must not be
 * hardcoded: platforms differ per account type, and they change without warning.
 * This module is the validator; the table is the source of truth.
 */

export type CapabilityRecord = {
  platform: Platform;
  accountKind: string;
  capability: string;
  isSupported: boolean;
  requiresAppReview: boolean;
  maxDurationSeconds: number | null;
  maxFileSizeMb: number | null;
  supportedRatios: readonly AspectRatio[];
  notes: string | null;
};

export type ContentDescriptor = {
  platform: Platform;
  accountKind: string;
  kind: "video" | "image" | "carousel" | "text";
  ratio: AspectRatio;
  durationSeconds: number | null;
  fileSizeMb: number | null;
};

export type ValidationIssue = {
  /** Blocking issues prevent scheduling; warnings do not. */
  severity: "blocking" | "warning";
  code: string;
  message: string;
  /** What the user can do about it. Null when there is no in-product remedy. */
  remedy: string | null;
};

export type ValidationResult = {
  ok: boolean;
  issues: readonly ValidationIssue[];
};

const CAPABILITY_BY_KIND: Readonly<Record<ContentDescriptor["kind"], string>> = {
  video: "publish_video",
  image: "publish_image",
  carousel: "publish_carousel",
  text: "publish_text",
};

/** Indexes capability rows for O(1) lookup. */
export function indexCapabilities(
  records: readonly CapabilityRecord[],
): Map<string, CapabilityRecord> {
  const map = new Map<string, CapabilityRecord>();
  for (const record of records) {
    map.set(`${record.platform}:${record.accountKind}:${record.capability}`, record);
  }
  return map;
}

export function validateContent(
  content: ContentDescriptor,
  index: Map<string, CapabilityRecord>,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const capability = CAPABILITY_BY_KIND[content.kind];
  const record = index.get(`${content.platform}:${content.accountKind}:${capability}`);

  if (!record) {
    // Unknown is not the same as unsupported. Guessing either way would be wrong:
    // guessing "supported" queues jobs that fail, guessing "unsupported" blocks
    // something that may work. Say so and let the user decide.
    issues.push({
      severity: "warning",
      code: "capability_unknown",
      message: `Virally has no capability record for ${content.kind} on ${content.platform} for a ${content.accountKind} account, so it cannot confirm this will be accepted.`,
      remedy: "Publish one item as a test before scheduling a batch.",
    });
    return { ok: true, issues };
  }

  if (!record.isSupported) {
    issues.push({
      severity: "blocking",
      code: "capability_unsupported",
      message:
        record.notes ??
        `${content.platform} does not support publishing ${content.kind} for a ${content.accountKind} account through its official API.`,
      remedy:
        content.accountKind === "personal"
          ? "Convert the account to a professional account, then reconnect it."
          : "Choose a different platform or content type for this account.",
    });
  }

  if (record.requiresAppReview) {
    // A warning, not a blocker: review status is a property of the deployment's
    // platform app, which this function cannot see. Blocking here would make the
    // product unusable for anyone whose app IS approved.
    issues.push({
      severity: "warning",
      code: "requires_app_review",
      message: `${content.platform} requires platform app review before this capability works in production.`,
      remedy: "Confirm the platform app has been approved for this capability.",
    });
  }

  if (
    record.supportedRatios.length > 0 &&
    !record.supportedRatios.includes(content.ratio)
  ) {
    issues.push({
      severity: "blocking",
      code: "ratio_unsupported",
      message: `${content.platform} does not accept ${content.ratio} for ${content.kind}. It accepts ${record.supportedRatios.join(", ")}.`,
      remedy: `Add a ${record.supportedRatios[0]} variant — the script and voiceover are reused, so this is a recomposition, not a regeneration.`,
    });
  }

  if (
    record.maxDurationSeconds !== null &&
    content.durationSeconds !== null &&
    content.durationSeconds > record.maxDurationSeconds
  ) {
    issues.push({
      severity: "blocking",
      code: "duration_exceeded",
      message: `This is ${Math.round(content.durationSeconds)}s, above the ${record.maxDurationSeconds}s limit for ${content.platform}.`,
      remedy: "Trim the content or split it across several posts.",
    });
  }

  if (
    record.maxFileSizeMb !== null &&
    content.fileSizeMb !== null &&
    content.fileSizeMb > record.maxFileSizeMb
  ) {
    issues.push({
      severity: "blocking",
      code: "file_size_exceeded",
      message: `The file is ${Math.round(content.fileSizeMb)}MB, above the ${record.maxFileSizeMb}MB limit for ${content.platform}.`,
      remedy: "Re-render at a lower bitrate.",
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "blocking"),
    issues,
  };
}

/**
 * Content-fatigue and duplication checks across a whole batch.
 *
 * The brief requires warning about duplicate assets, repeated hooks, repeated
 * captions and excessive frequency. Posting byte-identical media to four platforms is
 * the single fastest way to get an account limited, so this runs before any plan is
 * confirmed.
 *
 * These are WARNINGS, never blocks. Cross-posting the same cut is sometimes exactly
 * what a user intends, and a tool that refuses is a tool they work around.
 */
export type BatchItem = {
  variantId: string;
  accountId: string;
  platform: Platform;
  contentHash: string | null;
  caption: string | null;
  hookText: string | null;
  scheduledFor: Date;
};

export function detectDuplication(items: readonly BatchItem[]): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const byHash = new Map<string, number>();
  const byCaption = new Map<string, number>();
  const byHook = new Map<string, number>();

  for (const item of items) {
    if (item.contentHash) {
      byHash.set(item.contentHash, (byHash.get(item.contentHash) ?? 0) + 1);
    }
    if (item.caption) {
      // Normalised before comparison: whitespace and case differences are not a
      // meaningful variation to a platform's duplicate detection.
      const key = item.caption.trim().toLowerCase().replace(/\s+/g, " ");
      if (key.length > 0) byCaption.set(key, (byCaption.get(key) ?? 0) + 1);
    }
    if (item.hookText) {
      const key = item.hookText.trim().toLowerCase().replace(/\s+/g, " ");
      if (key.length > 0) byHook.set(key, (byHook.get(key) ?? 0) + 1);
    }
  }

  const duplicateAssets = [...byHash.values()].filter((count) => count > 1).length;
  if (duplicateAssets > 0) {
    issues.push({
      severity: "warning",
      code: "duplicate_assets",
      message: `${duplicateAssets} media file${duplicateAssets === 1 ? " is" : "s are"} scheduled more than once. Platforms detect byte-identical uploads and may limit reach or flag the account.`,
      remedy: "Create a platform-specific variant instead of reusing the same render.",
    });
  }

  const repeatedCaptions = [...byCaption.values()].filter((count) => count > 1).length;
  if (repeatedCaptions > 0) {
    issues.push({
      severity: "warning",
      code: "repeated_captions",
      message: `${repeatedCaptions} caption${repeatedCaptions === 1 ? " is" : "s are"} used on more than one post.`,
      remedy: "Vary captions per platform — each has different length and tone conventions.",
    });
  }

  const repeatedHooks = [...byHook.values()].filter((count) => count > 2).length;
  if (repeatedHooks > 0) {
    issues.push({
      severity: "warning",
      code: "repeated_hooks",
      message: `${repeatedHooks} hook${repeatedHooks === 1 ? " is" : "s are"} reused across three or more posts, which limits what an experiment can tell you.`,
      remedy: "Generate additional hook variants for these concepts.",
    });
  }

  return issues;
}

/**
 * Publishing frequency per account.
 *
 * `maxPerDay` is a conservative default, not a platform-published limit — platforms
 * do not document these, and claiming a specific number as official would be
 * inventing a fact. It is framed to the user as our recommendation.
 */
export const RECOMMENDED_MAX_PER_DAY: Readonly<Record<Platform, number>> = {
  instagram: 3,
  tiktok: 4,
  youtube: 2,
  facebook: 5,
};

export function detectFrequencyIssues(
  items: readonly BatchItem[],
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const perAccountDay = new Map<string, { count: number; platform: Platform }>();

  for (const item of items) {
    // UTC day key. Deliberately coarse: the recommendation is about volume, and
    // resolving each account's local timezone here would imply a precision the
    // underlying guidance does not have.
    const day = item.scheduledFor.toISOString().slice(0, 10);
    const key = `${item.accountId}:${day}`;
    const existing = perAccountDay.get(key);
    perAccountDay.set(key, {
      count: (existing?.count ?? 0) + 1,
      platform: item.platform,
    });
  }

  const offenders = [...perAccountDay.entries()].filter(
    ([, value]) => value.count > RECOMMENDED_MAX_PER_DAY[value.platform],
  );

  if (offenders.length > 0) {
    const worst = offenders.reduce((max, entry) => (entry[1].count > max[1].count ? entry : max));
    issues.push({
      severity: "warning",
      code: "frequency_high",
      message: `One or more accounts are scheduled above the recommended daily volume — the busiest has ${worst[1].count} posts in a day, where we suggest at most ${RECOMMENDED_MAX_PER_DAY[worst[1].platform]} for ${worst[1].platform}.`,
      remedy: "Spread the plan over more days, or add more accounts to the group.",
    });
  }

  return issues;
}
