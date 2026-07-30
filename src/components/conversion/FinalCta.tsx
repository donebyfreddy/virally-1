import { SectionContainer } from "@/components/motion/MotionSection";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { finalConversion } from "@/content/pricing";
import {
  DEFAULT_MULTIPLIER_STATE,
  computeCampaign,
} from "@/lib/multiplier";
import { cn } from "@/lib/cn";

/**
 * S12 — the close.
 *
 * Visually quiet after a dense product story: no panel, no border, generous
 * space. The condensed multiplier line is computed by the same function that
 * drives S5, so this summary can never drift out of agreement with the
 * interactive section above it.
 *
 * Zero client JavaScript.
 */
export function FinalCta() {
  const result = computeCampaign(DEFAULT_MULTIPLIER_STATE);

  const chain = [
    `${result.briefs} idea`,
    `${result.concepts} concepts`,
    `${result.assets} assets`,
    `${result.formats} formats`,
    `${result.posts} scheduled`,
  ];

  return (
    <section
      id="start"
      aria-labelledby="final-heading"
      className="border-t border-[var(--color-border-hairline)] py-32 md:py-40"
    >
      <SectionContainer width="text">
        <h2
          id="final-heading"
          className="font-display text-[length:var(--text-display-l)]"
        >
          {finalConversion.headline}
        </h2>
        <p className="mt-6 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
          {finalConversion.body}
        </p>

        {/* One condensed multiplier line — not a replay of the hero. */}
        <ol className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-2">
          {chain.map((step, index) => (
            <li key={step} className="flex items-center gap-3">
              {index > 0 && (
                <span aria-hidden="true" className="text-[color:var(--color-text-muted)]">
                  →
                </span>
              )}
              <span
                className={cn(
                  "font-utility tabular-nums",
                  "text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
                  index === chain.length - 1
                    ? "text-[color:var(--color-action)]"
                    : "text-[color:var(--color-text-secondary)]",
                )}
              >
                {step}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          {finalConversion.exampleNote}
        </p>

        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink
            href={finalConversion.primaryCta.href}
            variant="primary"
            size="lg"
          >
            {finalConversion.primaryCta.label}
          </ButtonLink>
          <ButtonLink
            href={finalConversion.secondaryCta.href}
            variant="secondary"
            size="lg"
          >
            {finalConversion.secondaryCta.label}
          </ButtonLink>
        </div>

        <p className="mt-8 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          Review everything before publishing · Connect accounts through secure
          OAuth · No passwords shared
        </p>
      </SectionContainer>
    </section>
  );
}
