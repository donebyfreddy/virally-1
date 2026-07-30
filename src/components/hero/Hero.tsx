"use client";

import { useRef } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { hero } from "@/content/marketing";
import { Eyebrow } from "@/components/primitives/Eyebrow";
import { Button } from "@/components/primitives/Button";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { MagneticPointerSurface } from "@/components/motion/MagneticPointerSurface";
import { SectionContainer } from "@/components/motion/MotionSection";
import { useReducedMotionPreference } from "@/lib/motion/useReducedMotionPreference";
import {
  useActiveWhenVisible,
  useOrchestration,
} from "@/lib/motion/useOrchestration";
import { PromptComposer } from "./PromptComposer";
import { CampaignCanvas } from "./CampaignCanvas";
import { HERO_BEATS, HERO_LOOP_DURATION, type HeroBeat } from "./heroTimeline";
import { track } from "@/lib/analytics/track";
import { cn } from "@/lib/cn";

/**
 * S1 — one prompt becomes a campaign.
 *
 * The LCP element is the `<h1>`: plain server-rendered text, painted before any
 * of this runs. The demonstration occupies a fixed-height box reserved at SSR,
 * so hydration adds motion without moving a single pixel of the layout.
 *
 * Under reduced motion the timeline never starts and the panel renders its
 * settled state — a finished campaign rather than a frozen half-generated one.
 */
export function Hero() {
  const stageRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotionPreference();
  const active = useActiveWhenVisible(stageRef);

  const { beat, isPlaying, userPaused, elapsedRef, toggle, restart } =
    useOrchestration<HeroBeat>({
      beats: HERO_BEATS,
      loopDuration: HERO_LOOP_DURATION,
      staticFinalState: prefersReduced,
      active,
    });

  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className="relative w-full pb-20 pt-12 md:pb-32 md:pt-20"
    >
      <SectionContainer width="max">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          {/* Left — the argument. Static HTML, paints first. */}
          <div className="lg:col-span-5">
            <Eyebrow>{hero.eyebrow}</Eyebrow>

            <h1
              id="hero-heading"
              className="font-display mt-6 text-[length:var(--text-display-xl)]"
            >
              {hero.headlineLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>

            <p className="prose-measure mt-8 text-[length:var(--text-body-l)] text-[color:var(--color-text-secondary)]">
              {hero.body}
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink
                href={hero.primaryCta.href}
                variant="primary"
                size="lg"
                onClick={() =>
                  track("hero_primary_cta_clicked", "hero", { ctaPosition: "hero" })
                }
              >
                {hero.primaryCta.label}
              </ButtonLink>
              <ButtonLink
                href={hero.secondaryCta.href}
                variant="secondary"
                size="lg"
                onClick={() =>
                  track("hero_secondary_cta_clicked", "hero", { ctaPosition: "hero" })
                }
              >
                {hero.secondaryCta.label}
              </ButtonLink>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-3 gap-y-2">
              {hero.trustPoints.map((point, index) => (
                <li
                  key={point}
                  className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]"
                >
                  {index > 0 && <span aria-hidden="true" className="mr-3">·</span>}
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-12">
              <PromptComposer
                beat={beat}
                elapsedRef={elapsedRef}
                isPlaying={isPlaying}
                staticFinalState={prefersReduced}
              />
            </div>
          </div>

          {/* Right — the demonstration. */}
          <div className="lg:col-span-7">
            <div
              ref={stageRef}
              // Height reserved so hydration and beat changes cost zero CLS.
              className="min-h-[32rem] lg:min-h-[42rem]"
            >
              <MagneticPointerSurface className="h-full">
                <CampaignCanvas
                  beat={beat}
                  elapsedRef={elapsedRef}
                  isPlaying={isPlaying}
                />
              </MagneticPointerSurface>
            </div>

            {/* Demo controls. Always keyboard-reachable; hidden only when the
                timeline is not running at all. */}
            {!prefersReduced && (
              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="text"
                  onClick={toggle}
                  aria-pressed={userPaused}
                  iconLeading={
                    userPaused ? (
                      <Play aria-hidden="true" className="size-3.5" />
                    ) : (
                      <Pause aria-hidden="true" className="size-3.5" />
                    )
                  }
                >
                  {userPaused ? "Play demo" : "Pause demo"}
                </Button>
                <Button
                  variant="text"
                  onClick={restart}
                  iconLeading={<RotateCcw aria-hidden="true" className="size-3.5" />}
                >
                  Replay
                </Button>
              </div>
            )}
          </div>
        </div>
      </SectionContainer>

      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-px",
          "bg-[var(--color-border-hairline)]",
        )}
      />
    </section>
  );
}
