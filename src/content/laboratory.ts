export type RetentionPoint = { t: number; retention: number };

export type AnnotatedEvent = {
  id: string;
  t: number;
  label: string;
  retentionBefore: number;
  retentionAfter: number;
  explanation: string;
};

export type Variant = {
  id: string;
  label: string;
  completion: number;
  curve: readonly RetentionPoint[];
  events: readonly AnnotatedEvent[];
};

export const laboratory = {
  id: "results",
  eyebrow: "Virality laboratory",
  headline: "Publish more intelligently, not just more often.",
  body: "One post that performs is an anecdote. Virally runs the same idea as several deliberate variants, then reads the retention curves against each other so the next campaign starts from evidence rather than instinct.",
  /** Required disclosure. The curves below are modelled, not measured. */
  disclosure: "Illustrative model. Individual results vary.",
  explanation: {
    heading: "Why this matters more than posting volume",
    paragraphs: [
      "The opening seconds decide almost everything downstream. A viewer who leaves at second two never reaches the point you were making, so a strong idea with a weak first frame reads to the algorithm exactly like a weak idea.",
      "That is why hooks are tested rather than chosen. Three openings on the same script isolate one variable: given identical content, which entry point holds attention? Anything you learn from a single post confounds the hook, the format, the account, the posting time and luck.",
      "Format and account context matter for the same reason. The same edit behaves differently on a 9:16 surface with a bottom-heavy interface than it does in a landscape player, and differently again on an account with a different existing audience.",
      "Virally turns each result into the next test: the variant that held attention seeds the following brief, and the ones that did not are recorded so the same experiment is not repeated by accident. It increases how much you can learn per week. It does not promise reach.",
    ],
  },
  meta: {
    platform: "Instagram Reels",
    format: "9:16 · 28s",
    account: "[REAL ACCOUNT REQUIRED]",
  },
} as const;

/**
 * Modelled retention curves. Sampled every two seconds across a 28-second cut.
 * These are illustrative shapes, not measurements — the section says so on the
 * page, next to the chart rather than in a footnote.
 */
export const variants: readonly Variant[] = [
  {
    id: "hook-a",
    label: "Hook A",
    completion: 28,
    curve: [
      { t: 0, retention: 100 }, { t: 2, retention: 71 }, { t: 4, retention: 62 },
      { t: 6, retention: 56 }, { t: 8, retention: 51 }, { t: 10, retention: 47 },
      { t: 12, retention: 43 }, { t: 14, retention: 40 }, { t: 16, retention: 37 },
      { t: 18, retention: 35 }, { t: 20, retention: 33 }, { t: 22, retention: 31 },
      { t: 24, retention: 30 }, { t: 26, retention: 29 }, { t: 28, retention: 28 },
    ],
    events: [
      { id: "a-hook", t: 0, label: "Hook", retentionBefore: 100, retentionAfter: 71,
        explanation: "A 29-point drop in the first two seconds. The opening line asks the viewer to wait for a payoff instead of showing one." },
      { id: "a-cut", t: 4, label: "First cut", retentionBefore: 62, retentionAfter: 56,
        explanation: "The first edit is where a viewer decides whether to commit. A gentle drop here means the cut landed." },
      { id: "a-cta", t: 22, label: "Call to action", retentionBefore: 31, retentionAfter: 30,
        explanation: "Placed late, so it reaches fewer viewers but a more committed set." },
      { id: "a-end", t: 28, label: "End", retentionBefore: 28, retentionAfter: 28,
        explanation: "28% completion. No loop point, so the video simply stops." },
    ],
  },
  {
    id: "hook-b",
    label: "Hook B",
    completion: 41,
    curve: [
      { t: 0, retention: 100 }, { t: 2, retention: 88 }, { t: 4, retention: 78 },
      { t: 6, retention: 71 }, { t: 8, retention: 66 }, { t: 10, retention: 62 },
      { t: 12, retention: 58 }, { t: 14, retention: 55 }, { t: 16, retention: 52 },
      { t: 18, retention: 49 }, { t: 20, retention: 47 }, { t: 22, retention: 45 },
      { t: 24, retention: 43 }, { t: 26, retention: 42 }, { t: 28, retention: 41 },
    ],
    events: [
      { id: "b-hook", t: 0, label: "Hook", retentionBefore: 100, retentionAfter: 88,
        explanation: "Only a 12-point drop. The first frame states the surprising fact rather than promising it." },
      { id: "b-cut", t: 4, label: "First cut", retentionBefore: 78, retentionAfter: 71,
        explanation: "The cut arrives while attention is still high, so it carries viewers forward instead of giving them an exit." },
      { id: "b-cta", t: 20, label: "Call to action", retentionBefore: 47, retentionAfter: 45,
        explanation: "Earlier placement reaches more viewers at a marginal retention cost." },
      { id: "b-loop", t: 26, label: "Loop point", retentionBefore: 42, retentionAfter: 41,
        explanation: "The final frame rhymes with the first, so replays cost the viewer nothing." },
    ],
  },
  {
    id: "hook-c",
    label: "Hook C",
    completion: 34,
    curve: [
      { t: 0, retention: 100 }, { t: 2, retention: 82 }, { t: 4, retention: 64 },
      { t: 6, retention: 59 }, { t: 8, retention: 55 }, { t: 10, retention: 52 },
      { t: 12, retention: 49 }, { t: 14, retention: 46 }, { t: 16, retention: 44 },
      { t: 18, retention: 42 }, { t: 20, retention: 40 }, { t: 22, retention: 38 },
      { t: 24, retention: 36 }, { t: 26, retention: 35 }, { t: 28, retention: 34 },
    ],
    events: [
      { id: "c-hook", t: 0, label: "Hook", retentionBefore: 100, retentionAfter: 82,
        explanation: "A strong opening frame, but the voiceover takes too long to arrive at the claim." },
      { id: "c-cut", t: 4, label: "First cut", retentionBefore: 82, retentionAfter: 64,
        explanation: "An 18-point drop at the cut. The edit changes subject before the first idea has resolved." },
      { id: "c-cta", t: 22, label: "Call to action", retentionBefore: 38, retentionAfter: 36,
        explanation: "Mid-placement. Reach and commitment roughly balanced." },
      { id: "c-end", t: 28, label: "End", retentionBefore: 34, retentionAfter: 34,
        explanation: "34% completion, between the other two variants." },
    ],
  },
] as const;

export const RUNTIME_SECONDS = 28;
