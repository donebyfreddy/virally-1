"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Link2,
  Mic,
  Music,
  Paperclip,
  Upload,
} from "lucide-react";
import type { AspectRatio } from "@/types/database";
import { cn } from "@/lib/cn";
import { Button } from "@/components/primitives/Button";
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { ErrorState } from "@/components/app-ui/States";
import { FigureList, FigureRow, PanelNote } from "@/components/app-ui/Figures";
import { briefPanelCopy, quickContentCopy } from "@/content/create";
import { hintClasses, labelClasses, NumberField, SelectField, ToggleChip } from "./controls";
import { ProductionModePanel } from "./ProductionModePanel";
import { CreditPanel } from "./CreditPanel";
import { DEFAULT_PRODUCTION_MODE, PRODUCTION_MODE_DEFAULTS } from "@/lib/creative/modes";
import { compareToBalance, estimateBatch } from "@/lib/creative/estimator";
import type { ProductionMode } from "@/lib/creative/types";
import { generateQuickContent, planQuickContent } from "@/lib/content/quickContent";
import {
  findQuickContentType,
  findQuickPlatform,
  QUICK_CONTENT_TYPES,
  QUICK_DURATIONS,
  QUICK_PLATFORMS,
  QUICK_TONES,
  type QuickContentPlan,
} from "@/lib/content/quickContentTypes";

/**
 * The Quick Content composer.
 *
 * One content item, no campaign fields. Where the campaign composer has a
 * pinned plan column because sixteen fields need a running total beside them,
 * this form fits in one column and stays visible in full — the point of Quick
 * Content is that it is faster, and a second column here would be furniture,
 * not information.
 *
 * Two internal steps, not two pages: `form` gathers the brief and the shape,
 * `plan` shows what `planQuickContent` actually built (real title, real hook,
 * real structure) and asks for the one explicit confirmation before anything
 * billable runs. Kept as state in one component rather than a route change so
 * "Edit brief" does not lose what was typed.
 */

const RATIO_OPTIONS_ALL: readonly { id: AspectRatio; label: string }[] = [
  { id: "9:16", label: "9:16" },
  { id: "4:5", label: "4:5" },
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "custom", label: "Custom" },
];

