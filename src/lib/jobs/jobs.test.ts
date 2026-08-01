// @vitest-environment node
//
// Node, not the suite's default jsdom. `src/lib/jobs/auth.ts` throws on import
// in any context where `window` exists, which is the guard that keeps a
// server-only secret from being reachable from a client component. Running
// these under jsdom would trip that guard on every call — so the file declares
// the environment its subject actually runs in, rather than the guard being
// weakened to accommodate a test.
import { afterEach, describe, expect, it } from "vitest";
import {
  LEASE_MS,
  MAX_JOB_AGE_MS,
  isExhausted,
  pollDelayMs,
  retryDelayMs,
} from "./backoff";
import { CRON_SECRET_ENV, isCronConfigured, isCronRequestAuthorised } from "./auth";

/**
 * Policy tests for the durable queue.
 *
 * Scope is the pure decision-making: backoff curves, exhaustion, and the cron
 * endpoint's authorisation. The SQL-bearing parts of the queue — claiming with
 * `SKIP LOCKED`, lease reclamation, the transition/event pair — are covered by
 * the integration suite, because their whole point is behaviour under
 * concurrency that a mocked database cannot exhibit and would only pretend to.
 */

describe("retryDelayMs", () => {
  it("grows exponentially from the first attempt", () => {
    expect(retryDelayMs(1)).toBe(10_000);
    expect(retryDelayMs(2)).toBe(20_000);
    expect(retryDelayMs(3)).toBe(40_000);
  });

  it("caps at five minutes so an outage cannot push a retry hours out", () => {
    expect(retryDelayMs(10)).toBe(300_000);
    expect(retryDelayMs(100)).toBe(300_000);
  });

  it("treats attempt zero as the first attempt rather than returning zero", () => {
    // A zero delay would busy-loop the runner against a failing dependency.
    expect(retryDelayMs(0)).toBe(10_000);
    expect(retryDelayMs(-5)).toBe(10_000);
  });

  it("never decreases", () => {
    for (let attempt = 1; attempt < 20; attempt += 1) {
      expect(retryDelayMs(attempt + 1)).toBeGreaterThanOrEqual(retryDelayMs(attempt));
    }
  });
});

