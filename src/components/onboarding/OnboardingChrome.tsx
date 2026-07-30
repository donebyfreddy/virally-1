import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { Button } from "@/components/primitives/Button";
import { onboardingCopy } from "@/content/onboarding";
import { skipOnboarding } from "@/lib/onboarding/actions";

/**
 * Shared onboarding frame: progress rail, heading, and the step's own controls.
 *
 * The progress rail is a real `<ol>` with per-step state announced as text, not a
 * decorative bar. A user needs to know how much is left, and "3 of 6" has to be
 * available to a screen reader, not only inferable from a filled width.
 */
export function OnboardingChrome({
  step,
  heading,
  body,
  children,
}: {
  step: number;
  heading: string;
  body: string;
  children: ReactNode;
}) {
  const total = onboardingCopy.steps.length;

  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-[var(--container-wide)] flex-col px-[var(--gutter)] py-12"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="font-display text-[length:var(--text-title)]">Virally</span>

        {/* Leaving must always be possible. An onboarding flow with no exit is a
            trap, and the answers collected so far are kept either way. */}
        <form action={skipOnboarding}>
          <Button type="submit" variant="text">
            Skip setup for now
          </Button>
        </form>
      </div>

      <nav aria-label="Setup progress" className="mt-10">
        <p className="sr-only">{onboardingCopy.nav.progress(step, total)}</p>
        <ol className="flex flex-wrap gap-x-2 gap-y-3">
          {onboardingCopy.steps.map((entry) => {
            const state =
              entry.index < step ? "complete" : entry.index === step ? "current" : "upcoming";
            return (
              <li key={entry.index} className="flex min-w-0 flex-1 basis-24 flex-col gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-0.5 w-full",
                    state === "complete" && "bg-[var(--color-success)]",
                    state === "current" && "bg-[var(--color-action)]",
                    state === "upcoming" && "bg-[var(--color-border-hairline)]",
                  )}
                />
                <span
                  className={cn(
                    "truncate font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
                    state === "upcoming"
                      ? "text-[color:var(--color-text-muted)]"
                      : "text-[color:var(--color-text-secondary)]",
                  )}
                >
                  {/* Glyph plus text: step state never depends on the rail colour. */}
                  {state === "complete" && <span aria-hidden="true">✓ </span>}
                  {state === "current" && <span aria-hidden="true">▸ </span>}
                  {entry.title}
                  {state === "current" && <span className="sr-only"> — current step</span>}
                  {state === "complete" && <span className="sr-only"> — complete</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-16 max-w-[46rem]">
        <Eyebrow>{onboardingCopy.steps[step - 1]?.eyebrow ?? ""}</Eyebrow>
        <h1 className="font-display mt-3 text-[length:var(--text-display-m)] leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          {heading}
        </h1>
        <p className="prose-measure mt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
          {body}
        </p>
      </div>

      <div className="mt-12 pb-16">{children}</div>
    </main>
  );
}

/**
 * Selectable option tile.
 *
 * Renders a real checkbox or radio, visually hidden but focusable, with the tile as
 * its label. That keeps native keyboard behaviour, native form submission and
 * native grouping semantics — a div with `role="checkbox"` and an onClick would
 * need all three rebuilt, and would break form submission without JavaScript.
 */
export function OptionTile({
  name,
  value,
  label,
  detail,
  type,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  detail: string;
  type: "radio" | "checkbox";
  defaultChecked?: boolean;
}) {
  return (
    <label
      className={cn(
        "group relative flex min-h-11 cursor-pointer flex-col gap-1 rounded-[var(--radius-sm)] p-4",
        "border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)]",
        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
        "hover:border-[var(--color-border)]",
        // Selection changes border weight and shows a mark; it is not a fill alone.
        "has-[:checked]:border-2 has-[:checked]:border-[var(--color-action)]",
        "has-[:checked]:bg-[var(--color-action-wash)]",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-focus)]",
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      <span className="flex items-start justify-between gap-3">
        <span className="text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
          {label}
        </span>
        <span
          aria-hidden="true"
          className="font-utility text-[color:var(--color-action)] opacity-0 group-has-[:checked]:opacity-100"
        >
          ✓
        </span>
      </span>
      <span className="text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
        {detail}
      </span>
    </label>
  );
}

/** Consistent footer for each step's primary and secondary actions. */
export function StepActions({
  submitLabel,
  secondary,
}: {
  submitLabel: string;
  secondary?: ReactNode;
}) {
  return (
    <div className="mt-10 flex flex-wrap items-center gap-4">
      <Button type="submit" size="lg">
        {submitLabel}
      </Button>
      {secondary}
    </div>
  );
}
