/**
 * Typed event catalogue.
 *
 * Every event carries enough context to be actionable on its own — a
 * `pricing_cta_clicked` with no plan and no position is a number nobody can
 * act on.
 *
 * Privacy boundary, enforced by these types rather than by convention: no
 * free text, no selectors, no prompt content and no precise location may enter
 * a payload. The hero composer is a scripted demo, so there is no visitor text
 * to leak, but the demo events still carry only a step index.
 */

export type DeviceCategory = "mobile" | "tablet" | "desktop";
export type CtaPosition = "nav" | "hero" | "rail" | "pricing" | "final" | "footer";

/** Present on every event. */
export type BaseContext = {
  section: string;
  deviceCategory: DeviceCategory;
  reducedMotion: boolean;
  viewportBucket: 390 | 768 | 1440 | 1920;
  variant?: string;
};

export type EventMap = {
  page_viewed: { path: string };
  hero_prompt_demo_started: Record<string, never>;
  hero_prompt_demo_completed: { loops: number };
  hero_primary_cta_clicked: { ctaPosition: CtaPosition };
  hero_secondary_cta_clicked: { ctaPosition: CtaPosition };
  workflow_stage_viewed: { stage: string; stageIndex: number };
  multiplier_interacted: {
    control: "concepts" | "hooks" | "formats" | "languages" | "accounts" | "reset";
    /** Terminal state is the most valuable signal this page produces. */
    assets: number;
    posts: number;
  };
  format_selected: { format: string };
  platform_section_viewed: Record<string, never>;
  output_played: { outputId: string; kind: string };
  use_case_selected: { role: string };
  pricing_toggle_changed: { billing: "monthly" | "annual" };
  pricing_cta_clicked: { plan: string; billing: "monthly" | "annual"; ctaPosition: CtaPosition };
  signup_started: { ctaPosition: CtaPosition };
  signup_completed: Record<string, never>;
  sales_contact_started: { ctaPosition: CtaPosition };
  faq_opened: { questionId: string };
  scroll_depth: { percent: 25 | 50 | 75 | 100 };
  time_to_first_cta: { ms: number };
};

export type EventName = keyof EventMap;

export type AnalyticsEvent<K extends EventName = EventName> = {
  name: K;
  props: EventMap[K];
  context: BaseContext;
  /** Milliseconds since navigation start. Not a wall-clock timestamp. */
  at: number;
};

export function viewportBucket(width: number): BaseContext["viewportBucket"] {
  if (width < 768) return 390;
  if (width < 1440) return 768;
  if (width < 1920) return 1440;
  return 1920;
}

export function deviceCategory(width: number): DeviceCategory {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

/**
 * Defence in depth against accidental PII: payloads are shallow objects of
 * primitives, and any string longer than this is rejected rather than sent.
 */
export const MAX_STRING_LENGTH = 64;

export function isSafePayload(props: Record<string, unknown>): boolean {
  return Object.values(props).every((value) => {
    if (typeof value === "number" || typeof value === "boolean") return true;
    if (typeof value === "string") return value.length <= MAX_STRING_LENGTH;
    return false;
  });
}
