import { describe, expect, it } from "vitest";
import {
  detectDuplication,
  detectFrequencyIssues,
  indexCapabilities,
  validateContent,
  type BatchItem,
  type CapabilityRecord,
  type ContentDescriptor,
} from "./capabilities";
import {
  buildPlan,
  generationIdempotencyKey,
  isRetrySafe,
  planConcurrency,
  publishIdempotencyKey,
  retryDelayMs,
  type SlotRequest,
} from "./schedule";

// --- capability validation ---------------------------------------------------

const CAPABILITIES: CapabilityRecord[] = [
  {
    platform: "instagram",
    accountKind: "business",
    capability: "publish_video",
    isSupported: true,
    requiresAppReview: true,
    maxDurationSeconds: 900,
    maxFileSizeMb: 1024,
    supportedRatios: ["9:16", "1:1", "4:5"],
    notes: null,
  },
  {
    platform: "instagram",
    accountKind: "personal",
    capability: "publish_video",
    isSupported: false,
    requiresAppReview: false,
    maxDurationSeconds: null,
    maxFileSizeMb: null,
    supportedRatios: [],
    notes: "Personal accounts cannot be published to via the official API.",
  },
  {
    platform: "tiktok",
    accountKind: "creator",
    capability: "publish_video",
    isSupported: true,
    requiresAppReview: true,
    maxDurationSeconds: 600,
    maxFileSizeMb: 4096,
    supportedRatios: ["9:16"],
    notes: null,
  },
];

const index = indexCapabilities(CAPABILITIES);

function descriptor(overrides: Partial<ContentDescriptor> = {}): ContentDescriptor {
  return {
    platform: "instagram",
    accountKind: "business",
    kind: "video",
    ratio: "9:16",
    durationSeconds: 30,
    fileSizeMb: 40,
    ...overrides,
  };
}

describe("validateContent", () => {
  it("accepts supported content", () => {
    const result = validateContent(descriptor(), index);
    expect(result.ok).toBe(true);
    // App review is a warning, not a block — the deployment's app may be approved.
    expect(result.issues.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("blocks an unsupported account type and explains the fix", () => {
    const result = validateContent(descriptor({ accountKind: "personal" }), index);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === "capability_unsupported");
    expect(issue?.severity).toBe("blocking");
    expect(issue?.remedy).toMatch(/professional account/i);
  });

  it("blocks a ratio the platform will not accept", () => {
    const result = validateContent(descriptor({ platform: "tiktok", accountKind: "creator", ratio: "16:9" }), index);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === "ratio_unsupported");
    expect(issue?.message).toContain("9:16");
    // The remedy should point out recomposition is cheap, not suggest regenerating.
    expect(issue?.remedy).toMatch(/recomposition, not a regeneration/i);
  });

  it("blocks content over the duration limit with the real numbers", () => {
    const result = validateContent(descriptor({ platform: "tiktok", accountKind: "creator", durationSeconds: 700 }), index);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.code === "duration_exceeded");
    expect(issue?.message).toContain("700");
    expect(issue?.message).toContain("600");
  });

  it("blocks content over the file size limit", () => {
    const result = validateContent(descriptor({ fileSizeMb: 2048 }), index);
    expect(result.issues.some((i) => i.code === "file_size_exceeded")).toBe(true);
  });

  it("warns rather than guessing when no capability record exists", () => {
    // Guessing "supported" queues jobs that fail; guessing "unsupported" blocks
    // something that may work. Neither is acceptable, so it says it does not know.
    const result = validateContent(descriptor({ platform: "youtube", accountKind: "channel" }), index);
    expect(result.ok).toBe(true);
    const issue = result.issues.find((i) => i.code === "capability_unknown");
    expect(issue?.severity).toBe("warning");
    expect(issue?.remedy).toMatch(/test before scheduling a batch/i);
  });

  it("reports several blocking problems at once", () => {
    const result = validateContent(
      descriptor({ platform: "tiktok", accountKind: "creator", ratio: "16:9", durationSeconds: 900 }),
      index,
    );
    const blocking = result.issues.filter((i) => i.severity === "blocking");
    expect(blocking.length).toBeGreaterThanOrEqual(2);
  });

  it("never returns an issue without a message", () => {
    // These strings render directly in the failure UI.
    for (const kind of ["video", "image", "carousel", "text"] as const) {
      const result = validateContent(descriptor({ kind }), index);
      for (const issue of result.issues) {
        expect(issue.message.length).toBeGreaterThan(10);
      }
    }
  });
});

// --- duplication and fatigue -------------------------------------------------

function batchItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    variantId: "v1",
    accountId: "a1",
    platform: "instagram",
    contentHash: "hash-1",
    caption: "A caption",
    hookText: "A hook",
    scheduledFor: new Date("2026-08-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("detectDuplication", () => {
  it("finds nothing in a fully distinct batch", () => {
    const issues = detectDuplication([
      batchItem({ variantId: "v1", contentHash: "h1", caption: "c1", hookText: "k1" }),
      batchItem({ variantId: "v2", contentHash: "h2", caption: "c2", hookText: "k2" }),
    ]);
    expect(issues).toEqual([]);
  });

  it("warns about byte-identical media scheduled more than once", () => {
    const issues = detectDuplication([
      batchItem({ contentHash: "same", caption: "a", hookText: "x" }),
      batchItem({ contentHash: "same", caption: "b", hookText: "y" }),
    ]);
    const issue = issues.find((i) => i.code === "duplicate_assets");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toMatch(/limit reach or flag the account/i);
  });

  it("normalises captions before comparing", () => {
    // Case and whitespace are not a meaningful variation to platform dedupe.
    const issues = detectDuplication([
      batchItem({ contentHash: "h1", caption: "Same Caption", hookText: "x" }),
      batchItem({ contentHash: "h2", caption: "  same   caption  ", hookText: "y" }),
    ]);
    expect(issues.some((i) => i.code === "repeated_captions")).toBe(true);
  });

  it("tolerates a hook reused twice but warns at three", () => {
    // Cross-posting one hook to two platforms is normal; three is a fatigue signal.
    const twice = detectDuplication([
      batchItem({ contentHash: "h1", caption: "a", hookText: "same hook" }),
      batchItem({ contentHash: "h2", caption: "b", hookText: "same hook" }),
    ]);
    expect(twice.some((i) => i.code === "repeated_hooks")).toBe(false);

    const thrice = detectDuplication([
      batchItem({ contentHash: "h1", caption: "a", hookText: "same hook" }),
      batchItem({ contentHash: "h2", caption: "b", hookText: "same hook" }),
      batchItem({ contentHash: "h3", caption: "c", hookText: "same hook" }),
    ]);
    expect(thrice.some((i) => i.code === "repeated_hooks")).toBe(true);
  });

  it("ignores null hashes and captions rather than treating them as equal", () => {
    // Two unrendered variants both have a null hash; that is not a duplicate.
    const issues = detectDuplication([
      batchItem({ contentHash: null, caption: null, hookText: null }),
      batchItem({ contentHash: null, caption: null, hookText: null }),
    ]);
    expect(issues).toEqual([]);
  });

  it("never blocks — duplication is always advisory", () => {
    // Cross-posting the same cut is sometimes exactly what the user intends.
    const issues = detectDuplication([
      batchItem({ contentHash: "same" }),
      batchItem({ contentHash: "same" }),
    ]);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("detectFrequencyIssues", () => {
  it("accepts a reasonable cadence", () => {
    const issues = detectFrequencyIssues([
      batchItem({ scheduledFor: new Date("2026-08-01T09:00:00Z") }),
      batchItem({ scheduledFor: new Date("2026-08-02T09:00:00Z") }),
    ]);
    expect(issues).toEqual([]);
  });

  it("warns when one account is scheduled far too often in a day", () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      batchItem({ scheduledFor: new Date(`2026-08-01T0${i}:00:00Z`) }),
    );
    const issues = detectFrequencyIssues(items);
    const issue = issues.find((i) => i.code === "frequency_high");
    expect(issue?.severity).toBe("warning");
    // Must state the real number rather than a vague "too many".
    expect(issue?.message).toContain("9");
  });

  it("counts each account separately", () => {
    // Twelve posts across twelve accounts is one each, not a frequency problem.
    const items = Array.from({ length: 12 }, (_, i) =>
      batchItem({ accountId: `a${i}`, scheduledFor: new Date("2026-08-01T09:00:00Z") }),
    );
    expect(detectFrequencyIssues(items)).toEqual([]);
  });
});

// --- idempotency -------------------------------------------------------------

describe("publishIdempotencyKey", () => {
  it("is stable for the same intent", () => {
    const when = new Date("2026-08-01T10:00:00Z");
    expect(publishIdempotencyKey("v1", "a1", when)).toBe(publishIdempotencyKey("v1", "a1", when));
  });

  it("differs by variant, account and slot", () => {
    const when = new Date("2026-08-01T10:00:00Z");
    const later = new Date("2026-08-01T11:00:00Z");
    const base = publishIdempotencyKey("v1", "a1", when);
    expect(publishIdempotencyKey("v2", "a1", when)).not.toBe(base);
    expect(publishIdempotencyKey("v1", "a2", when)).not.toBe(base);
    expect(publishIdempotencyKey("v1", "a1", later)).not.toBe(base);
  });

  it("ignores sub-minute jitter", () => {
    // Two identical posts to one account seconds apart is never intentional, and
    // collapsing them is what makes a re-submitted plan collide instead of duplicate.
    const a = publishIdempotencyKey("v1", "a1", new Date("2026-08-01T10:00:05Z"));
    const b = publishIdempotencyKey("v1", "a1", new Date("2026-08-01T10:00:55Z"));
    expect(a).toBe(b);
  });

  it("contains no timestamp of when it was generated", () => {
    // The regression that would reintroduce duplicate publishing: a key that changes
    // per request makes every retry a fresh row.
    const key = publishIdempotencyKey("v1", "a1", new Date("2026-08-01T10:00:00Z"));
    const again = publishIdempotencyKey("v1", "a1", new Date("2026-08-01T10:00:00Z"));
    expect(key).toBe(again);
    expect(key).not.toMatch(/\d{13}/);
  });
});

describe("generationIdempotencyKey", () => {
  it("is stable without a salt", () => {
    expect(generationIdempotencyKey("script", "item-1")).toBe(
      generationIdempotencyKey("script", "item-1"),
    );
  });

  it("changes with an explicit revision salt", () => {
    // Deliberate regeneration must produce new work; the salt is a revision number,
    // never a timestamp.
    expect(generationIdempotencyKey("script", "item-1", "2")).not.toBe(
      generationIdempotencyKey("script", "item-1", "1"),
    );
  });
});

// --- plan building -----------------------------------------------------------

function slotRequest(overrides: Partial<SlotRequest> = {}): SlotRequest {
  return {
    variantIds: ["v1", "v2", "v3"],
    accountIds: ["a1"],
    startAt: new Date("2026-08-03T00:00:00Z"),
    endAt: new Date("2026-08-09T23:59:00Z"),
    cadence: "even_spread",
    timeWindows: [9, 18],
    timezoneOffsetMinutes: 0,
    maxPerAccountPerDay: 2,
    ...overrides,
  };
}

describe("buildPlan", () => {
  it("places every variant for every account", () => {
    const result = buildPlan(slotRequest({ accountIds: ["a1", "a2"] }));
    expect(result.posts).toHaveLength(6);
    expect(result.unplaced).toEqual([]);
  });

  it("gives every post a unique idempotency key", () => {
    const result = buildPlan(slotRequest({ variantIds: ["v1", "v2", "v3", "v4"], accountIds: ["a1", "a2", "a3"] }));
    const keys = new Set(result.posts.map((post) => post.idempotencyKey));
    expect(keys.size).toBe(result.posts.length);
  });

  it("respects the per-account daily cap", () => {
    const result = buildPlan(
      slotRequest({
        variantIds: ["v1", "v2", "v3", "v4"],
        maxPerAccountPerDay: 1,
        startAt: new Date("2026-08-03T00:00:00Z"),
        endAt: new Date("2026-08-04T23:59:00Z"),
      }),
    );
    const byDay = new Map<string, number>();
    for (const post of result.posts) {
      const day = post.scheduledFor.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    for (const count of byDay.values()) expect(count).toBeLessThanOrEqual(1);
  });

  it("reports what it could not place, and why", () => {
    // Silently dropping work would make the confirmation preview a lie.
    const result = buildPlan(
      slotRequest({
        variantIds: ["v1", "v2", "v3", "v4", "v5"],
        maxPerAccountPerDay: 1,
        startAt: new Date("2026-08-03T00:00:00Z"),
        endAt: new Date("2026-08-04T23:59:00Z"),
      }),
    );
    expect(result.unplaced.length).toBeGreaterThan(0);
    expect(result.unplaced[0]?.reason).toMatch(/Extend the date range/i);
  });

  it("spreads each account across the window rather than saturating day one", () => {
    // Account-major iteration exists for this: variant-major produces plans where
    // account 1 posts twelve times on day one and account 12 never posts.
    const result = buildPlan(
      slotRequest({ variantIds: ["v1", "v2", "v3", "v4"], accountIds: ["a1", "a2"], maxPerAccountPerDay: 1 }),
    );
    const forA1 = result.posts.filter((post) => post.accountId === "a1");
    const days = new Set(forA1.map((post) => post.scheduledFor.toISOString().slice(0, 10)));
    expect(days.size).toBe(forA1.length);
  });

  it("skips weekends for the weekdays cadence", () => {
    const result = buildPlan(
      slotRequest({
        cadence: "weekdays",
        variantIds: ["v1", "v2", "v3", "v4", "v5", "v6", "v7"],
        maxPerAccountPerDay: 1,
        // 2026-08-03 is a Monday; the range covers a full week.
        startAt: new Date("2026-08-03T00:00:00Z"),
        endAt: new Date("2026-08-09T23:59:00Z"),
      }),
    );
    for (const post of result.posts) {
      const day = post.scheduledFor.getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("schedules inside the requested local hours", () => {
    const result = buildPlan(slotRequest({ timeWindows: [14] }));
    for (const post of result.posts) {
      expect(post.scheduledFor.getUTCHours()).toBe(14);
    }
  });

  it("honours a timezone offset", () => {
    // 09:00 local at UTC+120 is 07:00 UTC.
    const result = buildPlan(
      slotRequest({ timeWindows: [9], timezoneOffsetMinutes: 120, variantIds: ["v1"] }),
    );
    expect(result.posts[0]?.scheduledFor.getUTCHours()).toBe(7);
  });

  it("places nothing when no hour is selected, and says so", () => {
    const result = buildPlan(slotRequest({ timeWindows: [] }));
    expect(result.posts).toEqual([]);
    expect(result.unplaced).toHaveLength(3);
    expect(result.unplaced[0]?.reason).toMatch(/no valid publishing hour/i);
  });

  it("rejects an inverted date range rather than producing nonsense", () => {
    const result = buildPlan(
      slotRequest({ startAt: new Date("2026-08-10T00:00:00Z"), endAt: new Date("2026-08-01T00:00:00Z") }),
    );
    expect(result.posts).toEqual([]);
    expect(result.unplaced[0]?.reason).toMatch(/end date is before the start date/i);
  });

  it("filters invalid hours out of the window list", () => {
    const result = buildPlan(slotRequest({ timeWindows: [9, 25, -3, 9] }));
    for (const post of result.posts) expect(post.scheduledFor.getUTCHours()).toBe(9);
  });

  it("scales to a hundred variants across twelve accounts", () => {
    const result = buildPlan(
      slotRequest({
        variantIds: Array.from({ length: 100 }, (_, i) => `v${i}`),
        accountIds: Array.from({ length: 12 }, (_, i) => `a${i}`),
        startAt: new Date("2026-08-01T00:00:00Z"),
        endAt: new Date("2026-10-31T23:59:00Z"),
        timeWindows: [9, 13, 18],
        maxPerAccountPerDay: 3,
      }),
    );
    expect(result.posts).toHaveLength(1200);
    expect(result.unplaced).toEqual([]);
    expect(new Set(result.posts.map((p) => p.idempotencyKey)).size).toBe(1200);
  });
});

describe("planConcurrency", () => {
  it("caps per platform and reports the wave count", () => {
    const posts = [
      ...Array.from({ length: 10 }, () => ({ platform: "instagram" as const })),
      ...Array.from({ length: 3 }, () => ({ platform: "youtube" as const })),
    ];
    const plan = planConcurrency(posts);
    const instagram = plan.find((row) => row.platform === "instagram");
    const youtube = plan.find((row) => row.platform === "youtube");

    expect(instagram?.concurrency).toBe(2);
    expect(instagram?.waves).toBe(5);
    // YouTube uploads consume heavy quota, so they run one at a time.
    expect(youtube?.concurrency).toBe(1);
    expect(youtube?.waves).toBe(3);
  });

  it("never reports unlimited concurrency", () => {
    // The brief forbids 100 simultaneous uncontrolled requests.
    const plan = planConcurrency(Array.from({ length: 100 }, () => ({ platform: "tiktok" as const })));
    expect(plan[0]?.concurrency).toBeLessThanOrEqual(4);
    expect(plan[0]?.waves).toBeGreaterThan(1);
  });
});

describe("isRetrySafe", () => {
  it("allows retry when the upload never started", () => {
    expect(isRetrySafe({ code: "network_error", httpStatus: null, uploadStarted: false })).toBe(true);
  });

  it("allows retry for explicit platform rejections", () => {
    expect(isRetrySafe({ code: "invalid_caption", httpStatus: 400, uploadStarted: true })).toBe(true);
    expect(isRetrySafe({ code: "token_expired", httpStatus: 401, uploadStarted: true })).toBe(true);
  });

  it("allows retry when rate limited", () => {
    expect(isRetrySafe({ code: "rate_limited", httpStatus: 429, uploadStarted: true })).toBe(true);
  });

  it("refuses retry after an ambiguous failure mid-upload", () => {
    // The post may already exist. Retrying could double-post, so the UI must ask the
    // user to check the account instead of offering a retry button.
    expect(isRetrySafe({ code: "timeout", httpStatus: null, uploadStarted: true })).toBe(false);
    expect(isRetrySafe({ code: "server_error", httpStatus: 502, uploadStarted: true })).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially", () => {
    expect(retryDelayMs(1)).toBe(15_000);
    expect(retryDelayMs(2)).toBe(30_000);
    expect(retryDelayMs(3)).toBe(60_000);
  });

  it("caps so a scheduled post is not pushed hours late", () => {
    expect(retryDelayMs(20)).toBe(300_000);
  });
});
