import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, providerRuns } from "@/lib/db/schema";
import { verifyWebhookToken } from "@/lib/creative/muapi/webhook";
import { isTerminalRunState } from "@/lib/creative/types";

/**
 * Inbound MuAPI completion callback.
 *
 * MuAPI publishes no webhook signature scheme, so this endpoint cannot
 * authenticate the vendor and does not pretend to. A valid hit does exactly one
 * thing: it brings the job's next poll forward. It never reads the request body,
 * never advances a run's state, never touches an asset and never settles a
 * credit reservation — all of which remain the exclusive work of the
 * authenticated outbound poll.
 *
 * That restraint is the security design, not a limitation of it. An unsigned
 * webhook that could mark a run complete would be an unauthenticated write path
 * into billing. Here, the most an attacker holding a valid URL can accomplish is
 * making Virally poll its own provider a few seconds early.
 *
 * The body is deliberately not parsed. Anything MuAPI sends is unverifiable, and
 * code that reads an unverifiable payload eventually trusts it — the safest
 * parser is the one that was never written.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * How far ahead a webhook may pull a poll.
 *
 * Not zero. A stampede of callbacks — retries, duplicates, an attacker with a
 * token — would otherwise pin a job to `run_after = now()` and have the worker
 * poll it on every pass. Two seconds keeps the latency win while bounding the
 * outbound rate to something the provider's own limit tolerates.
 */
const MIN_POLL_DELAY_MS = 2_000;

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  const url = new URL(_request.url);
  const verification = verifyWebhookToken(runId, url.searchParams.get("token"));

  if (!verification.ok) {
    // Logged server-side with the reason; the response says only "Unauthorized".
    // Distinguishing "no such run" from "wrong token" would turn this into a
    // run-enumeration oracle for an unauthenticated caller.
    console.warn(`[webhooks/muapi] Rejected a callback for ${runId}: ${verification.reason}`);
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    // Tenancy is read from the run row, never from the request. There is no
    // session here and nothing the caller sent may select a workspace.
    const [run] = await db
      .select({
        id: providerRuns.id,
        state: providerRuns.state,
        jobId: providerRuns.jobId,
      })
      .from(providerRuns)
      .where(eq(providerRuns.id, runId))
      .limit(1);

    // 200 for an unknown run, and 200 for a finished one. A 404 would tell an
    // unauthenticated caller which run ids exist, and a non-2xx makes MuAPI
    // retry a callback that can never succeed.
    if (!run || isTerminalRunState(run.state) || !run.jobId) {
      return NextResponse.json({ received: true });
    }

    const pollAt = new Date(Date.now() + MIN_POLL_DELAY_MS);

    // Guarded on `run_after > pollAt`, so a callback can only ever bring a poll
    // FORWARD. Without it a late or replayed webhook would push a job that was
    // about to run further out — a callback that delays the thing it announces.
    //
    // `waiting_external` only: a job the worker currently holds must not have
    // its schedule rewritten mid-flight.
    await db
      .update(jobs)
      .set({ runAfter: pollAt, updatedAt: new Date() })
      .where(
        and(
          eq(jobs.id, run.jobId),
          eq(jobs.status, "waiting_external"),
          gt(jobs.runAfter, pollAt),
          sql`${jobs.lockedUntil} is null or ${jobs.lockedUntil} < now()`,
        ),
      );

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`[webhooks/muapi] Could not process a callback for ${runId}.`, error);
    // 500 so MuAPI retries. Safe to retry: the update is idempotent and the
    // guard above makes a repeat a no-op once the poll time is already early.
    return NextResponse.json({ error: "Could not process." }, { status: 500 });
  }
}

/** MuAPI posts. Anything else is a probe. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
