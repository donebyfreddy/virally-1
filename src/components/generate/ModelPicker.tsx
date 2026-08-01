"use client";

import { useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";
import type { GenerationCapability, GenerationModel } from "@/lib/creative/capabilities";
import { centsToCredits } from "@/lib/creative/modes";
import { cn } from "@/lib/cn";
import { CAPABILITY_LABELS, generateCopy } from "@/content/generate";
import { Field, controlClasses, controlHeight } from "./fields";

/**
 * Model selection.
 *
 * The catalogue is 31 models across two providers and grows every time a vendor
 * ships something, so the one thing this must not be is a single uncontrolled
 * `<select>` — a flat list of thirty names, unsearchable and unsorted, makes the
 * cheapest model that fits impossible to find and pushes every user onto
 * whichever one happens to be first.
 *
 * So: search, a capability filter, a provider filter, a cost sort, the recently
 * used set surfaced first, and "Automatic" as the default. Automatic is the
 * honest default because the router genuinely does pick the cheapest model that
 * fits — pinning a model is an override, not a requirement.
 *
 * NOT virtualised, deliberately. Thirty-one rows of ~64px is under 2,000px of
 * DOM inside a scroll container; a windowing library here would add a
 * dependency, a measurement pass and a keyboard-navigation bug to solve a
 * problem that does not exist at this size. The list is capped by
 * `max-h` and scrolls. Revisit at a few hundred models, not before.
 */

const RECENT_KEY = "virally.generate.recent-models";
const RECENT_LIMIT = 3;

type SortId = "cost" | "cost-desc" | "name";

const SORTS: readonly { id: SortId; label: string }[] = [
  { id: "cost", label: "Lowest cost first" },
  { id: "cost-desc", label: "Highest cost first" },
  { id: "name", label: "Name" },
];

/**
 * Recently-used models, as an external store.
 *
 * `useSyncExternalStore` rather than an effect that calls `setState` on mount.
 * The effect version works but is the pattern React now warns about, and the
 * warning is earned: it renders once with the wrong value and then again with
 * the right one, so the picker visibly reorders itself after hydration.
 *
 * The snapshot must be referentially stable or `useSyncExternalStore` re-renders
 * forever, so the parsed array is cached and only rebuilt when a write
 * invalidates it. `EMPTY` is the server snapshot: there is no localStorage
 * during SSR, and returning a fresh `[]` each call would trip the same loop.
 */
const EMPTY: readonly string[] = [];

let cachedRecent: readonly string[] | null = null;
const recentListeners = new Set<() => void>();

function subscribeRecent(listener: () => void): () => void {
  recentListeners.add(listener);
  return () => recentListeners.delete(listener);
}

function recentSnapshot(): readonly string[] {
  if (typeof window === "undefined") return EMPTY;
  if (cachedRecent) return cachedRecent;
  cachedRecent = readRecent();
  return cachedRecent;
}

/** The server has no localStorage, so it always renders the empty list. */
function recentServerSnapshot(): readonly string[] {
  return EMPTY;
}

/**
 * Records a pin so the next visit can offer it first.
 *
 * Called by the studio form after a generation is accepted rather than on
 * selection: a model someone clicked and then changed their mind about is not
 * one they use.
 */
export function rememberRecentModel(modelId: string): void {
  if (typeof window === "undefined") return;
  try {
    const stored = readRecent();
    const next = [modelId, ...stored.filter((id) => id !== modelId)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    cachedRecent = next;
    for (const listener of recentListeners) listener();
  } catch {
    // A full or blocked localStorage is not a reason to fail a generation.
  }
}

function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Per-unit price in Production Credits. Never cents, never the provider's own unit. */
export function creditsPerUnit(model: GenerationModel): number {
  return Math.max(1, centsToCredits(model.estimatedCentsPerUnit ?? 0));
}

export function ModelPicker({
  models,
  /** `null` is Automatic, and it is the default. */
  value,
  onChange,
  /** What a unit is for this studio: "per image", "per clip", "per track". */
  unitLabel,
  className,
}: {
  models: readonly GenerationModel[];
  value: string | null;
  onChange: (modelId: string | null) => void;
  unitLabel: string;
  className?: string;
}) {
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [capability, setCapability] = useState<string>("all");
  const [provider, setProvider] = useState<string>("all");
  const [sort, setSort] = useState<SortId>("cost");
  const recent = useSyncExternalStore(subscribeRecent, recentSnapshot, recentServerSnapshot);

  const capabilityOptions = useMemo(() => {
    const present = new Set<GenerationCapability>();
    for (const model of models) for (const entry of model.capabilities) present.add(entry);
    return [...present].sort((a, b) => CAPABILITY_LABELS[a].localeCompare(CAPABILITY_LABELS[b]));
  }, [models]);

  const providerOptions = useMemo(() => {
    const present = new Set(models.map((model) => model.providerId));
    return [...present].sort((a, b) => a.localeCompare(b));
  }, [models]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = models.filter((model) => {
      if (capability !== "all" && !model.capabilities.includes(capability as GenerationCapability)) {
        return false;
      }
      if (provider !== "all" && model.providerId !== provider) return false;
      if (needle.length === 0) return true;
      return (
        model.name.toLowerCase().includes(needle) ||
        model.providerId.toLowerCase().includes(needle) ||
        (model.description?.toLowerCase().includes(needle) ?? false)
      );
    });

    return [...matches].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      const delta = creditsPerUnit(a) - creditsPerUnit(b);
      if (delta !== 0) return sort === "cost" ? delta : -delta;
      return a.name.localeCompare(b.name);
    });
  }, [models, query, capability, provider, sort]);

  const recentModels = useMemo(
    () => recent.flatMap((id) => filtered.filter((model) => model.id === id)),
    [recent, filtered],
  );
  const recentIds = new Set(recentModels.map((model) => model.id));
  const rest = filtered.filter((model) => !recentIds.has(model.id));

  const selected = value === null ? null : models.find((model) => model.id === value) ?? null;
  const summary =
    value === null
      ? generateCopy.automaticLabel
      : selected?.name ?? "Model no longer offered";

  return (
    <div className={cn("min-w-0", className)}>
      <p
        id={`${baseId}-label`}
        className="text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--text-primary)]"
      >
        {generateCopy.modelLabel}
      </p>

      {/* An inline disclosure rather than a floating popover. A popover owes the
          accessibility floor Escape-to-dismiss, outside-click handling and focus
          return; expanding in place owes none of those and loses nothing here,
          because the panel has room to open under the control. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${baseId}-panel`}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          controlClasses,
          controlHeight,
          "mt-1.5 flex items-center justify-between gap-[var(--space-2)] text-left",
          "hover:border-[var(--border-strong)]",
        )}
      >
        <span className="flex min-w-0 items-center gap-[var(--space-2)]">
          {value === null && (
            <Sparkles
              aria-hidden="true"
              size={14}
              strokeWidth={2}
              className="shrink-0 text-[color:var(--brand-mark)]"
            />
          )}
          <span className="truncate">{summary}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          size={15}
          strokeWidth={2}
          className={cn("shrink-0 text-[color:var(--text-muted)]", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          id={`${baseId}-panel`}
          className={cn(
            "mt-[var(--space-2)] rounded-[var(--radius-control)] border border-[var(--border-default)]",
            "bg-[var(--surface-primary)] p-[var(--space-3)] shadow-[var(--elevation-card)]",
            "motion-safe:animate-[virally-app-pop-in_var(--dur-base)_var(--ease-enter)_backwards]",
          )}
        >
          <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
            <Field label={generateCopy.modelSearchLabel} htmlFor={`${baseId}-search`}>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  size={14}
                  strokeWidth={2}
                  className="pointer-events-none absolute left-[var(--space-3)] top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
                />
                <input
                  id={`${baseId}-search`}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={generateCopy.modelSearchPlaceholder}
                  className={cn(controlClasses, controlHeight, "pl-8")}
                />
              </div>
            </Field>

            <Field label={generateCopy.modelSortFilter} htmlFor={`${baseId}-sort`}>
              <select
                id={`${baseId}-sort`}
                value={sort}
                onChange={(event) => setSort(event.target.value as SortId)}
                className={cn(controlClasses, controlHeight)}
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={generateCopy.modelCapabilityFilter} htmlFor={`${baseId}-capability`}>
              <select
                id={`${baseId}-capability`}
                value={capability}
                onChange={(event) => setCapability(event.target.value)}
                className={cn(controlClasses, controlHeight)}
              >
                <option value="all">Any capability</option>
                {capabilityOptions.map((option) => (
                  <option key={option} value={option}>
                    {CAPABILITY_LABELS[option]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={generateCopy.modelProviderFilter} htmlFor={`${baseId}-provider`}>
              <select
                id={`${baseId}-provider`}
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className={cn(controlClasses, controlHeight)}
              >
                <option value="all">Any provider</option>
                {providerOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Native radios, so arrow-key navigation, the roving tab stop and the
              group announcement all come from the platform rather than from a
              hand-rolled listbox that gets one of the three wrong. */}
          <fieldset className="mt-[var(--space-4)] min-w-0">
            <legend className="sr-only">{generateCopy.modelLabel}</legend>

            <div className="max-h-[22rem] overflow-y-auto pr-1">
              <ModelOption
                name={`${baseId}-model`}
                checked={value === null}
                onSelect={() => onChange(null)}
                title={generateCopy.automaticLabel}
                detail={generateCopy.automaticDetail}
                icon={
                  <Sparkles
                    aria-hidden="true"
                    size={14}
                    strokeWidth={2}
                    className="text-[color:var(--brand-mark)]"
                  />
                }
              />

              {recentModels.length > 0 && (
                <>
                  <p className="mt-[var(--space-3)] px-1 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                    {generateCopy.modelRecentHeading}
                  </p>
                  {recentModels.map((model) => (
                    <ModelOption
                      key={`recent-${model.id}`}
                      name={`${baseId}-model`}
                      checked={value === model.id}
                      onSelect={() => onChange(model.id)}
                      title={model.name}
                      detail={describe(model, unitLabel)}
                    />
                  ))}
                </>
              )}

              {rest.length > 0 && (
                <>
                  <p className="mt-[var(--space-3)] px-1 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                    {generateCopy.modelAllHeading}
                  </p>
                  {rest.map((model) => (
                    <ModelOption
                      key={model.id}
                      name={`${baseId}-model`}
                      checked={value === model.id}
                      onSelect={() => onChange(model.id)}
                      title={model.name}
                      detail={describe(model, unitLabel)}
                    />
                  ))}
                </>
              )}

              {models.length === 0 && (
                <p className="px-1 py-[var(--space-3)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                  {generateCopy.modelNoneAvailable}
                </p>
              )}

              {models.length > 0 && filtered.length === 0 && (
                <p className="px-1 py-[var(--space-3)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                  {generateCopy.modelNoMatches}
                </p>
              )}
            </div>
          </fieldset>

          {models.length > 0 && (
            <p className="app-figure mt-[var(--space-3)] border-t border-[var(--border-subtle)] pt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              {generateCopy.modelCountLabel(filtered.length, models.length)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** "12 credits per image · muapi · Text to image, Image to image" */
function describe(model: GenerationModel, unitLabel: string): string {
  const capabilities = model.capabilities.map((entry) => CAPABILITY_LABELS[entry]).join(", ");
  return `${creditsPerUnit(model).toLocaleString("en-US")} credits ${unitLabel} · ${model.providerId} · ${capabilities}`;
}

function ModelOption({
  name,
  checked,
  onSelect,
  title,
  detail,
  icon,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  icon?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-[var(--space-3)] rounded-[var(--radius-control)] p-[var(--space-3)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:bg-[var(--surface-muted)]",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-[var(--focus-ring)]",
        checked && "bg-[var(--brand-soft)]",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {/* The selected state is a tick plus a filled row, not the wash alone. */}
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          checked
            ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[color:var(--text-on-brand)]"
            : "border-[var(--border-control)]",
        )}
      >
        {checked && <Check size={10} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
          {icon}
          {title}
        </span>
        <span className="app-figure mt-0.5 block text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {detail}
        </span>
      </span>
    </label>
  );
}
