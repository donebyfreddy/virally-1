"use client";

import { useState } from "react";
import type { GenerationModel } from "@/lib/creative/capabilities";
import type { GenerationStatus } from "@/lib/generation/data";
import { generateCopy, type StudioDefinition } from "@/content/generate";
import { GenerationQueue } from "./GenerationQueue";
import { StudioForm } from "./StudioForm";
import type { ReferenceAsset } from "./ReferenceUploader";
import type { ProviderStatus } from "./ProviderBanner";

/**
 * The client boundary for a studio.
 *
 * It exists to hold exactly one piece of shared state — the nudge that tells the
 * queue a generation was just accepted — and nothing else. Everything below it
 * is either a control the user operates or a list that changes while they watch;
 * the history grid, the cost table and the provider banner stay on the server,
 * where their data already is.
 *
 * Drawing the boundary here rather than at the page is what keeps the initial
 * HTML complete: a user with JavaScript still loading sees the whole history and
 * the whole catalogue, and only the form is inert.
 */
export function StudioShell({
  studio,
  models,
  available,
  references,
  providers,
  canGenerate,
  activeRuns,
}: {
  studio: StudioDefinition;
  models: readonly GenerationModel[];
  available: number;
  references: readonly ReferenceAsset[];
  providers: readonly ProviderStatus[];
  canGenerate: boolean;
  activeRuns: readonly GenerationStatus[];
}) {
  const [startedCount, setStartedCount] = useState(0);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <StudioForm
        studio={studio}
        models={models}
        available={available}
        references={references}
        providers={providers}
        canGenerate={canGenerate}
        onStarted={() => setStartedCount((count) => count + 1)}
      />

      <section aria-labelledby="generation-queue-heading">
        <h2
          id="generation-queue-heading"
          className="app-section-title text-[color:var(--text-primary)]"
        >
          {generateCopy.queueTitle}
        </h2>
        <GenerationQueue
          initial={activeRuns}
          refreshToken={startedCount}
          className="mt-[var(--space-3)]"
        />
      </section>
    </div>
  );
}
