import { after } from "next/server";
import { CRON_SECRET_ENV, isCronConfigured } from "./auth";

/**
 * Kicks the queue drain right after a job is enqueued, instead of waiting for
 * the next scheduled invocation of `POST /api/cron/generation`.
 *
 * The cron schedule (see `vercel.json`) is what guarantees a queued job is
 * eventually picked up even if this call is lost — a crashed instance, a
 * network blip, the request itself being killed before `after()` runs. This
 * function only shaves the latency between "job enqueued" and "worker sees
 * it" down from a whole cron interval to effectively zero in the common case.
 * It is an optimisation, never the only path to completion.
 *
 * Fire-and-forget by construction: scheduled with `after()` so it never
 * delays the response the user is waiting on (a server action returning, a
 * page finishing its request), and its outcome is deliberately not observed
 * by the caller. If the fetch fails, times out, or the target 500s, the next
 * cron tick drains the same job regardless — nothing here is load-bearing for
 * correctness, only for how fast generation appears to start.
 */
export function triggerQueueDrain(): void {
  if (!isCronConfigured()) return;

  const url = queueDrainUrl();
  if (!url) return;

  const secret = process.env[CRON_SECRET_ENV]!.trim();

  after(async () => {
    try {
      await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
    } catch {
      // Deliberately swallowed — see the module doc comment. The cron
      // schedule is the correctness guarantee; this is best-effort latency.
    }
  });
}

/**
 * Where the queue-drain endpoint lives, from this same deployment.
 *
 * `NEXT_PUBLIC_SITE_URL` is required app-wide (see `.env.example`) and is
 * preferred because it is the canonical origin the operator configured.
 * `VERCEL_URL` is the fallback for preview deployments, which get a unique
 * host Vercel assigns rather than the canonical one.
 */
function queueDrainUrl(): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return `${site.replace(/\/+$/, "")}/api/cron/generation`;

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}/api/cron/generation`;

  return null;
}
