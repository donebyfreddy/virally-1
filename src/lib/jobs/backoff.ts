/**
 * Timing policy for the durable queue.
 *
 * Kept in its own module with no imports because these are the numbers most
 * likely to be tuned under pressure, and because every one of them is testable
 * as pure arithmetic — a backoff curve that has to be observed through a
 * database to be checked is a backoff curve nobody checks.
 *
 * Two curves, not one. They answer different questions and conflating them is
 * the classic queue bug: retry backoff asks "how long before we try again after
 * something went wrong", and grows aggressively because a failing dependency
 * needs room to recover. Poll interval asks "how long before we check on
 * something that is working normally", and must stay tight or every generation
 * gains minutes of latency it did not need. A single curve is either too slow
 * for the healthy case or too fast for the broken one.
 */

/** Lease held on a claimed job. Longer than any single handler should take. */
export const LEASE_MS = 120_000;

/**
 * How long a job may stay in flight before the runner gives up on it.
 *
 * Not the same as the lease: a lease expiring means a worker died and the job
 * should be retried, while this deadline means the provider has had long enough
 * and the run is dead-lettered. Video generation is genuinely slow, so this is
 * generous — but it is finite, because a task the provider silently dropped
 * would otherwise be polled forever.
 */
export const MAX_JOB_AGE_MS = 60 * 60 * 1000;

/**
 * How long a job may sit unclaimed before the watchdog gives up on a worker
 * ever showing up.
 *
 * Distinct from `MAX_JOB_AGE_MS`: that one bounds a job already being worked
 * (submitted to a provider, polling), this one bounds a job nobody has even
 * looked at yet. Generous enough to absorb a cold serverless start and the
 * self-trigger's own network round trip, short enough that a genuinely
 * unconsumed queue — no local worker running, no cron configured — surfaces
 * as a failed job in minutes rather than leaving a user staring at "Queued"
 * with no explanation.
 */
export const QUEUE_CLAIM_TIMEOUT_MS = 3 * 60 * 1000;

const RETRY_BASE_MS = 10_000;
const RETRY_CEILING_MS = 300_000;

/**
 * Delay before retrying a failed attempt.
 *
 * Exponential, capped at five minutes. The cap matters more than the growth
 * rate: without it the fourth or fifth retry of a long-lived outage lands hours
 * later, by which time the user has given up and resubmitted — turning one
 * stuck job into two.
 *
 * Deterministic rather than jittered. Jitter is the right call for a fleet of
 * workers all retrying the same downstream at once; this queue claims with
 * `FOR UPDATE SKIP LOCKED`, so two workers never hold the same job and the
 * thundering herd it would protect against cannot form.
 */
export function retryDelayMs(attempt: number): number {
  const delay = RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, RETRY_CEILING_MS);
}

const POLL_FLOOR_MS = 2_000;
const POLL_CEILING_MS = 30_000;

/**
 * Delay before the next poll of a task the provider is still working on.
 *
 * Starts at the provider's own suggestion when it gives one, then eases upward
 * so a slow video generation does not cost hundreds of polls. Bounded at both
 * ends: the floor keeps a fast image generation from feeling laggy, and the
 * ceiling keeps a finished task from sitting unnoticed for minutes.
 *
 * @param pollCount how many times this task has already been polled
 * @param suggestedMs the provider's hint, when it gives one
 */
export function pollDelayMs(pollCount: number, suggestedMs?: number | null): number {
  const base = suggestedMs && suggestedMs > 0 ? suggestedMs : POLL_FLOOR_MS;
  // Grows by half again each poll rather than doubling. Doubling reaches the
  // ceiling in four polls, which for a 10-second image generation means the
  // result is found up to 30 seconds late.
  const eased = base * 1.5 ** Math.max(0, pollCount);
  return Math.min(Math.max(eased, POLL_FLOOR_MS), POLL_CEILING_MS);
}

/**
 * Whether a job has exhausted its attempts.
 *
 * A job at its limit is dead-lettered rather than failed. The distinction is
 * operational: a failed job is one a user can look at and retry, whereas a
 * dead-lettered one has already been retried as often as policy allows and
 * needs someone to ask why. Collapsing them hides a systemic fault behind a
 * pile of individually plausible failures.
 */
export function isExhausted(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}
