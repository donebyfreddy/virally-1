"use client";

import { useState } from "react";
import { m } from "framer-motion";
import { MotionSection, SectionContainer } from "@/components/motion/MotionSection";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { SegmentedControl } from "@/components/primitives/SegmentedControl";
import { roles, useCases } from "@/content/use-cases";
import { duration, ease } from "@/lib/motion/tokens";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/cn";

/**
 * S10 — role selector.
 *
 * Self-identification outperforms a generic feature grid: an agency visitor
 * needs to see "agency" named before they will read anything else. The panel
 * uses a shared-layout crossfade so switching roles reads as one surface
 * changing rather than four cards swapping.
 */
export function RoleSelector() {
  const [roleId, setRoleId] = useState(roles[0].id);
  const role = roles.find((r) => r.id === roleId) ?? roles[0];

  return (
    <MotionSection id="use-cases" aria-labelledby="use-cases-heading">
      <SectionContainer>
        <div className="max-w-[46rem]">
          <Eyebrow>{useCases.eyebrow}</Eyebrow>
          <h2
            id="use-cases-heading"
            className="font-display mt-6 text-[length:var(--text-display-l)]"
          >
            {useCases.headline}
          </h2>
          <p className="prose-measure mt-6 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
            {useCases.body}
          </p>
        </div>

        <div className="mt-12">
          <SegmentedControl
            label={useCases.selectorLabel}
            value={roleId}
            onChange={(value) => {
              setRoleId(value);
              track("use_case_selected", "use-cases", { role: value });
            }}
            segments={roles.map((r) => ({ value: r.id, label: r.role }))}
          />
        </div>

        <m.div
          key={role.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.base, ease: ease.cut }}
          className="mt-12 grid gap-12 lg:grid-cols-12"
        >
          {/* Asymmetric split — deliberately not an even grid. */}
          <div className="lg:col-span-7">
            <p className="font-display text-[length:var(--text-display-m)]">
              {role.value}
            </p>

            <ol className="mt-8 flex flex-col">
              {role.workflow.map((step, index) => (
                <li
                  key={step}
                  className="flex gap-4 border-t border-[var(--color-border-hairline)] py-3"
                >
                  <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                    {step}
                  </span>
                </li>
              ))}
            </ol>

            <p className="prose-measure mt-8 text-[color:var(--color-text-secondary)]">
              {role.exampleCampaign}
            </p>
            <p className="mt-6 font-display text-[length:var(--text-title)] text-[color:var(--color-text-primary)]">
              {role.conversionMessage}
            </p>
          </div>

          <div className="lg:col-span-4 lg:col-start-9">
            <div
              className={cn(
                "rounded-[var(--radius-lg)] border p-5",
                "border-[var(--color-border-hairline)] bg-[var(--color-surface-2)]",
              )}
            >
              <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                Workspace shape
              </p>
              <dl className="mt-4">
                {role.preview.map((row) => (
                  <div
                    key={row.label}
                    className="flex justify-between gap-4 border-t border-[var(--color-border-hairline)] py-2.5"
                  >
                    <dt className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                      {row.label}
                    </dt>
                    <dd className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-primary)]">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </m.div>
      </SectionContainer>
    </MotionSection>
  );
}
