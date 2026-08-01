"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { AspectRatio } from "@/types/database";
import {
  quantiseDuration,
  requiresConsent,
  type GenerationCapability,
  type GenerationModel,
} from "@/lib/creative/capabilities";
import { DEFAULT_PRODUCTION_MODE, PRODUCTION_MODE_DEFAULTS, centsToCredits } from "@/lib/creative/modes";
import type { ProductionMode } from "@/lib/creative/types";
import { startGenerationAction } from "@/lib/generation/actions";
import { cn } from "@/lib/cn";
import { Button } from "@/components/primitives/Button";
import { CAPABILITY_LABELS, generateCopy, type StudioDefinition } from "@/content/generate";
import { GenerationSummary } from "./GenerationSummary";
import { ModelPicker, creditsPerUnit, rememberRecentModel } from "./ModelPicker";
import { ReferenceUploader, type ReferenceAsset } from "./ReferenceUploader";
import { ConsentGate } from "./ConsentGate";
import { Field, controlClasses, controlHeight } from "./fields";
import type { ProviderStatus } from "./ProviderBanner";

/**
 * The prompt composer and its controls.
 *
 * Every prop is DATA — the model catalogue, the production modes, the balance,
 * the library. None of them is behaviour, so a second surface that needs a
 * composer (a campaign shot, an editor panel) supplies its own rows and gets the
 * same form rather than passing in a different submit function that quietly does
 * something else.
 *
 * The one exception is `onStarted`, which nudges the queue beside it. That is
 * composition, not policy: the queue does not poll while it is empty, so without
 * a nudge the run a user just started would not appear until something else woke
 * the loop.
 *
 * The cost figure here is computed with the same arithmetic the provider uses —
 * `estimatedCentsPerUnit` × units, through `centsToCredits`, with the same
 * per-clip quantisation. It is an estimate and it is labelled as one: the server
 * recomputes from the model that actually runs, and its figure is the one
 * charged.
 */

/** Offered when the chosen model does not constrain the format. */
const DEFAULT_RATIOS: readonly AspectRatio[] = ["9:16", "1:1", "16:9", "4:5"];

/** What one unit of output is, per studio. Priced per clip, per track, per image. */
const UNIT_LABELS: Readonly<Record<"image" | "video" | "audio", string>> = {
  image: "per image",
  video: "per clip",
  audio: "per track",
};

/** The first unmet precondition, or null when the request can be submitted. */
function firstBlocker(checks: readonly (readonly [boolean, string])[]): string | null {
  return checks.find(([failed]) => failed)?.[1] ?? null;
}

