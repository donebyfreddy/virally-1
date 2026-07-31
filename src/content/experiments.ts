/**
 * Experiments copy.
 *
 * The result vocabulary is the important part of this file. The schema's
 * confidence enum ends at `enough_observations`, not `significant` — it refuses
 * to claim statistical significance, and this copy keeps that refusal. Virally
 * increases the number of legitimate variations you can test; it does not certify
 * a winner, and the words on this page must not imply otherwise.
 */

export const experimentsCopy = {
  eyebrow: "EXPERIMENTS",
  title: "What you changed, and what happened next.",
  body: "Each experiment holds one variable constant across variants — a hook, a thumbnail, a posting time — so the difference in performance is attributable. Results report how much evidence exists, never a declared winner.",

  hypothesisLabel: "HYPOTHESIS",
  variableLabel: (variable: string) => `TESTING ${variable.toUpperCase()}`,
  observationsLabel: (minimum: number) =>
    `Observations toward the configured minimum of ${minimum.toLocaleString("en-US")}`,
  noObservationTarget: "No observation minimum configured for this experiment",

  empty: {
    title: "No experiments yet.",
    body: "An experiment is created from a campaign that has more than one variant of the same content — different hooks, thumbnails or posting times. Once those variants publish, their performance is compared here.",
  },

  /**
   * The side-by-side comparison screen is not built.
   *
   * It needs per-variant metrics attributed back to each published post, which
   * requires the metrics sync. Rendering the layout against absent data would
   * produce two empty columns and imply the comparison had been run.
   */
  comparisonUnavailable:
    "The side-by-side variant comparison — first frame, caption, thumbnail and posting time against each variant's measured performance — needs per-variant metrics from the publishing sync. It is not rendered until those exist, because two empty columns would imply a comparison had been run.",
} as const;

/**
 * How each confidence state is presented.
 *
 * Every state carries a glyph as well as a colour, so the result is legible
 * without hue. Note that nothing here is coloured success-green except the state
 * that genuinely has enough data — "promising" stays neutral, because an early
 * positive signal presented in green is read as a conclusion.
 */
export const CONFIDENCE_PRESENTATION: Readonly<
  Record<string, { label: string; glyph: string; classes: string; explains: string }>
> = {
  no_data: {
    label: "Collecting data",
    glyph: "◦",
    classes: "border-[var(--color-border-hairline)] text-[color:var(--color-text-muted)]",
    explains:
      "No observations recorded yet. Results appear once the variants have published and a metrics sync has run.",
  },
  early_signal: {
    label: "Early signal",
    glyph: "◐",
    classes: "border-[var(--color-border)] text-[color:var(--color-text-secondary)]",
    explains:
      "There is a difference between variants, but not enough observations to rely on it. Early signals reverse often.",
  },
  inconclusive: {
    label: "Inconclusive",
    glyph: "=",
    classes: "border-[var(--color-border-hairline)] text-[color:var(--color-text-muted)]",
    explains:
      "The variants performed close enough that the difference is not attributable to the variable being tested.",
  },
  promising: {
    label: "Promising",
    glyph: "↗",
    classes: "border-[var(--color-border)] text-[color:var(--color-text-primary)]",
    explains:
      "One variant is ahead and the trend has held. This is not a significance claim — treat it as a direction to test further, not a result.",
  },
  enough_observations: {
    label: "Enough observations",
    glyph: "✓",
    classes: "border-[var(--color-success)] text-[color:var(--color-success)]",
    explains:
      "The experiment reached its configured observation minimum. That means the measurement is stable, not that the result is statistically significant.",
  },
};
