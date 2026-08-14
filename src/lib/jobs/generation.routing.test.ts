// @vitest-environment node
//
// Unit test for the one decision that keeps a worker crash from paying fal
// twice: `handleGenerationJob` picks submit vs. poll from the JOB PAYLOAD
// (whether `providerRunId` is already on it), never from job status. Status
// gets rewritten back to `pending` by lease recovery when a worker dies
// mid-job — see queue.ts's `reclaimExpiredLeases` — so a handler keyed on
// status would resubmit a generation that already reached the provider and is
// already billable. This is exactly the "worker crash after fal submission"
// scenario called for in the generation-pipeline fix: replacement worker
// resumes by polling, fal is not called a second time.
//
// Everything except the module under test is mocked: this is a routing
// decision, not a database or provider behaviour, and a real Postgres/fal
// round trip would only obscure which branch actually ran.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));
vi.mock("@/lib/creative/contentRender", () => ({ isContentReadyToRender: vi.fn() }));
vi.mock("@/lib/generation/attach", () => ({ attachAssetToCampaign: vi.fn(), attachAssetToShot: vi.fn() }));
vi.mock("@/lib/generation/service", () => ({ linkRunToReservation: vi.fn() }));

const submitGeneration = vi.fn();
const pollRun = vi.fn();
vi.mock("@/lib/creative/pipeline", () => ({ submitGeneration, pollRun }));

const awaitExternal = vi.fn();
const completeJob = vi.fn();
const enqueueJob = vi.fn();
const failJob = vi.fn();
const reportProgress = vi.fn();
vi.mock("./queue", () => ({ awaitExternal, completeJob, enqueueJob, failJob, reportProgress }));

const { handleGenerationJob } = await import("./generation");
type ClaimedJobLike = Parameters<typeof handleGenerationJob>[0];

function job(payload: Record<string, unknown>): ClaimedJobLike {
  return {
    id: "job-1",
    organizationId: "org-1",
    workspaceId: "ws-1",
    userId: "user-1",
    type: "asset.image.generate",
    status: "running",
    payload,
    attempts: 1,
    maxAttempts: 3,
    createdAt: new Date(),
    startedAt: new Date(),
  } as ClaimedJobLike;
}

const basePayload = {
  kind: "image",
  input: { prompt: "a cat" },
  contentItemId: "content-1",
  reservationId: "reservation-1",
  preferredProviderId: "fal",
  modelId: "fal.flux-dev",
  capability: "text-to-image",
};

beforeEach(() => {
  vi.clearAllMocks();
  awaitExternal.mockResolvedValue(undefined);
  reportProgress.mockResolvedValue(undefined);
  completeJob.mockResolvedValue(undefined);
  failJob.mockResolvedValue("failed");
});

describe("handleGenerationJob submit/poll routing", () => {
  it("submits to the provider when the payload carries no providerRunId yet", async () => {
    submitGeneration.mockResolvedValue({
      status: "submitted",
      runId: "run-1",
      externalTaskId: "fal-ai/flux/dev::req-1",
      providerId: "fal",
      isMock: false,
    });

    const result = await handleGenerationJob(job(basePayload));

    expect(submitGeneration).toHaveBeenCalledTimes(1);
    expect(pollRun).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "submitted", runId: "run-1" });
  });

  it("polls instead of resubmitting once a providerRunId is already on the payload — the crash-resume guarantee", async () => {
    pollRun.mockResolvedValue({ terminal: false, state: "generating", progress: null, failureCode: null, failureMessage: null });

    const result = await handleGenerationJob(job({ ...basePayload, providerRunId: "run-1" }));

    // The load-bearing assertion: a job whose payload already recorded a
    // provider run must never call submitGeneration again, no matter what
    // the job's own status column says — that is what makes a worker crash
    // between "fal accepted the request" and "job parked" safe to resume
    // rather than a duplicate, billable submission.
    expect(submitGeneration).not.toHaveBeenCalled();
    expect(pollRun).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1", workspaceId: "ws-1" }), "run-1");
    expect(result).toEqual({ outcome: "polling", runId: "run-1", state: "generating" });
  });

  it("still resumes by polling even when the job's own status was reset to pending by lease recovery", async () => {
    pollRun.mockResolvedValue({ terminal: false, state: "generating", progress: null, failureCode: null, failureMessage: null });

    const staleJob = job({ ...basePayload, providerRunId: "run-1" });
    const result = await handleGenerationJob({ ...staleJob, status: "pending" });

    expect(submitGeneration).not.toHaveBeenCalled();
    expect(result.outcome).toBe("polling");
  });
});
