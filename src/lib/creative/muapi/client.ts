import { muapiApiKey } from "../env";
import type { GenerationFailure } from "../types";
import { MUAPI_AUTH_HEADER, MUAPI_BASE_URL } from "./catalog";

/**
 * HTTP transport for the MuAPI API.
 *
 * Structured as a deliberate mirror of `MagnificClient`: same transport seam,
 * same abort budget, same failure mapping, same rule that no credential and no
 * raw provider body ever reaches a log line or an `Error` message. Two adapters
 * that differ only where the vendors differ are far cheaper to reason about
 * than two that each invented their own error handling.
 *
 * Where MuAPI genuinely differs from Magnific, and why it matters here:
 *
 * 1. **No response envelope.** Magnific wraps everything in `{ data: { … } }`.
 *    MuAPI returns bare objects whose shape varies by endpoint — `request_id`
 *    or `id`, `outputs[]` or `url` or `output.url`. So parsing is defensive
 *    normalisation rather than validation against one schema.
 *
 * 2. **No progress.** MuAPI reports a status string and nothing else. Every
 *    status this client produces carries `progress: null` rather than a
 *    synthesised percentage, which is why `GenerationTaskStatus.progress` is
 *    nullable and why the UI renders an indeterminate indicator.
 *
 * 3. **No price, ever.** Nothing in a submit or poll response says what a
 *    generation cost. `providerCredits` is therefore always null and every
 *    MuAPI estimate is `basis: "configured_table"`.
 *
 * 4. **Some endpoints answer inline.** A submit that returns no id has already
 *    finished. That is a real MuAPI behaviour and not an error, so
 *    `parseSubmit` reports it as such rather than throwing.
 */

/** MuAPI's status vocabulary, lowercased. Three spellings mean success. */
const SUCCESS_STATUSES = new Set(["completed", "succeeded", "success"]);
const FAILURE_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);
/**
 * Statuses that mean the provider has accepted the task but not begun.
 *
 * Distinguished from "running" so the poller can back off harder on a queue
 * that has not moved, rather than hammering a task that is only waiting its
 * turn.
 */
const QUEUED_STATUSES = new Set(["queued", "pending", "starting", "created", "in_queue"]);

export type MuApiTransport = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; body: unknown }>;

/**
 * Default transport.
 *
 * Reads the body as text first and parses defensively, for the same reason
 * `MagnificClient` does: an edge 5xx returns HTML, and `response.json()` throws
 * on exactly the responses whose content matters most for diagnosis.
 */
const fetchTransport: MuApiTransport = async (url, init) => {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
  }
  return { status: response.status, body };
};

export class MuApiAuthError extends Error {
  constructor() {
    // Names the variable, never the value, and never echoes the response body —
    // a 401 from MuAPI can contain a prefix of the key that was sent.
    super(
      "MuAPI rejected the credential. Check that MUAPI_API_KEY holds a current key from https://muapi.ai/access-keys.",
    );
    this.name = "MuApiAuthError";
  }
}

export class MuApiRequestError extends Error {
  readonly failure: GenerationFailure;
  constructor(failure: GenerationFailure) {
    super(failure.message);
    this.name = "MuApiRequestError";
    this.failure = failure;
  }
}

/** What a submit call produced. */
export type MuApiSubmission =
  | { kind: "accepted"; requestId: string }
  /** The endpoint answered inline. Rare, but real for a few MuAPI tools. */
  | { kind: "inline"; outputs: readonly string[] };

export type MuApiResult = {
  requestId: string;
  state: "queued" | "running" | "succeeded" | "failed";
  outputs: readonly string[];
  /** MuAPI's own error text, when it gave one. Never a credential. */
  errorMessage: string | null;
};

export type MuApiClientOptions = {
  transport?: MuApiTransport;
  baseUrl?: string;
  /** Abort budget for a submit. Submits return an id quickly or not at all. */
  submitTimeoutMs?: number;
  /** Abort budget for one poll. Shorter: a poll is cheap and frequently retried. */
  pollTimeoutMs?: number;
};

