import { createHmac, timingSafeEqual } from "node:crypto";
import { magnificWebhookSecret } from "../env";

/**
 * Inbound webhook verification.
 *
 * A webhook endpoint is an unauthenticated write path into the job table. If an
 * attacker can forge one, they can mark generations complete, attach arbitrary
 * media URLs to another workspace's content, and drain reservations. Every check
 * below is load-bearing; none is defence in depth.
 *
 * Scheme, per https://docs.magnific.com/webhooks:
 *   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature      = base64( HMAC-SHA256(secret, content) )
 *   headers        = webhook-id, webhook-timestamp, webhook-signature
 */

/** How far a timestamp may be from now. Bounds the replay window. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type WebhookVerification =
  | { ok: true; id: string }
  /**
   * `reason` is for the server log only and must never be returned in the HTTP
   * response. Telling a caller *why* their forgery failed turns the endpoint
   * into an oracle for constructing a working one.
   */
  | { ok: false; reason: string };

export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    id: headers.get("webhook-id"),
    timestamp: headers.get("webhook-timestamp"),
    signature: headers.get("webhook-signature"),
  };
}

/**
 * Verifies a webhook against the shared secret.
 *
 * `rawBody` must be the exact bytes received. Re-serialising parsed JSON
 * changes key order and whitespace, which changes the HMAC — so the route must
 * call `request.text()` and verify before `JSON.parse`, never after.
 */
export function verifyMagnificWebhook(
  headers: WebhookHeaders,
  rawBody: string,
  options: { nowSeconds?: number; secret?: string } = {},
): WebhookVerification {
  const secret = options.secret ?? magnificWebhookSecret();
  if (!secret) {
    // Not an error condition — it is the documented unconfigured state. The
    // route turns this into a 503 and the system keeps polling.
    return { ok: false, reason: "MAGNIFIC_WEBHOOK_SECRET is not set; webhooks are refused." };
  }

  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "Missing one of webhook-id, webhook-timestamp, webhook-signature." };
  }

  const sentAt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "webhook-timestamp is not an integer." };
  }

  // Checked BEFORE the HMAC comparison so a replayed-but-validly-signed request
  // is rejected on age. Both directions are bounded: a far-future timestamp is
  // as much a forgery signal as a stale one.
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - sentAt) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "webhook-timestamp is outside the tolerance window." };
  }

  const expected = signWebhook(secret, id, timestamp, rawBody);
  if (!constantTimeEquals(expected, signature)) {
    return { ok: false, reason: "webhook-signature does not match." };
  }

  return { ok: true, id };
}

/** Produces the base64 HMAC-SHA256 signature for a payload. Exported for tests. */
export function signWebhook(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
): string {
  return createHmac("sha256", Buffer.from(secret, "utf-8"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
}

/**
 * Length-safe constant-time comparison.
 *
 * `timingSafeEqual` throws on length mismatch, and that throw is itself a
 * timing signal, so lengths are compared first and unequal lengths short-circuit
 * to false — an attacker learns only the signature length, which base64 of a
 * fixed-size digest already makes public.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf-8");
  const right = Buffer.from(b, "utf-8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
