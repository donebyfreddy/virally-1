import { config } from "dotenv";

/**
 * Local dev job worker.
 *
 * There is no daemon in production either — `POST /api/cron/generation`
 * drains the queue in serverless, time-bounded batches, meant to be invoked
 * by an external scheduler (see that route and `runQueueOnce` in
 * src/lib/jobs/runner.ts). Nothing plays that role in local dev, so a job
 * enqueued by `npm run dev` — a generation, a render — sits `queued` forever
 * unless something calls the drain loop. This is that something: a plain
 * polling process you run alongside `npm run dev` while working locally.
 *
 * `.env` first, then `.env.local` overriding it — the same precedence
 * Next.js's own env loading uses, so a value only `npm run dev` would see
 * (FAL_API_KEY, DATABASE_URL, ...) is also what this process sees.
 */
config({ path: ".env" });
config({ path: ".env.local", override: true });

/** How long an empty queue waits before checking again. Not a hot loop. */
const IDLE_POLL_MS = 3_000;
/** How long a non-empty batch waits before the next drain — short, so a run's poll cadence doesn't visibly lag behind what the provider actually reports. */
const ACTIVE_POLL_MS = 500;

async function main(): Promise<void> {
  const { runQueueOnce } = await import("../src/lib/jobs/runner");
  const { pool } = await import("../src/lib/db");

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("[worker] Draining the job queue. Ctrl+C to stop.");

  while (!stopping) {
    const report = await runQueueOnce({ budgetMs: 25_000 });
    if (report.claimed > 0) {
      console.log(
        `[worker] claimed ${report.claimed} — completed ${report.completed}, polling ${report.polling}, failed ${report.failed}, errored ${report.errored}`,
      );
    }
    await sleep(report.claimed > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  }

  await pool.end();
  console.log("[worker] Stopped.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
