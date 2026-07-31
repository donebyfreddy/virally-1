import { magnificApiKey } from "../env";
import type { GenerationFailure } from "../types";
import { MAGNIFIC_AUTH_HEADER, MAGNIFIC_BASE_URL, isMagnificTaskStatus } from "./catalog";
import type { MagnificTaskStatus } from "./catalog";

/**
 * HTTP transport for the Magnific API.
 *
 * Separated from the provider adapter so the adapter's request-building and
 * response-mapping logic can be tested against a stub transport without a
 * network, and so every rule about credentials and error handling lives in one
 * reviewable place.
 */

/** Shape of `data` on every async endpoint, per the OpenAPI `task-detail` schema. */
export type MagnificTaskEnvelope = {
  data: {
    task_id: string;
    status: MagnificTaskStatus;
    /** URLs of the generated media. Empty until COMPLETED. */
    generated: string[];
  };
};

export type MagnificTransport = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; body: unknown }>;

/**
 * Default transport.
 *
 * Reads the body as text first and parses defensively. Magnific returns
 * `application/problem+json` for validation errors and bare HTML from its edge
 * on a 5xx, so `response.json()` throws on exactly the responses whose content
 * matters most for diagnosis.
 */
const fetchTransport: MagnificTransport = async (url, init) => {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      // Kept as a string so the failure mapper can still produce a useful code,
      // rather than discarding the only evidence of what went wrong.
      body = { message: text.slice(0, 500) };
    }
  }
  return { status: response.status, body };
};

export type MagnificClientOptions = {
  transport?: MagnificTransport;
  baseUrl?: string;
  /** Abort budget for one call. Generation is async, so submits return quickly. */
  timeoutMs?: number;
};

export class MagnificAuthError extends Error {
  constructor() {
    // Names the variable, never the value, and never echoes the API response —
    // which on a 401 can contain a prefix of the key that was sent.
    super(
      "Magnific rejected the credential. Check that MAGNIFIC_API_KEY holds a current key from https://www.magnific.com/user/api-keys.",
    );
    this.name = "MagnificAuthError";
  }
}

export class MagnificRequestError extends Error {
  readonly failure: GenerationFailure;
  constructor(failure: GenerationFailure) {
    super(failure.message);
    this.name = "MagnificRequestError";
    this.failure = failure;
  }
}