export function QuickContentComposer({
  creditsAvailable,
  creditsReserved,
  unmetered,
}: {
  creditsAvailable: number;
  creditsReserved: number;
  unmetered: boolean;
}) {
  const router = useRouter();

  const [prompt, setPrompt] = useState("");
  const [contentTypeId, setContentTypeId] = useState<string>(QUICK_CONTENT_TYPES[0].id);
  const [platformId, setPlatformId] = useState<string>(QUICK_PLATFORMS[0].id);
  const [ratioOverride, setRatioOverride] = useState<AspectRatio | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [tone, setTone] = useState<string>(QUICK_TONES[0].id);
  const [mode, setMode] = useState<ProductionMode>(DEFAULT_PRODUCTION_MODE);
  const [withVoiceover, setWithVoiceover] = useState(true);
  const [withMusic, setWithMusic] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [plan, setPlan] = useState<QuickContentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const contentTypeDef = findQuickContentType(contentTypeId);
  const platformDef = findQuickPlatform(platformId);
  const ratio = ratioOverride ?? platformDef.ratio;
  const promptReady = prompt.trim().length >= 10;

  // Mirrors the null-safety `planQuickContent` applies server-side: a platform
  // with no Platform enum value still needs a non-empty list so the estimator's
  // `variants = items × platforms × ratios` multiplies by one, not by zero.
  const platformsForEstimate = useMemo(
    () => (platformDef.dbPlatform ? [platformDef.dbPlatform] : (["instagram"] as const)),
    [platformDef.dbPlatform],
  );
  const effectiveDuration = contentTypeDef.hasDuration ? durationSeconds : 5;

  const batchCredits = useMemo(() => {
    const entries = PRODUCTION_MODE_DEFAULTS.map(
      (definition) =>
        [
          definition.id,
          estimateBatch({
            mode: definition.id,
            concepts: 1,
            hooksPerConcept: 1,
            platforms: platformsForEstimate,
            ratios: [ratio],
            languages: ["en"],
            accountCount: 0,
            withVoiceover,
            withThumbnail: false,
            withMusic,
            durationSeconds: effectiveDuration,
            quality: "standard",
          }).credits,
        ] as const,
    );
    return Object.fromEntries(entries) as Record<ProductionMode, number>;
  }, [platformsForEstimate, ratio, withVoiceover, withMusic, effectiveDuration]);

  const modeEstimate = useMemo(
    () =>
      estimateBatch({
        mode,
        concepts: 1,
        hooksPerConcept: 1,
        platforms: platformsForEstimate,
        ratios: [ratio],
        languages: ["en"],
        accountCount: 0,
        withVoiceover,
        withThumbnail: false,
        withMusic,
        durationSeconds: effectiveDuration,
        quality: "standard",
      }),
    [mode, platformsForEstimate, ratio, withVoiceover, withMusic, effectiveDuration],
  );

  const comparison = useMemo(
    () => compareToBalance(modeEstimate, creditsAvailable),
    [modeEstimate, creditsAvailable],
  );
  const affordable = unmetered || comparison.affordable;
  const canPlan = promptReady && affordable && !pending;

  function handlePlan() {
    setError(null);
    startTransition(async () => {
      const result = await planQuickContent({
        prompt,
        contentTypeId,
        platformId,
        ratio: ratioOverride ?? undefined,
        durationSeconds: contentTypeDef.hasDuration ? durationSeconds : undefined,
        tone,
        productionMode: mode,
        withVoiceover,
        withMusic,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPlan(result.data);
    });
  }

  function handleGenerate() {
    if (!plan) return;
    setError(null);
    startTransition(async () => {
      const result = await generateQuickContent(plan.contentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Redirect even when some assets were refused: the ones that started
      // already reserved real credits, so landing back on this form would
      // hide them behind an error that reads as "nothing happened."
      const query = result.data.errors.length > 0 ? `?partialErrors=${result.data.errors.length}` : "";
      router.push(`/app/content/${result.data.contentId}${query}`);
    });
  }

  if (plan) {
    return (
      <QuickContentPlanReview
        plan={plan}
        pending={pending}
        error={error}
        unmetered={unmetered}
        onBack={() => {
          setPlan(null);
          setError(null);
        }}
        onGenerate={handleGenerate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[var(--app-panel-gap)]">
      <Card as="section" aria-labelledby="quick-brief-heading">
        <CardHeader id="quick-brief-heading" as="h2" title={quickContentCopy.promptLabel} />
        <CardBody className="flex flex-col gap-[var(--space-5)] pt-[var(--space-3)]">
          <div>
            {/* The card heading above already asks this question visually, so a
                second visible label would duplicate it — but the textarea still
                needs its own programmatic name rather than borrowing the
                section's via `aria-labelledby`, which names the landmark, not
                the control. */}
            <label htmlFor="quick-content-brief" className="sr-only">
              {quickContentCopy.promptLabel}
            </label>
            <textarea
              id="quick-content-brief"
              rows={4}
              value={prompt}
              maxLength={2000}
              onChange={(event) => setPrompt(event.target.value)}
              aria-describedby="quick-content-brief-hint"
              placeholder={quickContentCopy.promptPlaceholder}
              className={cn(
                "w-full resize-y rounded-[var(--radius-control)]",
                "border border-[var(--border-default)] bg-[var(--surface-primary)] p-[var(--space-3)]",
                "[font-family:inherit] text-[length:var(--text-app-body)] text-[color:var(--text-primary)]",
                "placeholder:text-[color:var(--text-muted)]",
                "transition-colors duration-[var(--dur-instant)]",
                "hover:border-[var(--border-strong)]",
                "focus:border-[var(--brand-primary)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--focus-ring)]",
              )}
            />
            <p id="quick-content-brief-hint" className={cn("mt-[var(--space-2)]", hintClasses)}>
              {quickContentCopy.promptHint}
            </p>
          </div>

          {/* Same honest, disabled-with-a-reason treatment as the campaign
              composer's source row — these sources are not accepted by either
              form yet. */}
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <DisabledSourceButton icon={<Paperclip size={14} strokeWidth={1.75} />}>
              {briefPanelCopy.uploadLabel}
            </DisabledSourceButton>
            <DisabledSourceButton icon={<Upload size={14} strokeWidth={1.75} />}>
              Upload video
            </DisabledSourceButton>
            <DisabledSourceButton icon={<Link2 size={14} strokeWidth={1.75} />}>
              {briefPanelCopy.urlLabel}
            </DisabledSourceButton>
          </div>

          <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
            <SelectField
              label={quickContentCopy.contentTypeLabel}
              value={contentTypeId}
              onChange={setContentTypeId}
              options={QUICK_CONTENT_TYPES}
            />
            <SelectField
              label={quickContentCopy.platformLabel}
              value={platformId}
              onChange={(next) => {
                setPlatformId(next);
                // A new platform's default ratio wins until the user overrides
                // it again — matches "always show the inferred values so the
                // user can change them" rather than sticking to a stale format.
                setRatioOverride(null);
              }}
              options={QUICK_PLATFORMS}
            />
          </div>

          <fieldset className="min-w-0 border-0 p-0">
            <legend className={labelClasses}>{quickContentCopy.formatLabel}</legend>
            <p className={cn("mt-1", hintClasses)}>{quickContentCopy.formatHint}</p>
            <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
              {RATIO_OPTIONS_ALL.map((option) => (
                <ToggleChip
                  key={option.id}
                  label={option.label}
                  selected={ratio === option.id}
                  onToggle={() => setRatioOverride(option.id)}
                />
              ))}
            </div>
          </fieldset>

          {contentTypeDef.hasDuration && (
            <fieldset className="min-w-0 border-0 p-0">
              <legend className={labelClasses}>{quickContentCopy.durationLabel}</legend>
              <div className="mt-[var(--space-2)] flex flex-wrap items-center gap-[var(--space-2)]">
                {QUICK_DURATIONS.map((seconds) => (
                  <ToggleChip
                    key={seconds}
                    label={`${seconds}s`}
                    selected={durationSeconds === seconds}
                    onToggle={() => setDurationSeconds(seconds)}
                  />
                ))}
                <div className="w-24">
                  <NumberField
                    label="Custom"
                    value={durationSeconds}
                    min={5}
                    max={120}
                    hint="Seconds"
                    onChange={setDurationSeconds}
                  />
                </div>
              </div>
            </fieldset>
          )}
        </CardBody>
      </Card>

      <button
        type="button"
        onClick={() => setAdvancedOpen((value) => !value)}
        aria-expanded={advancedOpen}
        aria-controls="quick-advanced-settings"
        className={cn(
          "flex min-h-11 items-center gap-[var(--space-2)] self-start rounded-[var(--radius-control)] px-[var(--space-2)]",
          "text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]",
          "transition-colors duration-[var(--dur-instant)] hover:text-[color:var(--text-primary)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          size={14}
          strokeWidth={2}
          className={cn("transition-transform duration-[var(--dur-instant)]", advancedOpen && "rotate-90")}
        />
        {quickContentCopy.advancedLabel}
      </button>

      {advancedOpen && (
        <div id="quick-advanced-settings" className="flex flex-col gap-[var(--app-panel-gap)]">
          <Card as="section" aria-labelledby="quick-tone-heading">
            <CardHeader id="quick-tone-heading" as="h2" title={quickContentCopy.toneLabel} />
            <CardBody className="grid gap-[var(--space-4)] pt-[var(--space-3)] sm:grid-cols-2">
              <SelectField label={quickContentCopy.toneLabel} value={tone} onChange={setTone} options={QUICK_TONES} />

              <fieldset className="min-w-0 border-0 p-0">
                <legend className={labelClasses}>{quickContentCopy.includeLabel}</legend>
                <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
                  <ToggleChip
                    label="Voiceover"
                    icon={<Mic size={14} strokeWidth={1.75} />}
                    selected={withVoiceover}
                    onToggle={() => setWithVoiceover((value) => !value)}
                  />
                  <ToggleChip
                    label="Music"
                    icon={<Music size={14} strokeWidth={1.75} />}
                    selected={withMusic}
                    onToggle={() => setWithMusic((value) => !value)}
                  />
                </div>
              </fieldset>
            </CardBody>
          </Card>

          <ProductionModePanel
            modes={PRODUCTION_MODE_DEFAULTS}
            selected={mode}
            onSelect={setMode}
            batchCredits={batchCredits}
            unmetered={unmetered}
          />
        </div>
      )}

      <CreditPanel comparison={comparison} reserved={creditsReserved} unmetered={unmetered} />

      {error && (
        <ErrorState
          title="Could not plan this content"
          body={error}
          reassurance="Nothing was generated and no credits were used."
        />
      )}

      <Button size="lg" disabled={!canPlan} onClick={handlePlan}>
        {pending ? "Planning…" : quickContentCopy.planSubmitLabel}
      </Button>
    </div>
  );
}

function DisabledSourceButton({ children, icon }: { children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled
      title={briefPanelCopy.sourcesHint}
      className={cn(
        "flex h-8 cursor-not-allowed items-center gap-[var(--space-2)]",
        "rounded-[var(--radius-control)] border border-[var(--border-default)] px-[var(--space-3)]",
        "text-[length:var(--text-app-cell)] text-[color:var(--text-muted)] opacity-70",
      )}
    >
      <span aria-hidden="true" className="shrink-0">
        {icon}
      </span>
      {children}
    </button>
  );
}

/** Step two: the plan `planQuickContent` actually built, and the paid confirm. */
function QuickContentPlanReview({
  plan,
  pending,
  error,
  unmetered,
  onBack,
  onGenerate,
}: {
  plan: QuickContentPlan;
  pending: boolean;
  error: string | null;
  unmetered: boolean;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const count = (value: number) => value.toLocaleString("en-US");

  return (
    <div className="flex flex-col gap-[var(--app-panel-gap)]">
      <Card as="section" aria-labelledby="quick-plan-heading">
        <CardHeader
          id="quick-plan-heading"
          as="h2"
          title={quickContentCopy.planHeading}
          description={`${plan.contentTypeLabel} · ${plan.ratio}${plan.durationSeconds ? ` · ${plan.durationSeconds}s` : ""}`}
        />
        <CardBody className="flex flex-col gap-[var(--space-5)] pt-[var(--space-3)]">
          <h3 className="app-card-title text-[color:var(--text-primary)]">{plan.title}</h3>

          <div>
            <p className={labelClasses}>{quickContentCopy.planHookLabel}</p>
            <p className="mt-1 text-[length:var(--text-app-body)] text-[color:var(--text-primary)]">
              &ldquo;{plan.hook}&rdquo;
            </p>
          </div>

          <div>
            <p className={labelClasses}>{quickContentCopy.planStructureLabel}</p>
            <ol className="mt-[var(--space-2)] flex flex-col gap-[var(--space-2)]">
              {plan.structure.map((row) => (
                <li
                  key={row.position}
                  className="flex gap-[var(--space-3)] rounded-[var(--radius-control)] bg-[var(--surface-secondary)] p-[var(--space-3)]"
                >
                  <span className="app-figure w-16 shrink-0 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                    {Math.round(row.startMs / 1000)}–{Math.round(row.endMs / 1000)}s
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[length:var(--text-app-label)] font-[var(--weight-strong)] uppercase tracking-wide text-[color:var(--text-muted)]">
                      {row.role}
                    </span>
                    <span className="text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
                      {row.text}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className={labelClasses}>{quickContentCopy.planAssetsLabel}</p>
            <FigureList>
              {plan.assets.generatedImages > 0 && (
                <FigureRow
                  label="Generated images"
                  value={count(plan.assets.generatedImages)}
                  icon={<ImageIcon size={14} strokeWidth={1.75} />}
                />
              )}
              {plan.assets.aiVideoClips > 0 && (
                <FigureRow
                  label="AI video clips"
                  value={count(plan.assets.aiVideoClips)}
                  icon={<Film size={14} strokeWidth={1.75} />}
                />
              )}
              {plan.assets.voiceovers > 0 && (
                <FigureRow
                  label="Voiceovers"
                  value={count(plan.assets.voiceovers)}
                  icon={<Mic size={14} strokeWidth={1.75} />}
                />
              )}
              {plan.assets.musicTracks > 0 && (
                <FigureRow
                  label="Music tracks"
                  value={count(plan.assets.musicTracks)}
                  icon={<Music size={14} strokeWidth={1.75} />}
                />
              )}
              <FigureRow
                label="Final compositions"
                value={count(plan.assets.compositions)}
                icon={<Clapperboard size={14} strokeWidth={1.75} />}
              />
              <FigureRow
                label="Estimated Production Credits"
                value={unmetered ? "0 (no provider configured)" : count(plan.estimatedCredits)}
                emphasis
                divided
              />
            </FigureList>
          </div>

          {plan.isMock && (
            <PanelNote
              title="Demo data"
              body="No AI provider key is configured, so the plan text above came from a deterministic mock rather than a real model. Real media generation still runs against fal.ai once you confirm, if it is configured."
            />
          )}
        </CardBody>
      </Card>

      {error && (
        <ErrorState
          title="Could not start generation"
          body={error}
          reassurance="No credits were used for the part that failed."
        />
      )}

      <div className="flex flex-wrap gap-[var(--space-3)]">
        <Button variant="secondary" onClick={onBack} disabled={pending}>
          {quickContentCopy.backLabel}
        </Button>
        <Button size="lg" className="flex-1" onClick={onGenerate} disabled={pending}>
          {pending ? "Starting…" : quickContentCopy.generateSubmitLabel}
        </Button>
      </div>
      <p className={hintClasses}>{quickContentCopy.confirmHint}</p>
    </div>
  );
}
