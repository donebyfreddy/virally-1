"use client";

import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { Badge } from "@/components/primitives/Badge";
import { Eyebrow, Rule } from "@/components/primitives/Eyebrow";
import { Field, Textarea } from "@/components/primitives/Field";
import { Slider } from "@/components/primitives/Slider";
import { SegmentedControl } from "@/components/primitives/SegmentedControl";
import { Disclosure } from "@/components/primitives/Disclosure";
import { SkipLink } from "@/components/primitives/SkipLink";
import { StatusDot, type MachineStatus } from "@/components/primitives/StatusDot";
import { CountUp } from "@/components/motion/CountUp";
import { MagneticPointerSurface } from "@/components/motion/MagneticPointerSurface";
import { RevealGroup, StaggerItem } from "@/components/motion/RevealGroup";
import { contrastLevel, contrastRatio } from "@/lib/accessibility/contrast";
import { contrastContract, palette } from "@/lib/accessibility/palette";
import { cn } from "@/lib/cn";

const statuses: MachineStatus[] = [
  "planning",
  "generating",
  "rendering",
  "publishing",
  "scheduled",
  "live",
  "idle",
  "error",
];

const spacingScale = [
  ["space-1", 4],
  ["space-2", 8],
  ["space-3", 12],
  ["space-4", 16],
  ["space-6", 24],
  ["space-8", 32],
  ["space-12", 48],
  ["space-16", 64],
  ["space-20", 80],
  ["space-24", 96],
  ["space-32", 128],
  ["space-40", 160],
] as const;

const easings = [
  ["--ease-cut", "State commits — the edit cut"],
  ["--ease-settle", "Arrival — nodes landing"],
  ["--ease-enter", "Appearing"],
  ["--ease-exit", "Leaving — faster than entering"],
  ["--ease-linear", "Playheads and progress only"],
] as const;

