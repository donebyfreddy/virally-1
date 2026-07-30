import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { CountUp } from "@/components/motion/CountUp";
import {
  capabilityFacts,
  proofSection,
  volumeMetrics,
} from "@/content/proof";
import {
  DISCLOSURE_ILLUSTRATIVE,
  assertNoPlaceholders,
  mayAnimate,
  needsDisclosure,
} from "@/content/provenance";
import { cn } from "@/lib/cn";

/**
 * S2 — the capability ledger.
 *
 * Deliberately not four big numbers in a row. Without verified telemetry that
 * pattern is four unverifiable claims; as a hairline-ruled manifest of things
 * the product provably does, the same space becomes an honesty signal instead
 * of filler. The volume row sits underneath and is labelled for what it is.
 *
 * Zero client JavaScript apart from the count-ups.
 */
export function ProofLedger() {
  assertNoPlaceholders(volumeMetrics, "S2 proof ledger");

  const showDisclosure = volumeMetrics.some((m) => needsDisclosure(m.provenance));

  return (
    <MotionSection id="proof" surface="raised" aria-labelledby="proof-heading">
      <SectionContainer>
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Eyebrow>{proofSection.eyebrow}</Eyebrow>
            <h2
              id="proof-heading"
              className="font-display mt-4 text-[length:var(--text-display-m)]"
            >
              {proofSection.headline}
            </h2>
            <p className="prose-measure mt-4 text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
              {proofSection.body}
            </p>
          </div>

          {/* Capability manifest — verifiable facts about the product. */}
          <dl className="lg:col-span-8">
            {capabilityFacts.map((fact) => (
              <div
                key={fact.id}
                className={cn(
                  "grid gap-x-6 gap-y-1 border-t border-[var(--color-border-hairline)] py-5",
                  "sm:grid-cols-[12rem_9rem_1fr]",
                )}
              >
                <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                  {fact.label}
                </dt>
                <dd className="font-utility text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                  {fact.value}
                </dd>
                <dd className="text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                  {fact.note}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Volume row. */}
        <ul className="mt-16 grid gap-x-8 gap-y-10 border-t border-[var(--color-border-hairline)] pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {volumeMetrics.map((metric) => (
            <li key={metric.id} className="flex flex-col gap-1">
              <span className="font-display text-[length:var(--text-display-m)] text-[color:var(--color-text-primary)]">
                <CountUp
                  value={metric.value}
                  format={metric.format}
                  animated={mayAnimate(metric.provenance)}
                  label={metric.label}
                />
              </span>
              <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
                {metric.label}
              </span>
              <span className="text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                {metric.note}
              </span>
            </li>
          ))}
        </ul>

        {showDisclosure && (
          <p className="mt-8 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
            {DISCLOSURE_ILLUSTRATIVE} Volume figures are sample data pending
            verified reporting.
          </p>
        )}
      </SectionContainer>
    </MotionSection>
  );
}
