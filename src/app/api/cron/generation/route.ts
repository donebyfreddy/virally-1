import { NextResponse } from "next/server";
import { hasClaimableWork } from "@/lib/jobs/queue";
import { runQueueOnce, type RunnerReport } from "@/lib/jobs/runner";
import { isCronRequestAuthorised } from "@/lib/jobs/auth";
import { triggerQueueDrain } from "@/lib/jobs/trigger";

/**
 * Drains the generation queue.
 *
 * Reached three ways, none of which is a plain user request:
 *
 *  1. `vercel.json`'s cron schedule — the correctness guarantee. This fires
 *     on a fixed interval regardless of anything else, so a queued job is
 *     never more than one interval away from being picked up even if every
 *     other trigger below is lost.
 *  2. The self-trigger in `trigger.ts`, fired right after a job is enqueued —
 *     a latency optimisation so generation starts in effectively zero time
 *     instead of waiting for the next cron tick.
 *  3. Itself, chained via `after()` below when this invocation's own time
 *     budget runs out with work still outstanding — so a batch that takes
 *     longer than one invocation's ceiling keeps moving without waiting for
 *     the next cron tick either.
 *
 * Every generation runs here rather than inside a request: a video model
 * takes minutes, which no request handler can wait for, and a user closing
 * the tab must not abandon work they have been charged for.
 *
 * Not a daemon, but not a single batch either. The loop below behaves like
 * the local dev worker (`scripts/worker.ts`) for as long as this invocation's
 * wall-clock budget allows — draining what is due, briefly sleeping when
 * something is merely parked on `run_after`, and stopping only when the
 * queue is genuinely empty or the deadline arrives. That is what makes one
 * kick sufficient for most generations to run start-to-finish without ever
 * needing a second invocation.
 *
 * Overlapping invocations are safe by construction — batches are claimed with
 * `FOR UPDATE SKIP LOCKED` and leases are independent — so a slow run being
 * overtaken by the next tick, or by its own chained continuation, costs
 * throughput, never correctness. That is why there is no run lock here;
 * adding one would turn a harmless overlap into a single point of failure the
 * moment a worker died holding it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * Slightly under the platform's default ceiling, and the deadline below is
 * lower still. Two margins rather than one because being killed mid-job is
 * the failure this whole design exists to avoid.
 */
export const maxDuration = 300;

/** Wall-clock ceiling for this invocation's own loop, below `maxDuration`. */
const ROUTE_DEADLINE_MS = 260_000;
/** Per-call budget handed to `runQueueOnce`, matching its own default reserve. */
const BATCH_BUDGET_MS = 50_000;
/** Sleep between rounds that claimed nothing but the queue is not empty — a job parked on `run_after`. */
const IDLE_POLL_MS = 3_000;
/** Sleep between rounds that did real work, so the next round does not lag visibly behind the provider. */
const ACTIVE_POLL_MS = 500;

export async function POST(request: Request): Promise<Response> {
  if (!isCronRequestAuthorised(request)) {
    // Deliberately identical to the unconfigured response below. A distinct
    // message would tell an unauthenticated caller whether the secret is set,
    // which is the first thing worth knowing before attacking it.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const startedAt = Date.now();
    const aggregate = emptyReport();

    while (Date.now() - startedAt < ROUTE_DEADLINE_MS) {
      const remaining = ROUTE_DEADLINE_MS - (Date.now() - startedAt);
      const report = await runQueueOnce({ budgetMs: Math.min(BATCH_BUDGET_MS, remaining) });
      mergeReport(aggregate, report);

      const madeProgress = report.claimed > 0 || report.reclaimed > 0 || report.timedOut > 0;
      if (!madeProgress) {
        // Nothing claimable this instant. Stop for good if the queue is truly
        // empty; otherwise everything outstanding is parked (a poll, a retry
        // backoff) and a short sleep is cheaper than ending the invocation.
        if (!(await hasClaimableWork())) break;
        await sleep(IDLE_POLL_MS);
      } else {
        await sleep(ACTIVE_POLL_MS);
      }
    }

    aggregate.durationMs = Date.now() - startedAt;

    if (await hasClaimableWork()) {
      // The deadline arrived with work still outstanding. Chain a follow-up
      // invocation rather than waiting for the next cron tick — see point 3
      // in the module doc comment. Best-effort: the cron schedule is the
      // actual correctness guarantee if this is ever lost.
      triggerQueueDrain();
    }

    return NextResponse.json({ ok: true, ...aggregate });
  } catch (error) {
    // The runner already converts per-job failures into recorded job failures,
    // so reaching here means the queue's own bookkeeping failed — an
    // unreachable database, most likely. Logged in full, reported as a bare
    // sentence: the caller is a scheduler, and the detail belongs in the logs.
    console.error("[cron/generation] The queue drain failed.", error);
    return NextResponse.json({ error: "Could not drain the queue." }, { status: 500 });
  }
}

/**
 * Some schedulers issue GET. Accepted with the same authorisation, because a
 * scheduler that cannot reach the endpoint fails silently and the queue simply
 * stops draining — a failure mode with no symptom until a user asks why their
 * generation never finished.
 */
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}

function emptyReport(): RunnerReport {
  return {
    reclaimed: 0,
    timedOut: 0,
    claimed: 0,
    completed: 0,
    polling: 0,
    failed: 0,
    abandoned: 0,
    errored: 0,
    budgetExhausted: false,
    durationMs: 0,
  };
}

function mergeReport(into: RunnerReport, from: RunnerReport): void {
  into.reclaimed += from.reclaimed;
  into.timedOut += from.timedOut;
  into.claimed += from.claimed;
  into.completed += from.completed;
  into.polling += from.polling;
  into.failed += from.failed;
  into.abandoned += from.abandoned;
  into.errored += from.errored;
  into.budgetExhausted = into.budgetExhausted || from.budgetExhausted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
