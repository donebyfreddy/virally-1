import type {
  AudioGenerationInput,
  CostEstimate,
  CreativeGenerationProvider,
  GenerationKind,
  GenerationTask,
  GenerationTaskStatus,
  ImageGenerationInput,
  ProductionMode,
  SupportDecision,
  SupportsQuery,
  VideoGenerationInput,
} from "./types";

/**
 * Deterministic stand-in for a real generation provider.
 *
 * Its purpose is that the entire product — campaign planning, storyboarding,
 * Remotion composition, review, scheduling — is exercisable and testable with no
 * credentials and no spend.
 *
 * Four properties are non-negotiable and every one of them is a correctness
 * requirement rather than a nicety:
 *
 * 1. Costs are always zero. A mock bills nothing, and writing an invented
 *    provider cost into the usage ledger would corrupt margin reporting with
 *    fiction that is indistinguishable from measurement.
 *
 * 2. Output is labelled. `DEMO_OUTPUT_LABEL` reaches the asset row, and every
 *    surface reads it to decide whether the demo badge is mandatory. Nothing
 *    produced here can be presented as a real generation.
 *
 * 3. It is asynchronous, like the real thing. Returning `completed` immediately
 *    would let the polling, progress and download paths go untested and rot.
 *
 * 4. It is deterministic. The same idempotency key produces the same task id and
 *    the same media, so "regenerate this one shot" is reasonable to test and
 *    snapshot assertions do not flake.
 */

export const DEMO_OUTPUT_LABEL = "Demo output" as const;

export const DEMO_OUTPUT_EXPLANATION =
  "Produced by a deterministic mock because no generation provider is configured. It is not a real generation, it cost nothing, and it does not reflect what a configured provider would produce." as const;

/** How many polls a mock task spends in each pre-terminal state. */
const POLLS_SUBMITTED = 1;
const POLLS_GENERATING = 2;

/**
 * Simulated task, held in memory.
 *
 * Deliberately not persisted. The mock's state is disposable; the durable
 * record of every generation lives in `generation_runs` regardless of which
 * provider ran it, so persisting here would duplicate that with a second source
 * of truth.
 */
type MockTask = {
  kind: GenerationKind;
  polls: number;
  ratio: string;
  durationMs: number | null;
};

export class MockCreativeProvider implements CreativeGenerationProvider {
  readonly id = "mock";
  readonly label = "Deterministic mock";
  /** Configured by definition — the mock needs no credential and never fails over. */
  readonly credentialEnvVar = "";

  private readonly tasks = new Map<string, MockTask>();

  /** Always true: the mock is the fallback that must never itself be unavailable. */
  isConfigured(): boolean {
    return true;
  }

  /**
   * Accepts everything.
   *
   * The mock intentionally does NOT reproduce Magnific's ratio and duration
   * limits. Its job is to keep the product testable, and a mock that refuses
   * 4:3 video would make the editor's format-adaptation path unreachable without
   * credentials — which is the exact path most in need of testing.
   */
  supports(_query: SupportsQuery): SupportDecision {
    return { supported: true };
  }

  // Parameters are named-but-unused rather than omitted: omitting them narrows
  // the concrete class's signature below the interface, which type-checks for
  // assignability but breaks every direct call on `MockCreativeProvider`.
  async estimateImage(_input: ImageGenerationInput): Promise<CostEstimate> {
    return FREE;
  }
  async estimateVideo(_input: VideoGenerationInput): Promise<CostEstimate> {
    return FREE;
  }
  async estimateAudio(_input: AudioGenerationInput): Promise<CostEstimate> {
    return FREE;
  }

  async generateImage(input: ImageGenerationInput): Promise<GenerationTask> {
    return this.start("image", input.idempotencyKey, input.mode, input.ratio, null);
  }

  async generateVideo(input: VideoGenerationInput): Promise<GenerationTask> {
    return this.start(
      "video",
      input.idempotencyKey,
      input.mode,
      input.ratio,
      Math.round(input.durationSeconds * 1000),
    );
  }

