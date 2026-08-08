import { falApiKey } from "../env";
import type { GenerationFailure } from "../types";
import { FAL_AUTH_HEADER, FAL_BASE_URL } from "./catalog";

/**
 * HTTP transport for the fal.ai queue API.
 *
 * Structured as a deliberate mirror of `MagnificClient` and the removed
 * `MuApiClient`: same transport seam, same abort budget, same failure mapping,
 * same rule that no credential and no raw provider body ever reaches a log
 * line or an `Error` message.
 *
 * fal's queue API differs from both prior adapters in one structural way: the
 * endpoint id is part of every URL, not just the submit URL. A poll or a
 * result fetch needs `{queueBase}/requests/{requestId}`, not just the request
 * id — which is why `FalProvider` encodes the endpoint id into the task id it
 * returns rather than re-deriving a model from the run's kind at poll time the
 * way the Magnific adapter does.
 *
 * `{queueBase}` is NOT the full submit endpoint — see `queueBase` below. Using
 * the full endpoint id here fails silently until a real poll happens: submit
 * always succeeds regardless (it uses the full id correctly), so the mistake
 * only surfaces the first time something actually drains the queue against a
 * live provider.
 */

export type FalQueueState = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

export type FalTransport = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; body: unknown }>;

const fetchTransport: FalTransport = async (url, init) => {
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

export class FalAuthError extends Error {
  constructor() {
    super(
      "fal.ai rejected the credential. Check that FAL_API_KEY holds a current key from https://fal.ai/dashboard/keys.",
    );
    this.name = "FalAuthError";
  }
}

export class FalRequestError extends Error {
  readonly failure: GenerationFailure;
  constructor(failure: GenerationFailure) {
    super(failure.message);
    this.name = "FalRequestError";
    this.failure = failure;
  }
}

export type FalSubmission = { requestId: string };

export type FalStatus = {
  state: FalQueueState;
  queuePosition: number | null;
  /** Present only when the status payload itself carried an error. */
  errorMessage: string | null;
};

export type FalClientOptions = {
  transport?: FalTransport;
  baseUrl?: string;
  submitTimeoutMs?: number;
  pollTimeoutMs?: number;
};

/**
 * The queue namespace a submit endpoint's status/result/cancel calls live
 * under — the model owner and app name, dropping everything after.
 *
 * Confirmed directly against the live API rather than assumed: a real submit
 * to `fal-ai/flux/dev` returns `status_url: ".../fal-ai/flux/requests/{id}/status"`
 * — `/dev` dropped — and a submit to `fal-ai/kokoro/american-english` returns
 * `".../fal-ai/kokoro/requests/{id}/status"` — `/american-english` dropped.
 * `fal-ai/stable-audio` (already two segments) round-trips unchanged, which is
 * also why a two-segment model's status calls happened to work despite this
 * function's absence — the queue base and the submit endpoint are identical
 * exactly when there is no third segment to drop.
 */
function queueBase(endpointId: string): string {
  return endpointId.split("/").slice(0, 2).join("/");
}

export class FalClient {
  private readonly transport: FalTransport;
  private readonly baseUrl: string;
  private readonly submitTimeoutMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: FalClientOptions = {}) {
    this.transport = options.transport ?? fetchTransport;
    this.baseUrl = options.baseUrl ?? FAL_BASE_URL;
    this.submitTimeoutMs = options.submitTimeoutMs ?? 30_000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 15_000;
  }

  /**
   * Submits a generation task.
   *
   * `endpointId` comes from the catalogue, never constructed from a model name —
   * `fal-ai/flux/dev` and `fal-ai/flux-pro/kontext` share nothing derivable from
   * one another, and accepting an arbitrary path here would let a caller submit
   * to any fal model, billed to Virally's key, regardless of what the catalogue
   * actually offers.
   */
  async submit(endpointId: string, payload: Record<string, unknown>): Promise<FalSubmission> {
    const body = await this.call(
      `/${endpointId}`,
      { method: "POST", body: JSON.stringify(payload) },
      this.submitTimeoutMs,
    );
    return parseSubmit(body);
  }

  async status(endpointId: string, requestId: string): Promise<FalStatus> {
    const body = await this.call(
      `/${queueBase(endpointId)}/requests/${encodeURIComponent(requestId)}/status`,
      { method: "GET" },
      this.pollTimeoutMs,
    );
    return parseStatus(body);
  }

  /** The model's own output shape once `status` reports `COMPLETED`. */
  async result(endpointId: string, requestId: string): Promise<unknown> {
    return this.call(
      `/${queueBase(endpointId)}/requests/${encodeURIComponent(requestId)}`,
      { method: "GET" },
      this.pollTimeoutMs,
    );
  }

  async cancel(endpointId: string, requestId: string): Promise<void> {
    await this.call(
      `/${queueBase(endpointId)}/requests/${encodeURIComponent(requestId)}/cancel`,
      { method: "PUT" },
      this.pollTimeoutMs,
    );
  }

  private async call(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const key = falApiKey();
    if (!key) {
      throw new FalRequestError({
        code: "provider_unconfigured",
        message: "Provider configuration required: FAL_API_KEY is not set.",
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
          [FAL_AUTH_HEADER]: `Key ${key}`,
          "content-type": "application/json",
          accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch {
      // Network error or abort. Retryable: nothing was confirmed submitted.
      // `costIncurred: false` is a genuine guess — a submit that timed out MAY
      // have reached fal — but the idempotency key on the run row, not this
      // flag, is what actually prevents a double charge on retry.
      throw new FalRequestError({
        code: controller.signal.aborted ? "timeout" : "network_error",
        message: controller.signal.aborted
          ? "fal.ai did not respond in time. The request was not confirmed."
          : "Could not reach fal.ai.",
        retryable: true,
        costIncurred: false,
      });
    } finally {
      clearTimeout(timer);
    }

    if (result.status === 401 || result.status === 403) throw new FalAuthError();
    if (result.status >= 400) throw new FalRequestError(mapFailure(result.status, result.body));

    return result.body;
  }
}

export function mapFailure(status: number, body: unknown): GenerationFailure {
  const detail = extractMessage(body);

  if (status === 429) {
    return {
      code: "rate_limited",
      message: "fal.ai is rate limiting this API key. The job will retry automatically.",
      retryable: true,
      costIncurred: false,
    };
  }
  if (status === 503) {
    return {
      code: "provider_unavailable",
      message: "fal.ai is temporarily unavailable. The job will retry automatically.",
      retryable: true,
      costIncurred: false,
    };
  }
  if (status >= 500) {
    return {
      code: "provider_error",
      message: "fal.ai returned a server error. The job will retry automatically.",
      retryable: true,
      // A 500 can follow a generation that already ran. Conservative: assume it
      // was billed, so a real provider cost is not silently absorbed.
      costIncurred: true,
    };
  }
  if (status === 400 || status === 422) {
    return {
      code: "invalid_request",
      message: detail
        ? `fal.ai rejected the request: ${detail}`
        : "fal.ai rejected the request as invalid.",
      retryable: false,
      costIncurred: false,
    };
  }
  if (status === 404) {
    return {
      code: "not_found",
      message: "fal.ai has no record of this model or task.",
      retryable: false,
      costIncurred: false,
    };
  }
  return {
    code: `http_${status}`,
    message: detail ? `fal.ai returned an error: ${detail}` : "fal.ai returned an error.",
    retryable: false,
    costIncurred: false,
  };
}

function extractMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  for (const field of ["detail", "message", "error"] as const) {
    const value = body[field];
    if (typeof value === "string" && value !== "") return value.slice(0, 300);
    // fal's validation errors sometimes carry `detail` as an array of
    // `{loc, msg}` objects rather than a string.
    if (Array.isArray(value)) {
      const first = value.find((entry) => isRecord(entry) && typeof entry.msg === "string");
      if (first && isRecord(first)) return String(first.msg).slice(0, 300);
    }
  }
  return null;
}

export function parseSubmit(body: unknown): FalSubmission {
  if (!isRecord(body) || typeof body.request_id !== "string" || body.request_id === "") {
    throw new FalRequestError({
      code: "malformed_response",
      message: "fal.ai accepted the request but returned no task id.",
      retryable: false,
      costIncurred: false,
    });
  }
  return { requestId: body.request_id };
}

const QUEUE_STATES: readonly FalQueueState[] = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];

/**
 * Normalises a status response.
 *
 * An unrecognised status string is treated as `IN_PROGRESS` rather than as a
 * failure, for the same reason the removed MuAPI adapter treated an unknown
 * status as running: guessing "failed" would abandon and refund a generation
 * that was about to succeed and had already been billed for.
 */
export function parseStatus(body: unknown): FalStatus {
  if (!isRecord(body)) {
    throw new FalRequestError({
      code: "malformed_response",
      message: "fal.ai returned a status response that was not an object.",
      retryable: false,
      costIncurred: false,
    });
  }

  const raw = typeof body.status === "string" ? body.status : "";
  const state = QUEUE_STATES.includes(raw as FalQueueState) ? (raw as FalQueueState) : "IN_PROGRESS";
  const queuePosition = typeof body.queue_position === "number" ? body.queue_position : null;
  const errorMessage = extractMessage(body);

  return { state, queuePosition, errorMessage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
