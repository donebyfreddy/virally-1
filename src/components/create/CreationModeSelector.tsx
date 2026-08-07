"use client";

import { Check, Layers, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { creationModeCopy } from "@/content/create";

export type CreationMode = "quick" | "campaign";

/**
 * The entry choice at the top of `/app/create`.
 *
 * Two large, mutually exclusive cards rather than a segmented control: the
 * choice changes everything below it — a completely different form, not a
 * filter on the same one — and a segmented control implies a lighter-weight
 * toggle than that.
 */
export function CreationModeSelector({
  mode,
  onChange,
}: {
  mode: CreationMode;
  onChange: (next: CreationMode) => void;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      {/* Visually hidden: the page's own `<h1>` already asks this question
          (see `createCopy.heading`), so a second, identical heading here would
          be a literal duplicate rather than a hierarchy. Still a real legend
          for assistive technology, which needs one to announce the fieldset. */}
      <legend className="sr-only">{creationModeCopy.heading}</legend>

      <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
        <ModeCard
          icon={<Zap size={20} strokeWidth={1.75} />}
          label={creationModeCopy.quick.label}
          detail={creationModeCopy.quick.detail}
          selected={mode === "quick"}
          onSelect={() => onChange("quick")}
        />
        <ModeCard
          icon={<Layers size={20} strokeWidth={1.75} />}
          label={creationModeCopy.campaign.label}
          detail={creationModeCopy.campaign.detail}
          selected={mode === "campaign"}
          onSelect={() => onChange("campaign")}
        />
      </div>
    </fieldset>
  );
}

function ModeCard({
  icon,
  label,
  detail,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[6.5rem] flex-col items-start gap-[var(--space-2)] rounded-[var(--radius-card)] p-[var(--space-4)] text-left",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        selected
          ? "border-2 border-[var(--brand-primary)] bg-[var(--brand-soft)] p-[calc(var(--space-4)-1px)]"
          : "border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-secondary)]",
      )}
    >
      <span className="flex w-full items-center justify-between gap-[var(--space-2)]">
        <span
          aria-hidden="true"
          className={cn(
            selected ? "text-[color:var(--brand-mark)]" : "text-[color:var(--text-muted)]",
          )}
        >
          {icon}
        </span>
        <span aria-hidden="true" className="w-4 shrink-0">
          {selected && <Check size={16} strokeWidth={2.5} className="text-[color:var(--brand-mark)]" />}
        </span>
      </span>

      <span
        className={cn(
          "text-[length:var(--text-app-title)] font-[var(--weight-heading)]",
          selected ? "text-[color:var(--brand-ink)]" : "text-[color:var(--text-primary)]",
        )}
      >
        {label}
      </span>

      <span className="text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
        {detail}
      </span>
    </button>
  );
}
