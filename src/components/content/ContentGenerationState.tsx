"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, Clock3, LoaderCircle, TriangleAlert } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { Button } from "@/components/primitives/Button";
import {
  generateQuickContent,
  retryQuickContentGeneration,
} from "@/lib/content/quickContent";

export type ContentGenerationStatus =
  | "planned"
  | "queued"
  | "generating"
  | "rendering"
  | "ready"
  | "failed"
  | "cancelled";

export type GenerationJobView = {
  id: string;
  type: string;
  status: string;
  progress: number;
  provider: string | null;
  model: string | null;
  capability: string | null;
  failureCode: string | null;
  failureMessage: string | null;
};

type Props = {
  contentId: string;
  title: string;
  status: Exclude<ContentGenerationStatus, "ready">;
  startedAt: string | null;
  initialElapsedSeconds: number;
  estimatedCredits: number;
  completedVisuals: number;
  totalVisuals: number;
  voiceRequired: boolean;
  voiceComplete: boolean;
  musicRequired: boolean;
  musicComplete: boolean;
  jobs: readonly GenerationJobView[];
  error: { code: string | null; message: string | null; stage: string | null };
};

const ACTIVE = new Set<ContentGenerationStatus>(["queued", "generating", "rendering"]);

type LiveState = {
  status: Props["status"];
  completedVisuals: number;
  totalVisuals: number;
  voiceComplete: boolean;
  musicComplete: boolean;
  jobs: readonly GenerationJobView[];
  error: Props["error"];
};

function liveStateFrom(props: Props): LiveState {
  return {
    status: props.status,
    completedVisuals: props.completedVisuals,
    totalVisuals: props.totalVisuals,
    voiceComplete: props.voiceComplete,
    musicComplete: props.musicComplete,
    jobs: props.jobs,
    error: props.error,
  };
}