export class MagnificClient {
  private readonly transport: MagnificTransport;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: MagnificClientOptions = {}) {
    this.transport = options.transport ?? fetchTransport;
    this.baseUrl = options.baseUrl ?? MAGNIFIC_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Submits a generation task. Returns as soon as Magnific issues a task id. */
  async submit(path: string, payload: Record<string, unknown>): Promise<MagnificTaskEnvelope> {
    return this.call(path, { method: "POST", body: JSON.stringify(payload) });
  }

  /** Polls one task. Status lives at the submit path plus the task id. */
  async status(path: string, taskId: string): Promise<MagnificTaskEnvelope> {
    return this.call(`${path}/${encodeURIComponent(taskId)}`, { method: "GET" });
  }

  private async call(path: string, init: RequestInit): Promise<MagnificTaskEnvelope> {
    const key = magnificApiKey();
    if (!key) {
      throw new MagnificRequestError({
        code: "provider_unconfigured",
        message: "Provider configuration required: MAGNIFIC_API_KEY is not set.",
        retryable: false,
        costIncurred: false,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let result: { status: number; body: unknown };
    try {
      result = await this.transport(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          [MAGNIFIC_AUTH_HEADER]: key,
          "content-type": "application/json",
          accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
    } catch {
      // A network error or abort. Retryable: nothing was confirmed submitted.
      //
      // Note `costIncurred: false` is a genuine guess here and the only place one
      // is made — a submit that timed out MAY have reached Magnific. The
      // idempotency key on the job row is what actually prevents a double charge
      // on retry; this flag only controls the refund path for a task we never
      // got an id for, which by definition we cannot reconcile anyway.
      throw new MagnificRequestError({
        code: controller.signal.aborted ? "timeout" : "network_error",
        message: controller.signal.aborted
          ? "Magnific did not respond in time. The request was not confirmed."
          : "Could not reach Magnific.",
        retryable: true,
        costIncurred: false,
      });
    } finally {
      clearTimeout(timer);
    }

    if (result.status === 401 || result.status === 403) throw new MagnificAuthError();
    if (result.status >= 400) throw new MagnificRequestError(mapFailure(result.status, result.body));

    return parseEnvelope(result.body);
  }
}

/**
 * Maps an HTTP status onto a failure the rest of the system can act on.
 *
 * `retryable` and `costIncurred` are the two fields with consequences: the
 * former drives the worker's backoff decision, the latter drives whether a
 * credit reservation is refunded in full.
 */
export function mapFailure(status: number, body: unknown): GenerationFailure {
  const detail = extractMessage(body);

  if (status === 429) {
    return {
      code: "rate_limited",
      message: "Magnific is rate limiting this API key. The job will retry automatically.",
      retryable: true,
      // Rate-limited requests are rejected before generation, so nothing is billed.
      costIncurred: false,
    };
  }
  if (status === 503) {
    return {
      code: "provider_unavailable",
      message: "Magnific is temporarily unavailable. The job will retry automatically.",
      retryable: true,
      costIncurred: false,
    };
  }
  if (status >= 500) {
    return {
      code: "provider_error",
      message: "Magnific returned a server error. The job will retry automatically.",
      retryable: true,
      // A 500 can follow a generation that already ran. Conservative: assume it
      // was billed, so we do not silently absorb a real cost. Reconciliation
      // against the analytics endpoint corrects it later.
      costIncurred: true,
    };
  }
  if (status === 400 || status === 422) {
    return {
      code: "invalid_request",
      // The provider's own validation text is the only thing that says WHICH
      // field was wrong, and Magnific's 400 bodies contain field names, not
      // credentials.
      message: detail
        ? `Magnific rejected the request: ${detail}`
        : "Magnific rejected the request as invalid.",
      retryable: false,
      costIncurred: false,
    };
  }
  return {
    code: `http_${status}`,
    message: detail ? `Magnific returned an error: ${detail}` : "Magnific returned an error.",
    retryable: false,
    costIncurred: false,
  };
}

/** Pulls a human-readable message out of Magnific's two error body shapes. */
function extractMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  if (typeof record.message === "string") return record.message.slice(0, 300);

  // application/problem+json: { problem: { message, invalid_params: [...] } }
  const problem = record.problem;
  if (typeof problem === "object" && problem !== null) {
    const inner = problem as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message.slice(0, 300);
  }
  return null;
}

/**
 * Validates the response envelope before anything downstream trusts it.
 *
 * A provider that changes its response shape must fail here with a clear error,
 * not produce a task row with an `undefined` id that fails a NOT NULL constraint
 * three layers away.
 */
export function parseEnvelope(body: unknown): MagnificTaskEnvelope {
  const data =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).data
      : undefined;

  if (typeof data !== "object" || data === null) {
    throw new MagnificRequestError({
      code: "malformed_response",
      message: "Magnific returned a response without a task envelope.",
      retryable: false,
      costIncurred: false,
    });
  }

  const record = data as Record<string, unknown>;
  const taskId = record.task_id;
  const status = record.status;

  if (typeof taskId !== "string" || taskId === "") {
    throw new MagnificRequestError({
      code: "malformed_response",
      message: "Magnific returned a task without an id.",
      retryable: false,
      costIncurred: false,
    });
  }
  if (!isMagnificTaskStatus(status)) {
    throw new MagnificRequestError({
      code: "malformed_response",
      message: `Magnific returned an unrecognised task status.`,
      retryable: false,
      costIncurred: false,
    });
  }

  const generated = Array.isArray(record.generated)
    ? record.generated.filter((item): item is string => typeof item === "string")
    : [];

  return { data: { task_id: taskId, status, generated } };
}
