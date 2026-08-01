import { timingSafeEqual } from "node:crypto";

/**
 * Authorisation for the queue-drain endpoint.
 *
 * The endpoint has no user and no tenant — it acts across every workspace — so
 * none of the session machinery applies. What protects it is a shared secret,
 * and the rules below all follow from what it would cost to get this wrong: an
 * unauthenticated caller could drain the queue at will, which is not
 * destructive but is a free way to burn provider spend and rate-limit budget.
 *
 * Absent secret means CLOSED, not open. A deployment that forgot to set it gets
 * a queue that does not drain, which is visible and recoverable. The
 * alternative — treating "no secret configured" as "no authentication
 * required" — is the failure that only announces itself as an unexplained
 * provider bill.
 */

export const CRON_SECRET_ENV = "CRON_SECRET" as const;

function readSecret(): string | undefined {
  if (typeof window !== "undefined") {
    throw new Error(
      "The cron secret was read in a browser context. src/lib/jobs/auth.ts is server-only.",
    );
  }
  const value = process.env[CRON_SECRET_ENV];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function isCronConfigured(): boolean {
  return readSecret() !== undefined;
}

/**
 * Whether a request may drain the queue.
 *
 * Accepts the secret as a bearer token, which is what schedulers send. Compared
 * in constant time: a naive `===` leaks the shared prefix through timing, and a
 * secret that can be recovered a byte at a time is not a secret.
 */
export function isCronRequestAuthorised(request: Request): boolean {
  const expected = readSecret();
  if (!expected) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const presented = header.slice(prefix.length);

  return constantTimeEquals(presented, expected);
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on length mismatch, so length is checked first and
 * short-circuits. That does leak the secret's length, which is not a meaningful
 * disclosure — the entropy is in the bytes, and a caller could learn the length
 * by other means anyway.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