export function KitchenSink() {
  const [format, setFormat] = useState<"9:16" | "4:5" | "1:1" | "16:9">("9:16");
  const [concepts, setConcepts] = useState(3);
  const [simulateReduced, setSimulateReduced] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <div
      // Simulating reduced motion by killing transitions inside this subtree,
      // so reviewers can check the static design without changing OS settings.
      className={cn(simulateReduced && "[&_*]:!transition-none [&_*]:!animate-none")}
    >
      <SkipLink />
      <main id="main" className="mx-auto max-w-[var(--container-wide)] px-[var(--gutter)] py-16">
        <header className="mb-16">
          <Eyebrow>Development only · not indexed</Eyebrow>
          <h1 className="font-display mt-4 text-[length:var(--text-display-l)]">
            Kitchen sink
          </h1>
          <p className="prose-measure mt-4 text-[color:var(--color-text-secondary)]">
            Every primitive in every state, the measured palette, and the motion
            vocabulary. Contrast ratios below are computed at render time from
            the same token values the site ships — they are not transcribed.
          </p>

          <label className="mt-8 flex min-h-11 w-fit cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={simulateReduced}
              onChange={(e) => setSimulateReduced(e.target.checked)}
              className="size-5 accent-[var(--color-action)]"
            />
            <span className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]">
              Simulate reduced motion
            </span>
          </label>
        </header>

        {/* ---------------------------------------------------------------- */}
        <Section title="Palette — measured contrast">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(palette).map(([name, hex]) => (
              <div
                key={name}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] p-4"
              >
                <div
                  className="mb-3 h-12 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)]"
                  style={{ backgroundColor: hex }}
                />
                <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]">
                  {name}
                </p>
                <p className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                  {hex}
                </p>
              </div>
            ))}
          </div>

          <h3 className="font-utility mt-12 mb-4 text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-eyebrow)]">
            Contrast contract
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left">
              <caption className="sr-only">
                Measured WCAG contrast ratios for every token pairing the site
                relies on
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border-hairline)]">
                  {["Pairing", "Foreground", "Background", "Ratio", "Floor", "Result"].map(
                    (h) => (
                      <th
                        key={h}
                        scope="col"
                        className="py-2 font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {contrastContract.map((row) => {
                  const ratio = contrastRatio(
                    palette[row.foreground],
                    palette[row.background],
                  );
                  const level = contrastLevel(ratio, row.large);
                  const passed = level !== "fail";
                  return (
                    <tr
                      key={`${row.foreground}-${row.background}`}
                      className="border-b border-[var(--color-border-hairline)]"
                    >
                      <td className="py-2 text-[length:var(--text-body-s)]">{row.note}</td>
                      <td className="py-2 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                        {row.foreground}
                      </td>
                      <td className="py-2 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                        {row.background}
                      </td>
                      <td className="py-2 font-utility tabular-nums text-[length:var(--text-body-s)]">
                        {ratio.toFixed(2)}
                      </td>
                      <td className="py-2 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                        {row.large ? "3.0" : "4.5"}
                      </td>
                      <td
                        className={cn(
                          "py-2 font-utility text-[length:var(--text-utility-xs)] uppercase",
                          passed
                            ? "text-[color:var(--color-success)]"
                            : "text-[color:var(--color-error)]",
                        )}
                      >
                        {passed ? `✓ ${level}` : "✕ FAIL"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Typography">
          <div className="flex flex-col gap-6">
            <p className="font-display text-[length:var(--text-display-xl)]">
              One idea. Every format.
            </p>
            <p className="font-display text-[length:var(--text-display-l)]">
              Display L — section headline
            </p>
            <p className="font-display text-[length:var(--text-display-m)]">
              Display M — subsection
            </p>
            <p className="text-[length:var(--text-title)] font-medium">
              Title — card heading
            </p>
            <p className="prose-measure text-[length:var(--text-body-l)]">
              Body L. Virally turns a single brief into scripts, videos, images
              and platform-ready campaigns — then helps you publish, test and
              improve them.
            </p>
            <p className="prose-measure">
              Body. The default reading size, set at a 68-character measure with
              a 1.65 line height. Italic support is real: <em>this is italic</em>.
            </p>
            <p className="prose-measure text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
              Body S — captions and microcopy.
            </p>
            <p className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]">
              Utility · 00:04:12 · 1,284 assets · 9:16
            </p>
            <Eyebrow>Utility XS — eyebrow</Eyebrow>
            <p className="font-utility tabular-nums text-[length:var(--text-body-l)]">
              Tabular figures: 0123456789 / 1111111111
            </p>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Buttons — all variants, all states">
          {(["primary", "secondary", "text", "destructive"] as const).map((variant) => (
            <div key={variant} className="mb-8">
              <Eyebrow className="mb-3">{variant}</Eyebrow>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant={variant}>Default</Button>
                <Button variant={variant} size="lg">
                  Large
                </Button>
                <Button variant={variant} disabled>
                  Disabled
                </Button>
                <Button variant={variant} loading loadingLabel="Generating">
                  Loading
                </Button>
                <Button
                  variant={variant}
                  loading={loading}
                  loadingLabel="Generating"
                  onClick={() => {
                    setLoading(true);
                    window.setTimeout(() => setLoading(false), 2000);
                  }}
                >
                  Click to load
                </Button>
              </div>
            </div>
          ))}
          <Eyebrow className="mb-3">Anchor styled as button</Eyebrow>
          <ButtonLink href="#main" variant="primary">
            Start creating
          </ButtonLink>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Machine status">
          <p className="prose-measure mb-6 text-[color:var(--color-text-secondary)]">
            Teal appears only while the machine is genuinely working. Every
            status carries a dot, a word and — when active — an ellipsis, so
            none of them depend on colour.
          </p>
          <div className="flex flex-wrap gap-6">
            {statuses.map((status) => (
              <StatusDot key={status} status={status} />
            ))}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Form controls">
          <div className="grid gap-8 md:grid-cols-2">
            <Field
              label="Campaign brief"
              hint="Describe the idea, audience, style and cadence. Sources can be attached below."
              adornment="⌘ + ↵"
            >
              {({ inputId, describedBy }) => (
                <Textarea
                  id={inputId}
                  aria-describedby={describedBy}
                  rows={5}
                  placeholder="Create a 7-day campaign about…"
                />
              )}
            </Field>

            <Field
              label="Campaign brief"
              hint="This field is showing its error state."
              error="A brief needs at least one sentence before it can be planned."
            >
              {({ inputId, describedBy }) => (
                <Textarea id={inputId} aria-describedby={describedBy} rows={5} invalid />
              )}
            </Field>

            <Slider
              label="Concepts"
              value={concepts}
              min={1}
              max={8}
              unit="concepts"
              onChange={setConcepts}
            />

            <div>
              <Eyebrow className="mb-3">Segmented control (arrow keys)</Eyebrow>
              <SegmentedControl
                label="Output format"
                value={format}
                onChange={setFormat}
                segments={[
                  { value: "9:16", label: "9:16" },
                  { value: "4:5", label: "4:5" },
                  { value: "1:1", label: "1:1" },
                  { value: "16:9", label: "16:9" },
                ]}
              />
            </div>
          </div>

          <div className="mt-8">
            <Disclosure summary="Disclosure — chart text equivalents live here">
              <p className="prose-measure text-[color:var(--color-text-secondary)]">
                Content is unmounted when closed, which keeps it out of the tab
                order without needing <code>inert</code>.
              </p>
            </Disclosure>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Badges">
          <div className="flex flex-wrap gap-3">
            <Badge>9:16</Badge>
            <Badge tone="action">Selected</Badge>
            <Badge tone="signal">Rendering</Badge>
            <Badge tone="warning">Illustrative placeholder</Badge>
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Motion primitives">
          <Eyebrow className="mb-3">CountUp — verified data only</Eyebrow>
          <p className="text-[length:var(--text-display-m)] font-display">
            <CountUp value={1284} label="Assets produced" />
          </p>
          <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
            Static (unverified data never animates):{" "}
            <CountUp value={42} animated={false} label="Scheduled posts" />
          </p>

          <Eyebrow className="mb-3 mt-12">RevealGroup — enumeration only</Eyebrow>
          <RevealGroup className="flex flex-col gap-2">
            {["Strategy", "Create", "Adapt", "Distribute", "Learn"].map((s, i) => (
              <StaggerItem
                key={s}
                className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]"
              >
                {String(i + 1).padStart(2, "0")} / {s}
              </StaggerItem>
            ))}
          </RevealGroup>

          <Eyebrow className="mb-3 mt-12">
            MagneticPointerSurface — 8px cap, mouse only
          </Eyebrow>
          <MagneticPointerSurface className="w-fit">
            <div className="flex h-32 w-48 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
              <span className="font-utility text-[length:var(--text-utility)]">
                Hover me
              </span>
            </div>
          </MagneticPointerSurface>

          <Eyebrow className="mb-3 mt-12">Easing vocabulary</Eyebrow>
          <ul className="flex flex-col gap-3">
            {easings.map(([token, role]) => (
              <li key={token} className="flex flex-wrap items-baseline gap-4">
                <code className="font-utility text-[length:var(--text-utility)] text-[color:var(--color-action)]">
                  {token}
                </code>
                <span className="text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
                  {role}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Spacing scale">
          <ul className="flex flex-col gap-2">
            {spacingScale.map(([token, px]) => (
              <li key={token} className="flex items-center gap-4">
                <span className="w-24 font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                  {token}
                </span>
                <span className="w-12 font-utility tabular-nums text-[length:var(--text-utility-xs)]">
                  {px}
                </span>
                <span
                  className="h-3 bg-[var(--color-action)]"
                  style={{ width: `${px}px` }}
                />
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Surfaces and radii">
          <div className="grid gap-4 sm:grid-cols-4">
            {(["canvas", "surface-1", "surface-2", "surface-3"] as const).map((s) => (
              <div
                key={s}
                className="rounded-[var(--radius-lg)] border border-[var(--color-border-hairline)] p-6"
                style={{ backgroundColor: `var(--color-${s})` }}
              >
                <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]">
                  {s}
                </p>
                <p className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
                  Muted text legibility check on this surface.
                </p>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-24">
      <h2 className="font-display mb-2 text-[length:var(--text-display-m)]">{title}</h2>
      <Rule className="mb-8" />
      {children}
    </section>
  );
}
