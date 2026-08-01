"use client";

import { useId } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateCopy } from "@/content/generate";
import { Field, controlClasses } from "./fields";

/**
 * The likeness and voice confirmation. Lip-sync only.
 *
 * Rendered inline in the form rather than as a modal on submit, for one reason:
 * the thing being confirmed is a fact about the world — that the user holds
 * permission from the person in the clip — and a dialog thrown up at the moment
 * someone is trying to press Generate is answered reflexively. In the form it is
 * read before the prompt is written.
 *
 * The server does not trust any of this. `startGenerationAction` rebuilds the
 * consent record from the session, so the browser cannot claim someone else
 * acknowledged it, and `checkConsent` fails closed if the flag is absent. This
 * component is the place the user says yes, not the place the rule is enforced.
 */
export function ConsentGate({
  confirmed,
  note,
  onConfirmedChange,
  onNoteChange,
  /** Set after a `consent` refusal, so the gate is surfaced rather than a bare error. */
  highlighted = false,
  message,
  className,
}: {
  confirmed: boolean;
  note: string;
  onConfirmedChange: (next: boolean) => void;
  onNoteChange: (next: string) => void;
  highlighted?: boolean;
  message?: string;
  className?: string;
}) {
  const baseId = useId();

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className={cn(
        "rounded-[var(--radius-control)] border p-[var(--space-4)]",
        highlighted
          ? "border-[var(--warning-mark)] bg-[var(--warning-soft)]"
          : "border-[var(--border-default)] bg-[var(--surface-secondary)]",
        className,
      )}
    >
      <h3
        id={`${baseId}-heading`}
        className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-cell)] font-[var(--weight-heading)] text-[color:var(--text-primary)]"
      >
        <ShieldCheck
          aria-hidden="true"
          size={15}
          strokeWidth={2}
          className="shrink-0 text-[color:var(--brand-mark)]"
        />
        {generateCopy.consentTitle}
      </h3>

      {message && (
        <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-app-meta)] text-[color:var(--text-primary)]">
          {message}
        </p>
      )}

      <label
        htmlFor={`${baseId}-confirm`}
        className="mt-[var(--space-3)] flex cursor-pointer items-start gap-[var(--space-3)]"
      >
        <input
          id={`${baseId}-confirm`}
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          className={cn(
            "mt-0.5 size-4 shrink-0 rounded-[4px] border border-[var(--border-control)]",
            "accent-[var(--brand-primary)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
          )}
        />
        <span className="text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
          {generateCopy.consentLabel}
        </span>
      </label>

      <Field
        label={generateCopy.consentNoteLabel}
        htmlFor={`${baseId}-note`}
        hint={generateCopy.consentNoteHint}
        className="mt-[var(--space-3)]"
      >
        <input
          id={`${baseId}-note`}
          type="text"
          value={note}
          maxLength={500}
          onChange={(event) => onNoteChange(event.target.value)}
          aria-describedby={`${baseId}-note-hint`}
          className={cn(controlClasses, "h-9")}
        />
      </Field>
    </section>
  );
}
