import { createHmac, timingSafeEqual } from "node:crypto";
import { muapiApiKey } from "../env";

/**
 * Inbound MuAPI completion callbacks.
 *
 * MuAPI supports a `webhook` parameter but publishes NO signature scheme —
 * there is no shared secret, no HMAC header, nothing to verify a request came
 * from the vendor. That single fact determines the whole design here, and it is
 * worth stating plainly because the obvious implementation is dangerous:
 *
 * An unsigned webhook that mutates a run is an **unauthenticated write path
 * into the billing system**. Anyone who learns a URL shape could mark runs
 * complete, mark them failed, or trigger settlement — and since Virally cannot
 * distinguish the vendor from an attacker, it must not try.
 *
 * So a MuAPI webhook is treated as an **untrusted hint**. A valid hit does
 * exactly one thing: it moves a job's `run_after` earlier so the poller checks
 * sooner. The authenticated OUTBOUND poll remains the sole source of truth about
 * what happened, what it cost and whether media exists. The worst an attacker
 * with a valid URL can achieve is causing Virally to poll its own provider a few
 * seconds early — which is not a capability worth attacking.
 *
 * The URL still carries a per-run capability token, for two reasons that hold
 * even though the endpoint grants nothing dangerous: it stops the route being a
 * free run-enumeration oracle, and it bounds the rate at which an unauthenticated
 * caller can make us poll.
 *
 * Contrast with `magnific/webhook.ts`, which verifies a real HMAC and IS
 * permitted to advance state. The two providers get different trust because they
 * offer different guarantees, not because one adapter is more careful.
 */

/**
 * Derives the capability token embedded in a run's webhook URL.
 *
 * Keyed on the MuAPI API key rather than a separate secret. That is a
 * deliberate reuse: the token needs to be unguessable and stable for the life
 * of a run, and introducing a second env var for a value that grants only "poll
 * slightly sooner" would be configuration burden with no security return. The
 * key never leaves the server and the HMAC is one-way, so the token discloses
 * nothing about it.
 *
 * Returns null when MuAPI is unconfigured — there is then no run to call back
 * about, and generating a token from a missing key would produce a constant.
 */
export function webhookTokenFor(runId: string): string | null {
  const key = muapiApiKey();
  if (!key) return null;
  return createHmac("sha256", key).update(`muapi-webhook:${runId}`).digest("hex").slice(0, 32);
}

/**
 * Builds the absolute callback URL for a run.
 *
 * Absolute because MuAPI must be able to reach it, and HTTPS-only because the
 * vendor documents that requirement. Returns null rather than a best-guess
 * origin when the site URL is unset or not HTTPS: a webhook pointed at
 * `http://localhost:3000` from a cloud provider is not merely useless, it is a
 * silent failure that looks like a slow generation.
 */
export function webhookUrlFor(runId: string, siteUrl: string | undefined): string | null {
  const token = webhookTokenFor(runId);
  if (!token || !siteUrl) return null;

  let origin: URL;
  try {
    origin = new URL(siteUrl);
  } catch {
    return null;
  }
  if (origin.protocol !== "https:") return null;

  return new URL(
    `/api/webhooks/muapi/${encodeURIComponent(runId)}?token=${token}`,
    origin,
  ).toString();
}

export type WebhookVerification =
  | { ok: true; runId: string }
  /** `reason` is for the server log only. It is never returned to the caller. */
  | { ok: false; reason: string };

/**
 * Checks the capability token on an inbound callback.
 *
 * Constant-time, for the same reason the cron secret is: a token recoverable a
 * byte at a time through response timing is not unguessable. Cheap to do
 * correctly, so there is no argument for the naive comparison.
 */
export function verifyWebhookToken(
  runId: string,
  presented: string | null,
): WebhookVerification {
  if (!presented) return { ok: false, reason: "No token was presented." };

  const expected = webhookTokenFor(runId);
  if (!expected) return { ok: false, reason: "MuAPI is not configured." };

  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return { ok: false, reason: "Token length mismatch." };
  if (!timingSafeEqual(left, right)) return { ok: false, reason: "Token mismatch." };

  return { ok: true, runId };
}