describe("pollDelayMs", () => {
  it("honours the provider's suggestion on the first poll", () => {
    expect(pollDelayMs(0, 5_000)).toBe(5_000);
  });

  it("falls back to the floor when the provider suggests nothing", () => {
    // MuAPI gives no hint at all, so this is its every-generation path.
    expect(pollDelayMs(0)).toBe(2_000);
    expect(pollDelayMs(0, null)).toBe(2_000);
    expect(pollDelayMs(0, 0)).toBe(2_000);
  });

  it("ignores a negative suggestion rather than scheduling a poll in the past", () => {
    expect(pollDelayMs(0, -1_000)).toBe(2_000);
  });

  it("eases upward so a long video generation does not cost hundreds of polls", () => {
    expect(pollDelayMs(1)).toBeGreaterThan(pollDelayMs(0));
    expect(pollDelayMs(5)).toBeGreaterThan(pollDelayMs(1));
  });

  it("caps at thirty seconds so a finished task is not missed for minutes", () => {
    expect(pollDelayMs(50)).toBe(30_000);
    expect(pollDelayMs(50, 20_000)).toBe(30_000);
  });

  it("stays within its bounds for every plausible poll count", () => {
    for (let count = 0; count < 100; count += 1) {
      const delay = pollDelayMs(count);
      expect(delay).toBeGreaterThanOrEqual(2_000);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
  });

  it("reaches the ceiling more slowly than the retry curve", () => {
    // The two curves answer different questions. If polling grew as fast as
    // retrying, a healthy 10s image generation would be noticed up to 30s late.
    expect(pollDelayMs(2)).toBeLessThan(retryDelayMs(2));
  });
});

describe("isExhausted", () => {
  it("is false while attempts remain", () => {
    expect(isExhausted(1, 3)).toBe(false);
    expect(isExhausted(2, 3)).toBe(false);
  });

  it("is true at the limit, not one past it", () => {
    // Attempts are incremented at claim, so a job on its third attempt of three
    // has no fourth. Testing `>` here would grant a silent extra attempt.
    expect(isExhausted(3, 3)).toBe(true);
    expect(isExhausted(4, 3)).toBe(true);
  });
});

describe("queue timing constants", () => {
  it("leases for longer than the poll ceiling so a lease cannot lapse mid-poll", () => {
    expect(LEASE_MS).toBeGreaterThan(pollDelayMs(100));
  });

  it("abandons a job well after the longest retry chain, not before", () => {
    // If a job could exceed its maximum age before exhausting its retries, the
    // retry policy would be unreachable and every transient failure would
    // dead-letter on age instead.
    const longestChain = [1, 2, 3].reduce((total, a) => total + retryDelayMs(a), 0);
    expect(MAX_JOB_AGE_MS).toBeGreaterThan(longestChain);
  });
});

describe("cron authorisation", () => {
  const original = process.env[CRON_SECRET_ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[CRON_SECRET_ENV];
    else process.env[CRON_SECRET_ENV] = original;
  });

  function requestWith(header: string | null): Request {
    return new Request("https://virally.test/api/cron/generation", {
      method: "POST",
      headers: header === null ? {} : { authorization: header },
    });
  }

  it("refuses everything when the secret is unset", () => {
    delete process.env[CRON_SECRET_ENV];
    expect(isCronConfigured()).toBe(false);
    // The load-bearing assertion of this file. An unset secret must fail
    // CLOSED — an open drain endpoint is a free way to burn provider spend.
    expect(isCronRequestAuthorised(requestWith("Bearer anything"))).toBe(false);
    expect(isCronRequestAuthorised(requestWith(null))).toBe(false);
  });

  it("treats a blank secret as unset rather than as an empty valid token", () => {
    process.env[CRON_SECRET_ENV] = "   ";
    expect(isCronConfigured()).toBe(false);
    expect(isCronRequestAuthorised(requestWith("Bearer "))).toBe(false);
    expect(isCronRequestAuthorised(requestWith("Bearer    "))).toBe(false);
  });

  it("accepts the matching bearer token", () => {
    process.env[CRON_SECRET_ENV] = "s3cret-value";
    expect(isCronConfigured()).toBe(true);
    expect(isCronRequestAuthorised(requestWith("Bearer s3cret-value"))).toBe(true);
  });

  it("rejects a near miss, including a correct prefix", () => {
    process.env[CRON_SECRET_ENV] = "s3cret-value";
    expect(isCronRequestAuthorised(requestWith("Bearer s3cret-valu"))).toBe(false);
    expect(isCronRequestAuthorised(requestWith("Bearer s3cret-value-extra"))).toBe(false);
    expect(isCronRequestAuthorised(requestWith("Bearer S3CRET-VALUE"))).toBe(false);
  });

  it("requires the Bearer scheme and is case-sensitive about it", () => {
    process.env[CRON_SECRET_ENV] = "s3cret-value";
    expect(isCronRequestAuthorised(requestWith("s3cret-value"))).toBe(false);
    expect(isCronRequestAuthorised(requestWith("Basic s3cret-value"))).toBe(false);
    expect(isCronRequestAuthorised(requestWith("bearer s3cret-value"))).toBe(false);
  });

  it("tolerates a secret configured with surrounding whitespace", () => {
    // A trailing newline is what a shell heredoc or a copy-paste leaves behind,
    // and it must not silently break every scheduled run.
    process.env[CRON_SECRET_ENV] = "  s3cret-value\n";
    expect(isCronRequestAuthorised(requestWith("Bearer s3cret-value"))).toBe(true);
  });
});
