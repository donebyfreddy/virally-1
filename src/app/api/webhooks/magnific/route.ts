import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { providerRuns } from "@/lib/db/schema";
import { isMagnificWebhookConfigured } from "@/lib/creative/env";
import { parseEnvelope } from "@/lib/creative/magnific/client";
import { toStatus } from "@/lib/creative/magnific/provider";
import { readWebhookHeaders, verifyMagnificWebhook } from "@/lib/creative/magnific/webhook";
import { pollRun } from "@/lib/creative/pipeline";
import { tenantScope } from "@/lib/creative/scope";

/**
 * Magnific completion webhook.
 *
 * This endpoint is unauthenticated by nature — Magnific has no Virally session —
 * so the HMAC signature is the ONLY thing separating a real completion from an
 * attacker marking arbitrary runs complete with media URLs they control.
 * Everything below follows from that.
 *
 * The raw body is read with `request.text()` and verified BEFORE parsing.
 * Re-serialising parsed JSON changes key order and whitespace, which changes
 * the HMAC — verifying after a parse would reject every genuine webhook and
 * tempt someone into "fixing" it by not verifying at all.
 *
 * The task id is resolved to a run through the database, and the run's own
 * organisation and workspace become the scope. Nothing about tenancy is taken
 * from the request body: a webhook that could name its own workspace would let
 * one customer's completion attach media to another's content.
 *
 * Failures return a bare status with no explanation. Telling a caller WHY their
 * signature failed turns this into an oracle for constructing a valid one.
 */

export const dynamic = "force-dynamic";
// Node runtime: signature verification uses node:crypto's timingSafeEqual.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  // An unverifiable webhook is refused rather than trusted. Generation still
  // completes — the poller is the fallback and does not depend on this.
  if (!isMagnificWebhookConfigured()) {
    return NextResponse.json(
      { error: "Provider configuration required." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const verification = verifyMagnificWebhook(readWebhookHeaders(request.headers), rawBody);

  if (!verification.ok) {
    // Logged server-side with the reason; the response carries none of it.
    console.warn(`[magnific-webhook] rejected: ${verification.reason}`);
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let envelope: ReturnType<typeof parseEnvelope>;
  try {
    envelope = parseEnvelope(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const status = toStatus(envelope);

  // Tenancy comes from the run we already own, never from the payload.
  const rows = await db
    .select({
      id: providerRuns.id,
      organizationId: providerRuns.organizationId,
      workspaceId: providerRuns.workspaceId,
      state: providerRuns.state,
    })
    .from(providerRuns)
    .where(
      and(
        eq(providerRuns.providerId, "magnific"),
        eq(providerRuns.externalTaskId, status.externalTaskId),
      ),
    )
    .limit(1);

  const run = rows[0];
  if (!run) {
    // 200, not 404. A task we do not recognise is not Magnific's problem to
    // retry, and a 404 tells an attacker which task ids exist.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Already finished. A late or duplicate webhook must not reopen it.
  if (run.state === "completed" || run.state === "failed" || run.state === "cancelled") {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const scope = tenantScope(run.organizationId, run.workspaceId);

  try {
    // Delegates to the same path the poller uses, rather than duplicating the
    // ingest-then-complete sequence. Two implementations of that sequence would
    // eventually disagree about when a run is complete.
    await pollRun(scope, run.id);
  } catch (error) {
    // 500 so Magnific retries. The run stays in a non-terminal state and the
    // poller will pick it up regardless.
    console.error(
      `[magnific-webhook] failed to advance run ${run.id}:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Could not process." }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

/** Rejects every other method explicitly, rather than falling through to 405 HTML. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