export class MuApiClient {
  private readonly transport: MuApiTransport;
  private readonly baseUrl: string;
  private readonly submitTimeoutMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: MuApiClientOptions = {}) {
    this.transport = options.transport ?? fetchTransport;
    this.baseUrl = options.baseUrl ?? MUAPI_BASE_URL;
    this.submitTimeoutMs = options.submitTimeoutMs ?? 30_000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 15_000;
  }

  /**
   * Submits a generation task.
   *
   * `endpoint` comes from the catalogue, never from user input and never
   * constructed from a model name — MuAPI's slugs are not derivable (`flux-dev`
   * posts to `flux-dev-image`), and accepting an arbitrary path here would turn
   * this method into the open relay the upstream project's middleware actually
   * is.
   */
  async submit(endpoint: string, payload: Record<string, unknown>): Promise<MuApiSubmission> {
    const body = await this.call(
      `/api/v1/${encodeURIComponent(endpoint)}`,
      { method: "POST", body: JSON.stringify(payload) },
      this.submitTimeoutMs,
    );
    return parseSubmit(body);
  }

  /** Polls one task. One call, no loop — the loop is a durable job. */
  async result(requestId: string): Promise<MuApiResult> {
    const body = await this.call(
      `/api/v1/predictions/${encodeURIComponent(requestId)}/result`,
      { method: "GET" },
      this.pollTimeoutMs,
    );
    return parseResult(requestId, body);
  }

  private async call(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<unknown> {
    const key = muapiApiKey();
    if (!key) {
      throw new MuApiRequestError({
        code: "provider_unconfigured",
        message: "Provider configuration required: MUAPI_API_KEY is not set.",
        retryable: false,
        costIncurred: false,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let result: { status: number; body: unknown };
    try {
      result = await this.transport(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          [MUAPI_AUTH_HEADER]: key,
          "content-type": "application/json",
          accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch {
      // Network error or abort. Retryable: nothing was confirmed submitted.
      //
      // `costIncurred: false` is a genuine guess, as it is in the Magnific
      // client: a submit that timed out MAY have reached MuAPI. What actually
      // prevents a double charge on retry is the idempotency key on the run
      // row, not this flag — which only governs the refund path for a task we
      // never got an id for, and therefore cannot reconcile in any case.
      throw new MuApiRequestError({
        code: controller.signal.aborted ? "timeout" : "network_error",
        message: controller.signal.aborted
          ? "MuAPI did not respond in time. The request was not confirmed."
          : "Could not reach MuAPI.",
        retryable: true,
        costIncurred: false,
      });
    } finally {
      clearTimeout(timer);
    }

    if (result.status === 401 || result.status === 403) throw new MuApiAuthError();
    if (result.status >= 400) throw new MuApiRequestError(mapFailure(result.status, result.body));

    return result.body;
  }
}

/**
 * Maps an HTTP status onto a failure the rest of the system can act on.
 *
 * `retryable` drives the worker's backoff decision and `costIncurred` drives
 * whether a credit reservation is refunded in full, so these two fields are the
 * ones with consequences and the reason this is a function rather than a
 * generic error.
 */
export function mapFailure(status: number, body: unknown): GenerationFailure {
  const detail = extractMessage(body);

  if (status === 402) {
    return {
      code: "provider_credit_exhausted",
      // Deliberately does not surface MuAPI's balance to the end user. This is
      // Virally's account, not theirs; they bought Production Credits and the
      // state of our vendor account is not something they can act on.
      message:
        "Generation is temporarily unavailable. The workspace has not been charged.",
      retryable: false,
      costIncurred: false,
    };
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      message: "MuAPI is rate limiting this API key. The job will retry automatically.",
      retryable: true,
      // Rejected before generation, so nothing was billed.
      costIncurred: false,
    };
  }
  if (status === 503) {
    return {
      code: "provider_unavailable",
      message: "MuAPI is temporarily unavailable. The job will retry automatically.",
      retryable: true,
      costIncurred: false,
    };
  }
  if (status >= 500) {
    return {
      code: "provider_error",
      message: "MuAPI returned a server error. The job will retry automatically.",
      retryable: true,
      // A 500 can follow a generation that already ran. Conservative: assume it
      // was billed, so a real provider cost is not silently absorbed.
      costIncurred: true,
    };
  }
  if (status === 400 || status === 422) {
    return {
      code: "invalid_request",
      // MuAPI's validation text names the offending field and contains no
      // credential, and it is the only thing that says WHICH field was wrong.
      message: detail
        ? `MuAPI rejected the request: ${detail}`
        : "MuAPI rejected the request as invalid.",
      retryable: false,
      costIncurred: false,
    };
  }
  return {
    code: `http_${status}`,
    message: detail ? `MuAPI returned an error: ${detail}` : "MuAPI returned an error.",
    retryable: false,
    costIncurred: false,
  };
}

function extractMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  for (const field of ["message", "error", "detail"] as const) {
    const value = body[field];
    if (typeof value === "string" && value !== "") return value.slice(0, 300);
  }
  return null;
}

/**
 * Normalises a submit response.
 *
 * MuAPI returns the id as `request_id` on most endpoints and `id` on a few, and
 * some endpoints skip the queue entirely and answer with the result. All three
 * are accepted; anything else is a malformed response and fails loudly here
 * rather than producing a run row with an undefined external id that trips a
 * NOT NULL constraint three layers away.
 */
export function parseSubmit(body: unknown): MuApiSubmission {
  if (!isRecord(body)) {
    throw new MuApiRequestError({
      code: "malformed_response",
      message: "MuAPI returned a response that was not an object.",
      retryable: false,
      costIncurred: false,
    });
  }

  const requestId = firstString(body.request_id, body.id);
  if (requestId !== null) return { kind: "accepted", requestId };

  const outputs = extractOutputs(body);
  if (outputs.length > 0) return { kind: "inline", outputs };

  throw new MuApiRequestError({
    code: "malformed_response",
    message: "MuAPI accepted the request but returned neither a task id nor a result.",
    retryable: false,
    costIncurred: false,
  });
}

/**
 * Normalises a poll response.
 *
 * An absent or unrecognised status is treated as "still running" rather than as
 * an error. MuAPI's in-progress vocabulary is not fully documented, and the
 * failure mode of guessing wrong matters: treating an unknown status as failure
 * would abandon and refund a generation that was about to succeed and had
 * already been billed for. Treating it as running costs one more poll, and the
 * job's own deadline is what stops it running forever.
 */
export function parseResult(requestId: string, body: unknown): MuApiResult {
  if (!isRecord(body)) {
    throw new MuApiRequestError({
      code: "malformed_response",
      message: "MuAPI returned a poll response that was not an object.",
      retryable: false,
      costIncurred: false,
    });
  }

  const raw = typeof body.status === "string" ? body.status.toLowerCase() : "";
  const outputs = extractOutputs(body);
  const errorMessage = extractMessage(body);

  if (FAILURE_STATUSES.has(raw)) {
    return { requestId, state: "failed", outputs: [], errorMessage };
  }
  if (SUCCESS_STATUSES.has(raw)) {
    if (outputs.length === 0) {
      // Success with nothing to download is not success. Reported as a failure
      // so the run does not sit in `downloading` forever waiting for bytes that
      // will never arrive.
      return {
        requestId,
        state: "failed",
        outputs: [],
        errorMessage: "MuAPI reported the task complete but returned no output.",
      };
    }
    return { requestId, state: "succeeded", outputs, errorMessage: null };
  }
  if (QUEUED_STATUSES.has(raw)) {
    return { requestId, state: "queued", outputs: [], errorMessage: null };
  }
  return { requestId, state: "running", outputs: [], errorMessage: null };
}

/**
 * Pulls result URLs out of MuAPI's several result shapes.
 *
 * `outputs[]` is the documented one; `url` and `output.url` appear on older
 * endpoints. Non-string and empty entries are dropped rather than passed on, so
 * ingestion never receives something it will fail to fetch.
 */
function extractOutputs(body: Record<string, unknown>): readonly string[] {
  if (Array.isArray(body.outputs)) {
    const urls = body.outputs.filter(
      (item): item is string => typeof item === "string" && item !== "",
    );
    if (urls.length > 0) return urls;
  }
  const direct = firstString(body.url);
  if (direct !== null) return [direct];
  if (isRecord(body.output)) {
    const nested = firstString(body.output.url);
    if (nested !== null) return [nested];
  }
  return [];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
