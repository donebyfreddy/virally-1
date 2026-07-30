import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { bottleneck, evidenceBlocks } from "@/content/evidence";
import {
  DISCLOSURE_ILLUSTRATIVE,
  assertNoPlaceholders,
  needsDisclosure,
} from "@/content/provenance";
import { MitosisStage } from "./MitosisStage";
import { cn } from "@/lib/cn";

/**
 * S3 — the content bottleneck.
 *
 * Structurally unlike every other section: a wide single-column argument with
 * the evidence set as a numbered ledger rather than three cards. The three
 * blocks share no skeleton with S2's manifest or anything later.
 */
export function BottleneckSection() {
  assertNoPlaceholders(evidenceBlocks, "S3 evidence");

  const showDisclosure = evidenceBlocks.some((b) => needsDisclosure(b.provenance));

  return (
    <MotionSection id="bottleneck" aria-labelledby="bottleneck-heading">
      <SectionContainer>
        <div className="max-w-[52rem]">
          <Eyebrow>{bottleneck.eyebrow}</Eyebrow>
          <h2
            id="bottleneck-heading"
            className="font-display mt-6 text-[length:var(--text-display-l)]"
          >
            {bottleneck.headline}
          </h2>
          <p className="prose-measure mt-8 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
            {bottleneck.body}
          </p>
        </div>

        <div className="mt-20">
          <p className="mb-6 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
            {bottleneck.sourceLabel} → every version it should have been
          </p>
          <MitosisStage />
        </div>

        <p className="prose-measure mt-16 text-[color:var(--color-text-secondary)]">
          {bottleneck.closing}
        </p>

        {/* Evidence ledger — numbered rows, not cards. */}
        <ol className="mt-20">
          {evidenceBlocks.map((block, index) => (
            <li
              key={block.id}
              className={cn(
                "grid gap-x-8 gap-y-3 border-t border-[var(--color-border-hairline)] py-8",
                "md:grid-cols-[3rem_11rem_1fr]",
              )}
            >
              <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="font-display text-[length:var(--text-display-m)] text-[color:var(--color-text-primary)]">
                {block.figure}
              </span>
              <div>
                <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
                  {block.label}
                </p>
                <p className="prose-measure mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                  {block.explanation}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {showDisclosure && (
          <p className="mt-8 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
            {DISCLOSURE_ILLUSTRATIVE}
          </p>
        )}
      </SectionContainer>
    </MotionSection>
  );
}
