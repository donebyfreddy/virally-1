"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { readActiveGenerationsAction } from "@/lib/generation/actions";
import type { GenerationStatus } from "@/lib/generation/data";
// Deep import rather than `@/lib/creative`: the package index re-exports the
// provider router, which reaches the database driver. A client component that
// imported it would pull server-only modules into the browser bundle. The
// constant itself lives in a leaf module with no such dependencies.
import { DEMO_OUTPUT_LABEL } from "@/lib/creative/mock";
import { centsToCredits } from "@/lib/creative/modes";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/app-ui/States";
import { generateCopy } from "@/content/generate";
import { DemoChip, RunProgress, RunStateChip } from "./RunState";

/**
 * Live state for generations still in flight.
 *
 * The polling rules here are the whole reason this is a client component, and
 * each one exists because the naive version is expensive:
 *
 *   STOPS when nothing is in flight. An idle studio makes no requests at all —
 *   a 2s interval left running on an open tab is 1,800 authenticated queries an
 *   hour to be told nothing changed.
 *
 *   PAUSES when the document is hidden. A backgrounded tab is the single
 *   largest source of pointless polling, and the user cannot see the result.
 *
 *   BACKS OFF from ~2s to ~10s. Generation takes tens of seconds to minutes, so
 *   the first few seconds are where a fast poll earns its cost and the tenth
 *   minute is where it does not. The interval resets to its floor whenever the
 *   state actually changes, so a run that starts moving is followed closely
 *   again.
 *
 * Progress is rendered exactly as the provider reports it. `progress` is null
 * for every fal run, so the indeterminate indicator is the common path — see
 * `RunProgress`. Nothing here interpolates a percentage from elapsed time.
 */

/** Poll floor. Fast enough that a submit feels acknowledged. */
const MIN_DELAY_MS = 2_000;
/** Poll ceiling, for a run that has been quiet for a while. */
const MAX_DELAY_MS = 10_000;
/** Growth per quiet poll. 1.35 reaches the ceiling in about six polls. */
const BACKOFF_FACTOR = 1.35;

export function GenerationQueue({
  /** Server-rendered seed, so the first paint is not empty while the first poll runs. */
  initial,
  /**
   * Bumped by the studio form each time a generation is accepted.
   *
   * Needed because an empty queue does not poll: without a nudge, the run a user
   * just started would not appear until something else woke the loop up.
   */
  refreshToken = 0,
  className,
}: {
  initial: readonly GenerationStatus[];
  refreshToken?: number;
  className?: string;
}) {
  const router = useRouter();
  const [runs, setRuns] = useState<readonly GenerationStatus[]>(initial);
  const [hidden, setHidden] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const delay = useRef(MIN_DELAY_MS);
  const seenToken = useRef(refreshToken);
  const previous = useRef<readonly GenerationStatus[]>(initial);

  // A fresh server render — after `router.refresh()` or a navigation — is more
  // authoritative than the last poll, so it replaces local state rather than
  // being merged with it.
  //
  // Adjusted during render against the previous prop rather than in an effect.
  // React documents this as the way to reset state when a prop changes: the
  // effect version renders the stale list once, then immediately renders again,
  // which is both slower and briefly wrong.
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setRuns(initial);
  }

  // The comparison baseline follows what was last committed, and it is written
  // in an effect rather than during render: a ref mutated mid-render is read by
  // the next render before React has decided that render is the one it keeps.
  useEffect(() => {
    previous.current = runs;
  }, [runs]);

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /**
   * Applies a poll result.
   *
   * A run that has left the active set has reached a terminal state, which is
   * the one moment the server-rendered history below is out of date — so that
   * is the only thing that triggers a refresh. Refreshing on every poll would
   * re-run every query on the page every two seconds.
   */
  const apply = useCallback(
    (next: readonly GenerationStatus[]) => {
      const before = previous.current;
      const beforeIds = new Set(before.map((run) => run.runId));
      const afterIds = new Set(next.map((run) => run.runId));

      const settled = before.filter((run) => !afterIds.has(run.runId));
      const started = next.filter((run) => !beforeIds.has(run.runId));
      const moved = next.some((run) => {
        const match = before.find((entry) => entry.runId === run.runId);
        return match ? match.state !== run.state || match.progress !== run.progress : false;
      });

      if (settled.length > 0 || started.length > 0 || moved) {
        delay.current = MIN_DELAY_MS;
      }

      if (settled.length > 0) {
        setAnnouncement(
          settled.length === 1
            ? "One generation finished. The results below have been updated."
            : `${settled.length} generations finished. The results below have been updated.`,
        );
        router.refresh();
      } else if (started.length > 0) {
        setAnnouncement(
          next.length === 1 ? "One generation running." : `${next.length} generations running.`,
        );
      }

      previous.current = next;
      setRuns(next);
    },
    [router],
  );

  const active = runs.length > 0;

  useEffect(() => {
    if (hidden) return;

    const nudged = refreshToken !== seenToken.current;
    if (!active && !nudged) return;
    seenToken.current = refreshToken;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    delay.current = MIN_DELAY_MS;

    const tick = async () => {
      const result = await readActiveGenerationsAction();
      if (cancelled) return;
      // A refusal here is a permission or session problem, not a queue state.
      // Dropping it silently is deliberate: the poll is ambient, and a banner
      // that appears on its own two seconds after the page settled would be
      // read as a failure of whatever the user last did.
      if (result.ok) apply(result.data);
      if (cancelled) return;
      timer = setTimeout(() => void tick(), delay.current);
      delay.current = Math.min(MAX_DELAY_MS, Math.round(delay.current * BACKOFF_FACTOR));
    };

    if (nudged) {
      void tick();
    } else {
      timer = setTimeout(() => void tick(), delay.current);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, hidden, refreshToken, apply]);

  return (
    <div className={className}>
      {/* One polite region for the whole queue. Assertive would interrupt a
          user mid-sentence in the prompt field for a status change they did
          not ask to be told about right now. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {runs.length === 0 ? (
        <EmptyState
          bare
          icon={<Activity size={20} strokeWidth={1.75} />}
          title={generateCopy.queueEmptyTitle}
          body={generateCopy.queueEmptyBody}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-[var(--space-3)]">
            {runs.map((run) => (
              <li
                key={run.runId}
                className={cn(
                  "rounded-[var(--radius-control)] border border-[var(--border-subtle)]",
                  "bg-[var(--surface-secondary)] p-[var(--space-4)]",
                  "motion-safe:animate-[virally-app-pop-in_var(--dur-base)_var(--ease-enter)_backwards]",
                )}
              >
                <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                  <RunStateChip state={run.state} />
                  {run.isMock && <DemoChip label={DEMO_OUTPUT_LABEL} />}
                  <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                    {Math.max(1, centsToCredits(run.estimatedCents)).toLocaleString("en-US")}{" "}
                    {generateCopy.costUnit} reserved
                  </span>
                </div>

                <p className="mt-[var(--space-2)] truncate text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
                  {run.prompt.length > 0 ? run.prompt : run.model}
                </p>

                <RunProgress
                  progress={run.progress}
                  label={`${run.model} generation`}
                  className="mt-[var(--space-3)]"
                />
              </li>
            ))}
          </ul>

          <p className="mt-[var(--space-3)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {generateCopy.queuePausedNote}
          </p>
        </>
      )}
    </div>
  );
}
