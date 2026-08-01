/**
 * @vitest-environment node
 *
 * Integration tests for generation admission control, against a REAL Postgres.
 *
 * Concurrency and rate limiting are counted from rows that actually exist,
 * deliberately rather than from an in-memory token bucket: a bucket in a
 * serverless process is per-instance and therefore fiction. That decision is
 * what makes these tests necessary — the counting IS the mechanism, and it can
 * only be exercised against a database.
 *
 * The property that matters most is tenant fairness. Every workspace shares one
 * vendor API key, so one tenant submitting forty video jobs would rate-limit
 * every other tenant on the platform. The per-workspace ceiling is what stops
 * that, and the test below is the only thing that proves it counts the right
 * workspace's rows.
 *
 * Skipped automatically when DATABASE_URL is absent.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { config } from "dotenv";

config({ path: ".env.local" });

const HAS_DATABASE = Boolean(process.env.DATABASE_URL?.trim());

type Deps = {
  db: typeof import("@/lib/db").db;
  pool: typeof import("@/lib/db").pool;
  schema: typeof import("@/lib/db/schema");
  limits: typeof import("./limits");
  scope: typeof import("@/lib/creative/scope");
};

let deps: Deps;
const created: { organizationId: string; workspaceId: string }[] = [];
const createdUsers: string[] = [];
let fixtureCounter = 0;
let runCounter = 0;

beforeAll(async () => {
  if (!HAS_DATABASE) return;
  deps = {
    db: (await import("@/lib/db")).db,
    pool: (await import("@/lib/db")).pool,
    schema: await import("@/lib/db/schema"),
    limits: await import("./limits"),
    scope: await import("@/lib/creative/scope"),
  };
});

afterEach(async () => {
  if (!HAS_DATABASE) return;
  for (const entry of created.splice(0)) {
    await deps.db
      .delete(deps.schema.organizations)
      .where(eq(deps.schema.organizations.id, entry.organizationId));
  }
  for (const userId of createdUsers.splice(0)) {
    await deps.db.delete(deps.schema.user).where(eq(deps.schema.user.id, userId));
  }
});

afterAll(async () => {
  if (!HAS_DATABASE) return;
  await deps.pool.end();
});

async function freshScope() {
  fixtureCounter += 1;
  const suffix = `${fixtureCounter}${Date.now().toString(36)}`.toLowerCase();

  const [account] = await deps.db
    .insert(deps.schema.user)
    .values({ name: `Test ${suffix}`, email: `limits-${suffix}@example.invalid` })
    .returning({ id: deps.schema.user.id });
  createdUsers.push(account!.id);

  const [organization] = await deps.db
    .insert(deps.schema.organizations)
    .values({ name: `limits-org-${suffix}`, slug: `limits-org-${suffix}`, createdBy: account!.id })
    .returning({ id: deps.schema.organizations.id });

  const [workspace] = await deps.db
    .insert(deps.schema.workspaces)
    .values({
      organizationId: organization!.id,
      name: `limits-ws-${suffix}`,
      slug: `limits-ws-${suffix}`,
      createdBy: account!.id,
    })
    .returning({ id: deps.schema.workspaces.id });

  const entry = { organizationId: organization!.id, workspaceId: workspace!.id };
  created.push(entry);
  return deps.scope.tenantScope(entry.organizationId, entry.workspaceId);
}

/** Creates an in-flight run, which is what occupies a concurrency slot. */
async function inFlightRun(
  scope: { organizationId: string; workspaceId: string },
  providerId: string,
  state: "generating" | "completed" = "generating",
) {
  runCounter += 1;
  await deps.db.insert(deps.schema.providerRuns).values({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    providerId,
    model: "test-model",
    generationType: "video",
    inputPrompt: "test",
    state,
    estimatedInternalCents: 100,
    actualInternalCents: state === "completed" ? 100 : null,
    completedAt: state === "completed" ? new Date() : null,
    idempotencyKey: `limits-${Date.now().toString(36)}-${runCounter}`,
  });
}

