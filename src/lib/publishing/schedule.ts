import type { Platform } from "@/types/database";

/**
 * Publish plan generation and idempotency keys.
 *
 * The requirement this file exists to satisfy: "never duplicate a post because of a
 * retry", and "do not send 100 simultaneous uncontrolled API requests".
 *
 * Idempotency is layered. The database owns the final guarantee (see migration 0009),
 * and this module owns the key derivation — the key must be a pure function of *what
 * is being published where and when*, never of when the request happened. A key
 * containing a timestamp or a random value defeats the constraint it feeds.
 */

export type SlotRequest = {
  variantIds: readonly string[];
  accountIds: readonly string[];
  /** Inclusive start of the publishing window. */
  startAt: Date;
  /** Inclusive end. A plan is spread across this range. */
  endAt: Date;
  cadence: Cadence;
  /** Local hours at which posts may go out, 0–23. */
  timeWindows: readonly number[];
  timezoneOffsetMinutes: number;
  maxPerAccountPerDay: number;
};

export type Cadence = "asap" | "even_spread" | "daily" | "weekdays";

export type PlannedPost = {
  variantId: string;
  accountId: string;
  scheduledFor: Date;
  idempotencyKey: string;
};

export type PlanResult = {
  posts: readonly PlannedPost[];
  /** Pairs that could not be placed inside the window, with the reason. */
  unplaced: readonly { variantId: string; accountId: string; reason: string }[];
};

const MS_PER_DAY = 86_400_000;

/**
 * Derives the idempotency key for one publish intent.
 *
 * Pure and stable: the same variant, account and minute always produce the same key,
 * so re-submitting a plan collides with the existing row instead of creating a second
 * post. The minute is the granularity because two posts of the same content to the
 * same account within one minute is never intentional.
 *
 * Deliberately does NOT include: the current time, a random nonce, a plan id, or an
 * attempt number. Any of those would make a retry produce a fresh key, which is
 * exactly the duplicate-publish bug.
 */
export function publishIdempotencyKey(
  variantId: string,
  accountId: string,
  scheduledFor: Date,
): string {
  const minute = Math.floor(scheduledFor.getTime() / 60_000);
  return `publish:${variantId}:${accountId}:${minute}`;
}

/** Key for a generation job. Same reasoning: derived from the work, not the request. */
export function generationIdempotencyKey(
  stage: string,
  subjectId: string,
  attemptSalt?: string,
): string {
  // `attemptSalt` exists for the deliberate-regeneration case: a user asking to
  // regenerate one shot genuinely wants new work, so the caller passes a stable
  // discriminator (a revision number), never a timestamp.
  return attemptSalt
    ? `gen:${stage}:${subjectId}:${attemptSalt}`
    : `gen:${stage}:${subjectId}`;
}

function startOfUtcDay(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY) * MS_PER_DAY;
}