  async generateAudio(input: AudioGenerationInput): Promise<GenerationTask> {
    return this.start(
      "audio",
      input.idempotencyKey,
      input.mode,
      "n/a",
      Math.round(input.durationSeconds * 1000),
    );
  }

  async getTaskStatus(taskId: string, kind: GenerationKind): Promise<GenerationTaskStatus> {
    const task = this.tasks.get(taskId);
    if (!task) {
      // An unknown id is a real failure, not an empty result. Reporting
      // "pending" forever would hang a worker on a task that will never exist.
      return {
        externalTaskId: taskId,
        state: "failed",
        progress: null,
        media: [],
        failure: {
          code: "unknown_task",
          message: "No mock task with that id. It may have been created before a restart.",
          retryable: false,
          costIncurred: false,
        },
        providerCredits: 0,
      };
    }

    task.polls += 1;

    if (task.polls <= POLLS_SUBMITTED) {
      return progressing(taskId, "submitted", 0);
    }
    if (task.polls <= POLLS_SUBMITTED + POLLS_GENERATING) {
      const done = task.polls - POLLS_SUBMITTED;
      return progressing(taskId, "generating", Math.round((done / (POLLS_GENERATING + 1)) * 100));
    }

    // `downloading`, not `completed` — the same rule the real adapter follows.
    // Only the ingestion step may declare a generation complete, and the mock
    // must exercise that transition rather than skipping it.
    return {
      externalTaskId: taskId,
      state: "downloading",
      progress: 100,
      media: [
        {
          url: placeholderUrl(taskId, kind, task.ratio),
          mimeType: mimeFor(kind),
          widthPx: null,
          heightPx: null,
          durationMs: task.durationMs,
        },
      ],
      failure: null,
      providerCredits: 0,
    };
  }

  async cancelTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
  }

  private start(
    kind: GenerationKind,
    idempotencyKey: string,
    mode: ProductionMode,
    ratio: string,
    durationMs: number | null,
  ): GenerationTask {
    // Derived from the idempotency key, so submitting the same request twice
    // yields one task — the same guarantee the real provider gives via its own
    // task id, exercised by the same tests.
    const taskId = `mock-${kind}-${hash(idempotencyKey)}`;
    if (!this.tasks.has(taskId)) {
      this.tasks.set(taskId, { kind, polls: 0, ratio, durationMs });
    }
    return {
      externalTaskId: taskId,
      providerId: this.id,
      model: `mock-${kind}-${mode}`,
      state: "submitted",
      suggestedPollMs: 50,
    };
  }
}

const FREE: CostEstimate = {
  providerCredits: 0,
  internalCents: 0,
  internalCredits: 0,
  basis: "configured_table",
};

function progressing(
  taskId: string,
  state: "submitted" | "generating",
  progress: number,
): GenerationTaskStatus {
  return {
    externalTaskId: taskId,
    state,
    progress,
    media: [],
    failure: null,
    providerCredits: 0,
  };
}

function mimeFor(kind: GenerationKind): string {
  if (kind === "image") return "image/png";
  if (kind === "video") return "video/mp4";
  return "audio/mpeg";
}

/**
 * A URL that is obviously a placeholder.
 *
 * Points at Virally's own dev route rather than a real CDN so a demo asset can
 * never be mistaken for provider output by anything reading the URL, and so no
 * external request leaves the machine during a test run.
 */
function placeholderUrl(taskId: string, kind: GenerationKind, ratio: string): string {
  const params = new URLSearchParams({ task: taskId, kind, ratio, demo: "1" });
  return `/api/dev/placeholder?${params.toString()}`;
}

/**
 * FNV-1a, 32-bit.
 *
 * Chosen because it is short, dependency-free and stable across processes.
 * Not a security primitive and nothing here treats it as one — it only needs
 * to map a key to a repeatable id.
 */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    // Iterated by UTF-16 code unit deliberately: this only has to be stable and
    // repeatable, and a code-point walk would change every existing task id for
    // no benefit.
    h ^= value.codePointAt(i) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