export function ContentGenerationState(props: Props) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(props.initialElapsedSeconds);
  const [pending, startTransition] = useTransition();
  // Seeded from the server-rendered props, then kept current by polling a
  // lightweight status endpoint (see route.ts) instead of `router.refresh()`
  // — which re-runs the whole server component, including a tenant
  // resolution and every query the finished editor needs, for a page the
  // browser hits every couple of seconds while generation is active.
  const [live, setLive] = useState<LiveState>(() => liveStateFrom(props));
  // Tracks which render of `props` `live` was last derived from. A fresh
  // `props` object means the server component actually re-ran — a user
  // action's `router.refresh()`, or the one triggered below when polling
  // observes a status the "generating" screen no longer covers — and this
  // component must adopt it rather than keep rendering stale poll data over
  // a newer server render. Adjusted during render, not in an effect: this is
  // "derived state," and setState from an effect for it only adds a
  // redundant extra render (https://react.dev/learn/you-might-not-need-an-effect).
  const [syncedWith, setSyncedWith] = useState(props);
  if (syncedWith !== props) {
    setSyncedWith(props);
    setLive(liveStateFrom(props));
  }

  useEffect(() => {
    if (!ACTIVE.has(live.status)) return;
    let delay = 2_500;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = () => {
      timer = setTimeout(async () => {
        if (stopped) return;
        if (document.visibilityState === "hidden") {
          delay = Math.min(10_000, delay * 1.5);
          poll();
          return;
        }
        try {
          const response = await fetch(`/api/content/${props.contentId}/generation-status`, {
            cache: "no-store",
          });
          if (response.ok) {
            const data = (await response.json()) as {
              status: ContentGenerationStatus;
              completedVisuals: number;
              totalVisuals: number;
              voiceComplete: boolean;
              musicComplete: boolean;
              jobs: readonly GenerationJobView[];
              error: Props["error"];
            };
            if (!ACTIVE.has(data.status)) {
              // Ready, failed or cancelled — a different screen entirely
              // (the editor, or an error card with retry wiring this
              // component does not own). One full refresh reconciles it.
              router.refresh();
            } else if (!stopped) {
              setLive({
                // Safe: ACTIVE excludes "ready", so this is exactly LiveState's type.
                status: data.status as LiveState["status"],
                completedVisuals: data.completedVisuals,
                totalVisuals: data.totalVisuals,
                voiceComplete: data.voiceComplete,
                musicComplete: data.musicComplete,
                jobs: data.jobs,
                error: data.error,
              });
            }
          }
        } catch {
          // Transient network error. The loop keeps going and the next tick
          // recovers — no different from a single dropped poll today.
        }
        delay = Math.min(8_000, delay * 1.35);
        poll();
      }, delay);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [live.status, router, props.contentId]);

  useEffect(() => {
    if (!ACTIVE.has(live.status)) return;
    const timer = setInterval(() => setElapsedSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [live.status]);

  const provider = live.jobs.find((job) => job.provider)?.provider ?? null;
  const model = live.jobs.find((job) => job.model)?.model ?? null;
  const completedJobs = live.jobs.filter((job) => job.status === "completed").length;
  const elapsed = elapsedLabel(props.startedAt, elapsedSeconds);
  const steps = buildSteps({ ...props, ...live });

  function runAction(kind: "generate" | "retry") {
    setActionError(null);
    startTransition(async () => {
      const result =
        kind === "generate"
          ? await generateQuickContent(props.contentId)
          : await retryQuickContentGeneration(props.contentId);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const failedJob = [...live.jobs].reverse().find((job) =>
    ["failed", "dead_letter", "cancelled"].includes(job.status),
  );
  const errorMessage = live.error.message ?? failedJob?.failureMessage ?? "The generation could not be completed.";
  const errorCode = live.error.code ?? failedJob?.failureCode ?? "UNKNOWN_ERROR";
  const errorStage = live.error.stage ?? failedJob?.capability ?? stageLabel(failedJob?.type ?? null);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-[var(--app-panel-gap)] py-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <Link href="/app/content" className="text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]">
            ← Content
          </Link>
          <h1 className="mt-[var(--space-3)] truncate text-[length:var(--text-app-title)] font-[var(--weight-heading)] text-[color:var(--text-primary)]">
            {props.title}
          </h1>
        </div>
      </div>

      {live.status === "failed" ? (
        <Card className="border-[var(--danger-mark)]">
          <CardHeader as="h2" divided title="Content generation failed" />
          <CardBody className="flex flex-col gap-[var(--space-5)]">
            <div className="flex items-start gap-[var(--space-3)]">
              <TriangleAlert aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-[color:var(--danger)]" />
              <p className="max-w-[70ch] text-[length:var(--text-app-body)] text-[color:var(--text-primary)]">{errorMessage}</p>
            </div>
            <dl className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Stage" value={humanise(errorStage)} />
              <Fact label="Provider" value={provider ?? "Not submitted"} />
              <Fact label="Model" value={model ?? "Not selected"} />
              <Fact label="Error code" value={errorCode} />
            </dl>
            <AssetProgress completed={live.completedVisuals} total={live.totalVisuals} />
            <div className="flex flex-wrap gap-[var(--space-3)]">
              <Button onClick={() => runAction("retry")} disabled={pending}>
                {pending ? "Retrying…" : "Retry failed step"}
              </Button>
              <Link href="/app/create" className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-[var(--border-default)] px-[var(--space-3)] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
                Edit plan
              </Link>
            </div>
            {actionError && <p role="alert" className="text-[length:var(--text-app-cell)] text-[color:var(--danger)]">{actionError}</p>}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            as="h2"
            divided
            title={live.status === "planned" ? "Content plan ready" : "Generating your content"}
            action={ACTIVE.has(live.status) ? <LoaderCircle aria-hidden="true" size={17} className="animate-spin text-[color:var(--accent)]" /> : null}
          />
          <CardBody className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div>
              <ol className="flex flex-col gap-[var(--space-3)]">
                {steps.map((step) => (
                  <li key={step.label} className="flex items-center gap-[var(--space-3)] text-[length:var(--text-app-cell)]">
                    <StepIcon state={step.state} />
                    <span className={step.state === "pending" ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-primary)]"}>{step.label}</span>
                  </li>
                ))}
              </ol>
              {live.status === "planned" && (
                <div className="mt-[var(--space-6)]">
                  <Button onClick={() => runAction("generate")} disabled={pending}>
                    {pending ? "Starting…" : "Generate content"}
                  </Button>
                </div>
              )}
              {actionError && <p role="alert" className="mt-[var(--space-3)] text-[length:var(--text-app-cell)] text-[color:var(--danger)]">{actionError}</p>}
            </div>
            <dl className="grid content-start gap-[var(--space-4)] border-t border-[var(--border-subtle)] pt-[var(--space-5)] lg:border-l lg:border-t-0 lg:pl-[var(--space-6)] lg:pt-0">
              <Fact label="Current stage" value={currentStageLabel(live.status)} />
              <Fact label="Provider" value={provider ?? (live.status === "planned" ? "Selected at submission" : "Waiting for worker")} />
              <Fact label="Model" value={model ?? "—"} />
              <Fact label="Elapsed" value={elapsed} icon={<Clock3 aria-hidden="true" size={13} />} />
              <Fact label="Assets" value={`${completedJobs} of ${live.jobs.length} jobs complete`} />
              <Fact label="Production Credits reserved" value={String(props.estimatedCredits)} />
            </dl>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function buildSteps(props: Props) {
  const visualState: "complete" | "active" | "pending" =
    props.completedVisuals >= props.totalVisuals && props.totalVisuals > 0
      ? "complete"
      : props.status === "generating"
        ? "active"
        : "pending";
  return [
    { label: "Planning", state: "complete" as const },
    { label: "Script", state: "complete" as const },
    { label: `Generating visuals · ${props.completedVisuals} of ${props.totalVisuals}`, state: visualState },
    ...(props.voiceRequired ? [{ label: "Voiceover", state: props.voiceComplete ? "complete" as const : props.status === "generating" ? "active" as const : "pending" as const }] : []),
    ...(props.musicRequired ? [{ label: "Music", state: props.musicComplete ? "complete" as const : props.status === "generating" ? "active" as const : "pending" as const }] : []),
    { label: "Building composition", state: props.status === "rendering" ? "complete" as const : "pending" as const },
    { label: "Rendering", state: props.status === "rendering" ? "active" as const : "pending" as const },
    { label: "Finalizing", state: "pending" as const },
  ];
}

function StepIcon({ state }: { state: "complete" | "active" | "pending" }) {
  if (state === "complete") return <span className="flex size-5 items-center justify-center rounded-full bg-[var(--success-soft)] text-[color:var(--success)]"><Check aria-hidden="true" size={13} /></span>;
  if (state === "active") return <span className="flex size-5 items-center justify-center"><LoaderCircle aria-hidden="true" size={17} className="animate-spin text-[color:var(--accent)]" /></span>;
  return <span className="flex size-5 items-center justify-center"><Circle aria-hidden="true" size={14} className="text-[color:var(--text-muted)]" /></span>;
}

function Fact({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return <div><dt className="flex items-center gap-1.5 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">{icon}{label}</dt><dd className="mt-1 break-words text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">{value}</dd></div>;
}

function AssetProgress({ completed, total }: { completed: number; total: number }) {
  return <p className="text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">Successful visuals preserved: <span className="font-[var(--weight-strong)] text-[color:var(--text-primary)]">{completed} of {total}</span></p>;
}

function elapsedLabel(startedAt: string | null, seconds: number): string {
  if (!startedAt) return "Not started";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function currentStageLabel(status: Props["status"]): string {
  if (status === "planned") return "Plan review";
  if (status === "queued") return "Queued";
  if (status === "generating") return "Generating assets";
  if (status === "rendering") return "Rendering final media";
  if (status === "failed") return "Failed";
  return "Cancelled";
}

function stageLabel(type: string | null): string {
  if (type === "content.render") return "rendering";
  if (type?.includes("video")) return "AI video generation";
  if (type?.includes("image")) return "AI image generation";
  if (type?.includes("voice")) return "voice generation";
  return "generation";
}

function humanise(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}