function isWeekend(dayStartMs: number, offsetMinutes: number): boolean {
  // Evaluated in the account's local frame, since "weekdays" means the user's week.
  const local = new Date(dayStartMs + offsetMinutes * 60_000);
  const day = local.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Builds the exact publish plan.
 *
 * Every slot is enumerated up front so the user sees precisely which post goes to
 * which account at which time BEFORE confirming. The brief requires that preview;
 * generating slots lazily at execution time would make it impossible.
 */
export function buildPlan(request: SlotRequest): PlanResult {
  const posts: PlannedPost[] = [];
  const unplaced: { variantId: string; accountId: string; reason: string }[] = [];

  const windows = [...new Set(request.timeWindows)]
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    .sort((a, b) => a - b);

  // A plan with no valid hour cannot place anything; say so once rather than
  // reporting every pair as unplaced for the same reason.
  if (windows.length === 0) {
    for (const variantId of request.variantIds) {
      for (const accountId of request.accountIds) {
        unplaced.push({
          variantId,
          accountId,
          reason: "No valid publishing hour was selected.",
        });
      }
    }
    return { posts, unplaced };
  }

  if (request.endAt.getTime() < request.startAt.getTime()) {
    for (const variantId of request.variantIds) {
      for (const accountId of request.accountIds) {
        unplaced.push({ variantId, accountId, reason: "The end date is before the start date." });
      }
    }
    return { posts, unplaced };
  }

  // Candidate days, filtered by cadence.
  const days: number[] = [];
  const firstDay = startOfUtcDay(request.startAt);
  const lastDay = startOfUtcDay(request.endAt);
  for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
    if (request.cadence === "weekdays" && isWeekend(day, request.timezoneOffsetMinutes)) continue;
    days.push(day);
  }

  if (days.length === 0) {
    for (const variantId of request.variantIds) {
      for (const accountId of request.accountIds) {
        unplaced.push({
          variantId,
          accountId,
          reason: "The selected window contains no eligible days.",
        });
      }
    }
    return { posts, unplaced };
  }

  const perAccountPerDay = new Map<string, number>();
  const maxPerDay = Math.max(1, Math.trunc(request.maxPerAccountPerDay));

  /**
   * Iteration order is account-major so each account's posts are spread across the
   * window rather than one account being saturated before the next begins. The
   * alternative (variant-major) produces plans where account 1 posts twelve times on
   * day one and account 12 never posts at all.
   */
  for (const accountId of request.accountIds) {
    let cursor = 0;

    for (const variantId of request.variantIds) {
      let placed = false;

      // Walk forward from the cursor so each variant takes the next free slot.
      for (let step = 0; step < days.length * windows.length; step += 1) {
        const index = cursor + step;
        const dayIndex = Math.floor(index / windows.length);
        const windowIndex = index % windows.length;

        if (dayIndex >= days.length) break;

        const dayStart = days[dayIndex];
        const hour = windows[windowIndex];
        if (dayStart === undefined || hour === undefined) break;

        const dayKey = `${accountId}:${dayIndex}`;
        if ((perAccountPerDay.get(dayKey) ?? 0) >= maxPerDay) continue;

        // Local hour converted back to absolute time.
        const scheduledMs = dayStart + hour * 3_600_000 - request.timezoneOffsetMinutes * 60_000;

        // "asap" still respects the window's start; it just packs from the front.
        if (scheduledMs < request.startAt.getTime() && request.cadence !== "asap") {
          continue;
        }

        const scheduledFor = new Date(scheduledMs);
        posts.push({
          variantId,
          accountId,
          scheduledFor,
          idempotencyKey: publishIdempotencyKey(variantId, accountId, scheduledFor),
        });

        perAccountPerDay.set(dayKey, (perAccountPerDay.get(dayKey) ?? 0) + 1);
        cursor = index + 1;
        placed = true;
        break;
      }

      if (!placed) {
        unplaced.push({
          variantId,
          accountId,
          reason: `The window has no remaining slot within the ${maxPerDay}-per-day limit. Extend the date range or raise the limit.`,
        });
      }
    }
  }

  return { posts, unplaced };
}

/**
 * Concurrency plan for executing the batch.
 *
 * Returns the wave structure rather than executing anything, so it is testable and so
 * the UI can state how the work will proceed. Per-platform caps exist because platform
 * rate limits are per-app, not per-account: firing 100 Instagram uploads at once
 * exhausts the app's quota and fails the rest.
 */
export const PLATFORM_CONCURRENCY: Readonly<Record<Platform, number>> = {
  instagram: 2,
  facebook: 3,
  tiktok: 2,
  youtube: 1,
};

export function planConcurrency(
  posts: readonly { platform: Platform }[],
): readonly { platform: Platform; total: number; concurrency: number; waves: number }[] {
  const byPlatform = new Map<Platform, number>();
  for (const post of posts) {
    byPlatform.set(post.platform, (byPlatform.get(post.platform) ?? 0) + 1);
  }

  return [...byPlatform.entries()].map(([platform, total]) => {
    const concurrency = PLATFORM_CONCURRENCY[platform];
    return { platform, total, concurrency, waves: Math.ceil(total / concurrency) };
  });
}

/**
 * Whether a failed attempt is safe to retry automatically.
 *
 * The dangerous case is a timeout AFTER the upload began: the post may exist on the
 * platform even though we never got a response, so retrying could double-post. Those
 * return false, and the UI must ask the user to check the account rather than
 * offering a retry button.
 */
export function isRetrySafe(failure: {
  code: string;
  httpStatus: number | null;
  uploadStarted: boolean;
}): boolean {
  // Anything that never reached the platform is safe.
  if (!failure.uploadStarted) return true;

  // Explicit platform rejections are safe: the post was refused, not created.
  const SAFE_REJECTIONS = new Set([
    "invalid_media",
    "invalid_caption",
    "unsupported_format",
    "permission_denied",
    "token_expired",
  ]);
  if (SAFE_REJECTIONS.has(failure.code)) return true;

  // Rate limiting is safe — the request was refused before processing.
  if (failure.httpStatus === 429) return true;

  // A timeout or 5xx after the upload started is ambiguous. Fail closed.
  return false;
}

export function retryDelayMs(attempt: number): number {
  // Exponential with a ceiling. Capped at five minutes so a transient platform
  // outage does not push a scheduled post hours past its slot.
  const base = 15_000;
  const delay = base * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, 300_000);
}
