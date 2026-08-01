"use client";

import { Wand2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/primitives/Button";
import { generateCopy } from "@/content/generate";

/**
 * The summary rail: what will run, what it costs, and the button that starts it.
 *
 * The cost is shown BEFORE the button is pressable, always, and it is denominated
 * in Virally Production Credits — never a provider credit, never a currency
 * figure. The internal cent basis those credits are derived from is our cost, not
 * the customer's price, and it does not leave the server.
 *
 * With Automatic selected the figure is a floor rather than a fixed price,
 * because the router chooses at submit time and can only choose something
 * cheaper-or-equal to the cheapest candidate the client can see. It says so
 * rather than presenting a range it cannot substantiate.
 */
export function GenerationSummary({
  providerLabel,
  modelLabel,
  formatLabel,
  /** Production Credits, or null when no configured model can serve the request. */
  credits,
  /** True when the figure is Automatic's floor rather than a pinned model's price. */
  isFloor,
  available,
  pending,
  disabled,
  disabledReason,
  className,
}: {
  providerLabel: string;
  modelLabel: string;
  formatLabel: string;
  credits: number | null;
  isFloor: boolean;
  available: number;
  pending: boolean;
  disabled: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const after = credits === null ? null : available - credits;
  const short = after !== null && after < 0;

  return (
    <aside
      aria-labelledby="generation-summary-heading"
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--border-default)]",
        "bg-[var(--surface-primary)] p-[var(--app-panel-pad)] shadow-[var(--elevation-card)]",
        className,
      )}
    >
      <h2
        id="generation-summary-heading"
        className="app-card-title text-[color:var(--text-primary)]"
      >
        {generateCopy.summaryTitle}
      </h2>

      <dl className="mt-[var(--space-3)] flex flex-col">
        <Row label={generateCopy.summaryProvider} value={providerLabel} />
        <Row label={generateCopy.summaryModel} value={modelLabel} />
        <Row label={generateCopy.summaryFormat} value={formatLabel} />
        <Row
          label={generateCopy.summaryCost}
          value={
            credits === null
              ? generateCopy.costUnknown
              : `${credits.toLocaleString("en-US")} ${generateCopy.costUnit}`
          }
          figure={credits !== null}
          emphasis
        />
        <Row
          label={generateCopy.summaryBalance}
          value={`${available.toLocaleString("en-US")} ${generateCopy.costUnit}`}
          figure
        />
        {after !== null && (
          <Row
            label={generateCopy.summaryAfter}
            value={`${after.toLocaleString("en-US")} ${generateCopy.costUnit}`}
            figure
            tone={short ? "warning" : "default"}
          />
        )}
      </dl>

      <p className="mt-[var(--space-3)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
        {credits === null
          ? generateCopy.costUnknownHint
          : isFloor
            ? generateCopy.automaticCostHint
            : generateCopy.costReleaseHint}
      </p>

      {short && (
        <p className="mt-[var(--space-3)] rounded-[var(--radius-control)] bg-[var(--warning-soft)] p-[var(--space-3)] text-[length:var(--text-app-meta)] text-[color:var(--text-primary)]">
          {/* Stated before the attempt, so a user is not made to press a button
              that the server will refuse. It is not disabled: the estimate is a
              floor and the server's own figure decides. */}
          {generateCopy.shortfallLabel(Math.abs(after ?? 0))}{" "}
          <Link
            href="/app/usage"
            className="font-[var(--weight-strong)] text-[color:var(--brand-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {generateCopy.topUpLabel}
          </Link>
        </p>
      )}

      {/* A submit button inside the studio's own form, not a click handler: the
          Enter key in the prompt field then does what a keyboard user expects,
          and there is one code path into the action rather than two. */}
      <Button
        type="submit"
        size="lg"
        disabled={disabled}
        loading={pending}
        loadingLabel={generateCopy.generatingLabel}
        iconLeading={<Wand2 aria-hidden="true" size={15} strokeWidth={2} />}
        className="mt-[var(--space-4)] w-full"
      >
        {generateCopy.generateLabel}
      </Button>

      {/* A disabled control that does not say why is a dead end. */}
      {disabled && disabledReason && (
        <p className="mt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {disabledReason}
        </p>
      )}
    </aside>
  );
}

function Row({
  label,
  value,
  figure = false,
  emphasis = false,
  tone = "default",
}: {
  label: string;
  value: string;
  figure?: boolean;
  emphasis?: boolean;
  tone?: "default" | "warning";
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-3)] border-t border-[var(--border-subtle)] py-[var(--space-2)] first:border-t-0 first:pt-0">
      <dt className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-[length:var(--text-app-cell)]",
          figure && "app-figure",
          emphasis
            ? "font-[var(--weight-heading)] text-[color:var(--text-primary)]"
            : "font-[var(--weight-strong)] text-[color:var(--text-primary)]",
          // A regression against a balance is muted, not red: red is reserved
          // for something that failed, and this has not been attempted yet.
          tone === "warning" && "text-[color:var(--warning)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
