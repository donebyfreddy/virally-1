"use client";

import { useState } from "react";
import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { SegmentedControl } from "@/components/primitives/SegmentedControl";
import { pricing, tiers, type PricingTier } from "@/content/pricing";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/cn";

type Billing = "monthly" | "annual";

/**
 * S11 — pricing.
 *
 * Deliberately motionless. When you ask for money, movement reads as pressure.
 * There is no countdown, no scarcity claim and no "most popular" ribbon —
 * the recommended tier is distinguished by scale, border weight and position,
 * which is honest hierarchy rather than manufactured urgency.
 *
 * No price is invented. Where a figure is unknown the placeholder is shown as
 * a placeholder; a wrong price is the one thing a visitor will hold you to.
 */
export function PricingSection() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <MotionSection id="pricing" surface="raised" aria-labelledby="pricing-heading">
      <SectionContainer>
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div className="max-w-[40rem]">
            <Eyebrow>{pricing.eyebrow}</Eyebrow>
            <h2
              id="pricing-heading"
              className="font-display mt-6 text-[length:var(--text-display-l)]"
            >
              {pricing.headline}
            </h2>
            <p className="prose-measure mt-6 text-[color:var(--color-text-secondary)]">
              {pricing.body}
            </p>
          </div>

          <SegmentedControl
            label="Billing period"
            value={billing}
            onChange={(value) => {
              setBilling(value);
              track("pricing_toggle_changed", "pricing", { billing: value });
            }}
            segments={[
              { value: "monthly", label: pricing.toggle.monthly },
              { value: "annual", label: pricing.toggle.annual },
            ]}
          />
        </div>

        <p
          className={cn(
            "mt-8 inline-block rounded-[var(--radius-sm)] border border-dashed px-3 py-2",
            "border-[var(--color-warning)] font-utility",
            "text-[length:var(--text-utility-xs)] text-[color:var(--color-warning)]",
          )}
        >
          {pricing.notice}
        </p>

        <div className="mt-12 grid items-start gap-6 lg:grid-cols-3">
          {tiers.map((tier) => (
            <PlanCard key={tier.id} tier={tier} billing={billing} />
          ))}
        </div>
      </SectionContainer>
    </MotionSection>
  );
}

/**
 * Vertical price → dimension → objection stack. Shares no layout skeleton with
 * any other card on the site.
 */
function PlanCard({ tier, billing }: { tier: PricingTier; billing: Billing }) {
  const price = billing === "monthly" ? tier.monthly : tier.annual;
  const isPlaceholder = price.startsWith("[");

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-[var(--radius-lg)] border p-6",
        tier.recommended
          ? "border-2 border-[var(--color-action)] bg-[var(--color-surface-2)] lg:-mt-4 lg:p-8"
          : "border-[var(--color-border-hairline)] bg-[var(--color-surface-1)]",
      )}
    >
      <h3 className="font-display text-[length:var(--text-title)]">{tier.name}</h3>
      <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
        {tier.audience}
      </p>

      <p
        className={cn(
          "mt-6 font-display",
          isPlaceholder
            ? "font-utility text-[length:var(--text-body-s)] text-[color:var(--color-warning)]"
            : "text-[length:var(--text-display-m)] text-[color:var(--color-text-primary)]",
        )}
      >
        {price}
      </p>
      {tier.annualSaving && billing === "annual" && (
        <p className="mt-1 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-secondary)]">
          {tier.annualSaving}
        </p>
      )}

      <dl className="mt-6 flex-1">
        {tier.dimensions.map((dimension) => (
          <div
            key={dimension.label}
            className="flex items-baseline justify-between gap-4 border-t border-[var(--color-border-hairline)] py-2.5"
          >
            <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {dimension.label}
            </dt>
            <dd
              className={cn(
                "text-right font-utility text-[length:var(--text-utility-xs)]",
                dimension.value.startsWith("[")
                  ? "text-[color:var(--color-warning)]"
                  : "text-[color:var(--color-text-primary)]",
              )}
            >
              {dimension.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* One honest objection answer per tier. */}
      <div className="mt-6 border-t border-[var(--color-border-hairline)] pt-4">
        <p className="text-[length:var(--text-body-s)] font-medium text-[color:var(--color-text-primary)]">
          {tier.objection.question}
        </p>
        <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
          {tier.objection.answer}
        </p>
      </div>

      <div className="mt-8">
        <ButtonLink
          onClick={() =>
            track("pricing_cta_clicked", "pricing", {
              plan: tier.id,
              billing,
              ctaPosition: "pricing",
            })
          }
          href={tier.cta.href}
          variant={tier.recommended ? "primary" : "secondary"}
          size="lg"
          className="w-full"
        >
          {tier.cta.label}
        </ButtonLink>
      </div>
    </div>
  );
}