export function StudioForm({
  studio,
  models,
  available,
  references,
  providers,
  canGenerate,
  onStarted,
}: {
  studio: StudioDefinition;
  /** Already narrowed to this studio's capabilities on the server. */
  models: readonly GenerationModel[];
  /** Production Credits currently available to the workspace. */
  available: number;
  references: readonly ReferenceAsset[];
  providers: readonly ProviderStatus[];
  canGenerate: boolean;
  onStarted: () => void;
}) {
  const baseId = useId();
  const [pending, startTransition] = useTransition();

  const [capability, setCapability] = useState<GenerationCapability>(studio.capabilities[0]!);
  const [mode, setMode] = useState<ProductionMode>(DEFAULT_PRODUCTION_MODE);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [modelId, setModelId] = useState<string | null>(null);
  const [ratio, setRatio] = useState<AspectRatio | "">("");
  const [resolution, setResolution] = useState("");
  const [duration, setDuration] = useState(5);
  const [slots, setSlots] = useState<readonly (string | null)[]>([]);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentNote, setConsentNote] = useState("");

  const [refusal, setRefusal] = useState<{ kind: string; message: string; shortfall?: number } | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);

  /**
   * Held across attempts so a double-submit is one generation, and cleared once
   * a generation is accepted so the next press is a new one.
   */
  const attemptKey = useRef<string | null>(null);

  const candidates = useMemo(
    () =>
      models.filter(
        (model) => model.capabilities.includes(capability) && model.modes.includes(mode),
      ),
    [models, capability, mode],
  );

  // Mirrors the router: cheapest routable candidate. Only a floor, because the
  // router decides at submit time against the live catalogue.
  const cheapest = useMemo(
    () =>
      [...candidates].sort((a, b) => creditsPerUnit(a) - creditsPerUnit(b))[0] ?? null,
    [candidates],
  );

  const pinned = modelId === null ? null : candidates.find((model) => model.id === modelId) ?? null;
  const effective = pinned ?? cheapest;

  const ratios = effective && effective.supportedAspectRatios.length > 0
    ? effective.supportedAspectRatios
    : DEFAULT_RATIOS;
  const resolutions = effective?.supportedResolutions ?? [];
  const durations = effective?.supportedDurations ?? [];
  const referenceSlots = effective?.maxReferenceImages ?? 0;

  const chosenRatio: AspectRatio = ratios.includes(ratio as AspectRatio)
    ? (ratio as AspectRatio)
    : ratios[0]!;
  const chosenResolution = resolutions.includes(resolution) ? resolution : resolutions[0] ?? "";

  /**
   * Units this request bills for.
   *
   * Video is priced per clip and a long shot needs several, so quoting one
   * clip's price for a 30s request would under-quote by a factor of three —
   * exactly the mistake the provider's own estimator documents.
   */
  const units = useMemo(() => {
    if (studio.generationType !== "video" || !effective) return 1;
    const perClip = quantiseDuration(effective, duration);
    return Math.max(1, Math.ceil(duration / perClip));
  }, [studio.generationType, effective, duration]);

  const credits = effective
    ? Math.max(1, centsToCredits((effective.estimatedCentsPerUnit ?? 0) * units))
    : null;

  const promptRequired = capability !== "lip-sync" && capability !== "upscale";
  const consentNeeded = requiresConsent(capability);
  const configured = providers.some((provider) => provider.configured);

  const formatLabel = [
    chosenRatio,
    chosenResolution || null,
    studio.generationType === "video" || studio.generationType === "audio"
      ? `${duration}s`
      : null,
    units > 1 ? `${units} clips` : null,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(" · ");

  // Why the button cannot be pressed, in the order the user should fix them.
  // A reason, not a boolean: a disabled control that does not say why is a dead
  // end, and this string is rendered under the button.
  const blocked = firstBlocker([
    [!canGenerate, "Your role does not include creating content in this workspace."],
    [!configured, "No generation provider is configured, so nothing can be submitted yet."],
    [promptRequired && prompt.trim().length === 0, "Write a prompt first."],
    [consentNeeded && !consentConfirmed, "Confirm the likeness and voice permission first."],
  ]);

  const submit = () => {
    setRefusal(null);
    setNotice(null);
    attemptKey.current ??= crypto.randomUUID();

    // Trimmed to what the chosen model accepts. A slot filled under a model
    // that took three references and then left behind by a switch to one that
    // takes two would otherwise be submitted and rejected by `checkModelFit`.
    const referenceAssetIds = slots
      .slice(0, referenceSlots)
      .filter((entry): entry is string => entry !== null);

    startTransition(async () => {
      const result = await startGenerationAction({
        capability,
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        mode,
        ratio: chosenRatio,
        resolution: chosenResolution || undefined,
        durationSeconds:
          studio.generationType === "image" ? undefined : duration,
        referenceAssetIds,
        modelId,
        idempotencyKey: attemptKey.current ?? undefined,
        consentConfirmed: consentNeeded ? consentConfirmed : undefined,
        consentNote: consentNeeded && consentNote.trim() ? consentNote.trim() : undefined,
      });

      if (!result.ok) {
        setRefusal({ kind: result.kind ?? "unknown", message: result.error, shortfall: result.shortfall });
        return;
      }

      attemptKey.current = null;
      if (modelId) rememberRecentModel(modelId);

      const outcome = result.data;
      if (outcome.status === "started") {
        setNotice({
          title: generateCopy.startedTitle,
          body: `${outcome.estimatedCredits.toLocaleString("en-US")} ${generateCopy.costUnit} reserved on ${outcome.model?.name ?? outcome.providerId}. ${generateCopy.startedBody}`,
        });
      } else {
        // `already_started`. The action maps every refusal to `ok: false`, so a
        // successful result is one of exactly these two states — the compiler
        // agrees, which is why there is no third branch to write.
        setNotice({
          title: generateCopy.alreadyStartedTitle,
          body: generateCopy.alreadyStartedBody,
        });
      }
      onStarted();
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (blocked || pending) return;
        submit();
      }}
      className="grid gap-[var(--app-panel-gap)] xl:grid-cols-[minmax(0,1fr)_21rem]"
    >
      <div className="flex min-w-0 flex-col gap-[var(--app-panel-gap)]">
        <div
          className={cn(
            "rounded-[var(--radius-card)] border border-[var(--border-default)]",
            "bg-[var(--surface-primary)] p-[var(--app-panel-pad)] shadow-[var(--elevation-card)]",
          )}
        >
          {/* Not the studio's own name again: the page `<h1>` already says
              which studio this is, and a card repeating it teaches nothing. */}
          <h2 className="app-card-title text-[color:var(--text-primary)]">
            {generateCopy.composerTitle}
          </h2>

          {studio.caveat && (
            <p
              className={cn(
                "mt-[var(--space-3)] rounded-[var(--radius-control)] border border-[var(--info-mark)]",
                "bg-[var(--info-soft)] p-[var(--space-3)]",
                "text-[length:var(--text-app-meta)] text-[color:var(--text-primary)]",
              )}
            >
              <Info
                aria-hidden="true"
                size={14}
                strokeWidth={2}
                className="mr-1.5 inline align-[-2px] text-[color:var(--info)]"
              />
              {studio.caveat}
            </p>
          )}

          {studio.capabilities.length > 1 && (
            <Field
              label={generateCopy.capabilityLabel}
              htmlFor={`${baseId}-capability`}
              className="mt-[var(--space-4)]"
            >
              <select
                id={`${baseId}-capability`}
                value={capability}
                onChange={(event) => {
                  setCapability(event.target.value as GenerationCapability);
                  // A pin that does not survive the new capability is dropped
                  // rather than carried into a request the model cannot serve.
                  setModelId(null);
                }}
                className={cn(controlClasses, controlHeight)}
              >
                {studio.capabilities.map((entry) => (
                  <option key={entry} value={entry}>
                    {CAPABILITY_LABELS[entry]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label={generateCopy.promptLabel}
            htmlFor={`${baseId}-prompt`}
            hint={studio.promptHint}
            className="mt-[var(--space-4)]"
          >
            <textarea
              id={`${baseId}-prompt`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              maxLength={5_000}
              required={promptRequired}
              aria-describedby={`${baseId}-prompt-hint`}
              placeholder={studio.promptPlaceholder}
              className={cn(controlClasses, "py-[var(--space-2)] leading-6")}
            />
          </Field>

          {effective?.supportsNegativePrompt && (
            <Field
              label={generateCopy.negativeLabel}
              htmlFor={`${baseId}-negative`}
              hint={generateCopy.negativeHint}
              className="mt-[var(--space-4)]"
            >
              <input
                id={`${baseId}-negative`}
                type="text"
                value={negativePrompt}
                maxLength={2_000}
                onChange={(event) => setNegativePrompt(event.target.value)}
                aria-describedby={`${baseId}-negative-hint`}
                className={cn(controlClasses, controlHeight)}
              />
            </Field>
          )}

          <div className="mt-[var(--space-4)] grid gap-[var(--space-4)] sm:grid-cols-2">
            <Field
              label={generateCopy.modeLabel}
              htmlFor={`${baseId}-mode`}
              hint={generateCopy.modeHint}
            >
              <select
                id={`${baseId}-mode`}
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as ProductionMode);
                  setModelId(null);
                }}
                aria-describedby={`${baseId}-mode-hint`}
                className={cn(controlClasses, controlHeight)}
              >
                {PRODUCTION_MODE_DEFAULTS.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={generateCopy.ratioLabel} htmlFor={`${baseId}-ratio`}>
              <select
                id={`${baseId}-ratio`}
                value={chosenRatio}
                onChange={(event) => setRatio(event.target.value as AspectRatio)}
                className={cn(controlClasses, controlHeight)}
              >
                {ratios.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>

            {resolutions.length > 0 && (
              <Field label={generateCopy.resolutionLabel} htmlFor={`${baseId}-resolution`}>
                <select
                  id={`${baseId}-resolution`}
                  value={chosenResolution}
                  onChange={(event) => setResolution(event.target.value)}
                  className={cn(controlClasses, controlHeight)}
                >
                  {resolutions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {studio.generationType !== "image" && (
              <Field
                label={`${generateCopy.durationLabel} (${generateCopy.durationUnit})`}
                htmlFor={`${baseId}-duration`}
                hint={
                  durations.length > 0
                    ? `This model produces ${durations.join("s or ")}s per clip.`
                    : undefined
                }
              >
                <input
                  id={`${baseId}-duration`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  step={1}
                  value={duration}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setDuration(Number.isFinite(parsed) ? Math.min(120, Math.max(1, parsed)) : 1);
                  }}
                  aria-describedby={durations.length > 0 ? `${baseId}-duration-hint` : undefined}
                  className={cn(controlClasses, controlHeight, "app-figure")}
                />
              </Field>
            )}
          </div>

          <ModelPicker
            models={candidates}
            value={modelId}
            onChange={setModelId}
            unitLabel={UNIT_LABELS[studio.generationType]}
            className="mt-[var(--space-4)]"
          />

          <ReferenceUploader
            slots={referenceSlots}
            assets={references}
            value={slots}
            onChange={setSlots}
            className="mt-[var(--space-5)]"
          />

          {consentNeeded && (
            <ConsentGate
              confirmed={consentConfirmed}
              note={consentNote}
              onConfirmedChange={setConsentConfirmed}
              onNoteChange={setConsentNote}
              highlighted={refusal?.kind === "consent"}
              message={refusal?.kind === "consent" ? refusal.message : undefined}
              className="mt-[var(--space-5)]"
            />
          )}
        </div>

        {/* One polite region for the outcome of a submit. Assertive would cut
            across a screen reader mid-word for something the user just did and
            is already waiting on. */}
        <div aria-live="polite" className="flex flex-col gap-[var(--app-panel-gap)]">
          {notice && <Notice title={notice.title} body={notice.body} />}
          {refusal && refusal.kind !== "consent" && (
            <Refusal
              kind={refusal.kind}
              message={refusal.message}
              shortfall={refusal.shortfall}
              providers={providers}
              onRetry={pending ? undefined : submit}
            />
          )}
        </div>
      </div>

      <GenerationSummary
        providerLabel={effective?.providerId ?? generateCopy.automaticLabel}
        modelLabel={pinned?.name ?? (cheapest ? `${generateCopy.automaticLabel} — ${cheapest.name}` : generateCopy.automaticLabel)}
        formatLabel={formatLabel}
        credits={credits}
        isFloor={pinned === null}
        available={available}
        pending={pending}
        disabled={Boolean(blocked) || pending}
        disabledReason={blocked ?? undefined}
        className="xl:sticky xl:top-[calc(var(--app-topbar-height)+var(--space-6))] xl:self-start"
      />
    </form>
  );
}

/** A successful submit. Quiet — the queue below is the real feedback. */
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-[var(--space-3)] rounded-[var(--radius-card)]",
        "border border-[var(--success-mark)] bg-[var(--success-soft)] p-[var(--app-panel-pad)]",
      )}
    >
      <CheckCircle2
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className="mt-0.5 shrink-0 text-[color:var(--success)]"
      />
      <div className="min-w-0">
        <p className="text-[length:var(--text-app-cell)] font-[var(--weight-heading)] text-[color:var(--success)]">
          {title}
        </p>
        <p className="mt-1 max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
          {body}
        </p>
      </div>
    </div>
  );
}

/**
 * A refusal, answered according to its kind.
 *
 * The five kinds are five different situations and they get five different
 * responses. Collapsing them into one red box with a Retry button is the failure
 * this switch exists to prevent: retrying a policy refusal cannot work, retrying
 * a credits refusal cannot work either, and a throttle is not an error at all.
 */
function Refusal({
  kind,
  message,
  shortfall,
  providers,
  onRetry,
}: {
  kind: string;
  message: string;
  shortfall?: number;
  providers: readonly ProviderStatus[];
  onRetry?: () => void;
}) {
  const titles = generateCopy.errorTitles;
  const title = kind in titles ? titles[kind as keyof typeof titles] : titles.unknown;

  // A throttle is the machine asking for a moment, not a failure — amber, not
  // red, and it keeps the retry.
  const warning = kind === "limit";
  const retryable = kind === "limit" || kind === "unknown";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border p-[var(--app-panel-pad)]",
        warning
          ? "border-[var(--warning-mark)] bg-[var(--warning-soft)]"
          : "border-[var(--error-mark)] bg-[var(--error-soft)]",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-[var(--space-2)] text-[length:var(--text-app-cell)] font-[var(--weight-heading)]",
          warning ? "text-[color:var(--warning)]" : "text-[color:var(--error)]",
        )}
      >
        {/* Icon plus text. An error is never carried by colour alone. */}
        {warning ? (
          <Info aria-hidden="true" size={15} strokeWidth={2} className="shrink-0" />
        ) : (
          <AlertCircle aria-hidden="true" size={15} strokeWidth={2} className="shrink-0" />
        )}
        {title}
      </p>

      <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
        {message}
      </p>

      <p className="mt-1 max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
        {generateCopy.errorReassurance}
      </p>

      {kind === "credits" && shortfall !== undefined && shortfall > 0 && (
        <p className="app-figure mt-[var(--space-2)] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
          {generateCopy.shortfallLabel(shortfall)}
        </p>
      )}

      {kind === "unavailable" && providers.length > 0 && (
        <ul className="mt-[var(--space-3)] flex flex-col gap-1">
          {providers.map((provider) => (
            <li
              key={provider.id}
              className="text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]"
            >
              {provider.label}: {provider.configured ? "configured" : "not configured"}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-2)]">
        {/* No retry on a policy refusal. Offering one invites a user to reword
            around the boundary, and the boundary is stated once without
            moralising. */}
        {retryable && onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            {generateCopy.retryLabel}
          </Button>
        )}
        {kind === "credits" && (
          <Link
            href="/app/usage"
            className={cn(
              "text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
              "rounded-[var(--radius-chip)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
            )}
          >
            {generateCopy.topUpLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
