import { NextResponse } from "next/server";
import { runQueueOnce } from "@/lib/jobs/runner";
import { isCronRequestAuthorised } from "@/lib/jobs/auth";

/**
 * Drains the generation queue.
 *
 * Invoked on a schedule. Every generation runs here rather than inside a
 * request: a video model takes minutes, which no request handler can wait for,
 * and a user closing the tab must not abandon work they have been charged for.
 *
 * Not a daemon. The loop is bounded by wall clock so it exits cleanly before
 * the platform's execution ceiling, leaving every claimed job either finished
 * or parked with its lease released. The next invocation continues.
 *
 * Overlapping invocations are safe by construction — batches are claimed with
 * `FOR UPDATE SKIP LOCKED` and leases are independent — so a slow run being
 * overtaken by the next tick costs throughput, never correctness. That is why
 * there is no run lock here; adding one would turn a harmless overlap into a
 * single point of failure the moment a worker died holding it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * Slightly under the platform's default ceiling, and the budget below is lower
 * still. Two margins rather than one because being killed mid-job is the
 * failure this whole design exists to avoid.
 */
export const maxDuration = 300;

const BUDGET_MS = 240_000;

export async function POST(request: Request): Promise<Response> {
  if (!isCronRequestAuthorised(request)) {
    // Deliberately identical to the unconfigured response below. A distinct
    // message would tell an unauthenticated caller whether the secret is set,
    // which is the first thing worth knowing before attacking it.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const report = await runQueueOnce({ budgetMs: BUDGET_MS });
    return NextResponse.json({ ok: true, ...report });
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