describe.skipIf(!HAS_DATABASE)("generation limits (integration)", () => {
  it("reads the capability-specific limit in preference to the provider-wide one", async () => {
    const specific = await deps.limits.readLimits("muapi", "text-to-video");
    const wide = await deps.limits.readLimits("muapi", "text-to-image");

    // Video is metered far more tightly than images. A single per-provider
    // figure is either too low for images or too high for video.
    expect(specific.requestsPerMinute).toBeLessThan(wide.requestsPerMinute);
    expect(specific.maxConcurrent).toBeLessThan(wide.maxConcurrent);
  });

  it("falls back to a conservative default for an uncatalogued provider", async () => {
    const limits = await deps.limits.readLimits("not-a-provider", "text-to-image");
    // An absent limit must never be the most permissive state.
    expect(limits.maxConcurrent).toBeLessThanOrEqual(2);
    expect(limits.maxConcurrentPerWorkspace).toBeLessThanOrEqual(1);
  });

  it("exempts the mock, which makes no external call", async () => {
    const scope = await freshScope();
    for (let i = 0; i < 20; i += 1) await inFlightRun(scope, "mock");

    // Throttling the mock would slow the credential-free development path for
    // no protective benefit — there is no vendor account to protect.
    expect((await deps.limits.checkConcurrency(scope, "mock", "text-to-video")).allowed).toBe(true);
    expect(
      (await deps.limits.checkSubmissionRate(scope, "mock", "text-to-video")).allowed,
    ).toBe(true);
  });

  it("allows a workspace with nothing in flight", async () => {
    const scope = await freshScope();
    expect((await deps.limits.checkConcurrency(scope, "muapi", "text-to-video")).allowed).toBe(
      true,
    );
  });

  it("refuses once the workspace reaches its own concurrency ceiling", async () => {
    const scope = await freshScope();
    const limits = await deps.limits.readLimits("muapi", "text-to-video");
    for (let i = 0; i < limits.maxConcurrentPerWorkspace; i += 1) {
      await inFlightRun(scope, "muapi");
    }

    const decision = await deps.limits.checkConcurrency(scope, "muapi", "text-to-video");
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    // Tells the user it is THEIR generations occupying the slots, not that the
    // platform is busy — the latter is less actionable and, from their side,
    // untrue.
    expect(decision.reason).toContain("workspace");
  });

  it("counts only this workspace's runs, not another tenant's", async () => {
    const [mine, theirs] = await Promise.all([freshScope(), freshScope()]);
    const limits = await deps.limits.readLimits("muapi", "text-to-video");

    // The other tenant saturates their own share.
    for (let i = 0; i < limits.maxConcurrentPerWorkspace; i += 1) {
      await inFlightRun(theirs, "muapi");
    }

    // The load-bearing fairness assertion. If the per-workspace count leaked
    // across tenants, one busy workspace would lock out every other one.
    expect((await deps.limits.checkConcurrency(mine, "muapi", "text-to-video")).allowed).toBe(
      true,
    );
  });

  it("does not count completed runs against the ceiling", async () => {
    const scope = await freshScope();
    for (let i = 0; i < 10; i += 1) await inFlightRun(scope, "muapi", "completed");

    // A terminal run occupies nothing. Counting it would permanently throttle
    // any workspace that had ever generated.
    expect((await deps.limits.checkConcurrency(scope, "muapi", "text-to-video")).allowed).toBe(
      true,
    );
  });

  it("counts a run in every non-terminal state, not just `generating`", async () => {
    const scope = await freshScope();
    const limits = await deps.limits.readLimits("muapi", "lip-sync");

    // `waiting_external` is the state a submitted job spends most of its life
    // in. Omitting it from the in-flight set would make the ceiling almost
    // never bind, which is the same as not having one.
    runCounter += 1;
    await deps.db.insert(deps.schema.providerRuns).values({
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      providerId: "muapi",
      model: "test-model",
      generationType: "video",
      inputPrompt: "test",
      state: "waiting_external",
      estimatedInternalCents: 100,
      idempotencyKey: `limits-wx-${Date.now().toString(36)}-${runCounter}`,
    });

    const decision = await deps.limits.checkConcurrency(scope, "muapi", "lip-sync");
    expect(limits.maxConcurrentPerWorkspace).toBe(1);
    expect(decision.allowed).toBe(false);
  });

  it("refuses once the submission rate is exceeded, and says when to retry", async () => {
    const scope = await freshScope();
    const limits = await deps.limits.readLimits("muapi", "text-to-video");
    // Completed, so this exercises the RATE window rather than concurrency —
    // the two are separate protections and must be separately assertable.
    for (let i = 0; i < limits.requestsPerMinute; i += 1) {
      await inFlightRun(scope, "muapi", "completed");
    }

    const decision = await deps.limits.checkSubmissionRate(scope, "muapi", "text-to-video");
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.retryAfterMs).toBe(60_000);
  });

  it("reports the rate problem before the concurrency one", async () => {
    const scope = await freshScope();
    const limits = await deps.limits.readLimits("muapi", "text-to-video");
    for (let i = 0; i < limits.requestsPerMinute; i += 1) await inFlightRun(scope, "muapi");

    const decision = await deps.limits.checkGenerationLimits(scope, "muapi", "text-to-video");
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    // Both ceilings are breached. Going too fast is the cause; too many running
    // is the symptom, and reporting the symptom sends the user to fix the wrong
    // thing.
    expect(decision.retryAfterMs).toBe(60_000);
  });
});
