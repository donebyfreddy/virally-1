"use client";

import { Paperclip } from "lucide-react";
import { heroDemo } from "@/content/marketing";
import { Badge } from "@/components/primitives/Badge";
import { PromptTypewriter } from "./PromptTypewriter";
import { hasReached, type HeroBeat } from "./heroTimeline";
import { cn } from "@/lib/cn";

const platforms = ["Instagram", "TikTok", "YouTube", "Facebook"] as const;

/**
 * The composer is a demonstration surface, not a form: it is not editable and
 * submits nothing. Presenting a working-looking input that silently discards
 * what a visitor types is worse than showing a scripted one honestly, so the
 * region is labelled as a demonstration and carries no focusable field.
 *
 * The real composer lives in the product.
 */
export function PromptComposer({
  beat,
  elapsedRef,
  isPlaying,
  staticFinalState,
}: {
  beat: HeroBeat;
  elapsedRef: React.RefObject<number>;
  isPlaying: boolean;
  staticFinalState: boolean;
}) {
  const parsed = hasReached(beat, "parsed");

  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--color-border-hairline)]",
        "bg-[var(--color-surface-1)]",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-4",
          "border-b border-[var(--color-border-hairline)] px-4 py-3",
        )}
      >
        <span
          className={cn(
            "font-utility uppercase",
            "text-[length:var(--text-utility-xs)] tracking-[var(--tracking-eyebrow)]",
            "text-[color:var(--color-text-secondary)]",
          )}
        >
          {heroDemo.fieldLabel}
        </span>
        <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          {heroDemo.shortcutHint}
        </span>
      </div>

      <div className="p-4">
        <PromptTypewriter
          text={heroDemo.prompt}
          elapsedRef={elapsedRef}
          isPlaying={isPlaying}
          staticFinalState={staticFinalState}
          className={cn(
            "min-h-[13.5rem] text-[length:var(--text-body-s)] leading-[1.55]",
            "text-[color:var(--color-text-primary)]",
          )}
        />

        {/* Structured result of parsing the brief. */}
        <div
          className={cn(
            "mt-4 flex flex-wrap gap-2",
            "transition-opacity duration-[var(--dur-panel)] ease-[var(--ease-settle)]",
            parsed ? "opacity-100" : "opacity-0",
          )}
        >
          {heroDemo.parsed.map((chip) => (
            <Badge key={chip.label}>
              <span className="text-[color:var(--color-text-muted)]">{chip.label}</span>
              <span className="normal-case text-[color:var(--color-text-primary)]">
                {chip.value}
              </span>
            </Badge>
          ))}
        </div>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2",
          "border-t border-[var(--color-border-hairline)] px-4 py-3",
        )}
      >
        <span className="inline-flex items-center gap-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          <Paperclip aria-hidden="true" className="size-3.5" />
          Source
        </span>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {platforms.map((platform) => (
            <li
              key={platform}
              className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]"
            >
              <span aria-hidden="true" className="text-[color:var(--color-action)]">
                ◉
              </span>{" "}
              {platform}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
