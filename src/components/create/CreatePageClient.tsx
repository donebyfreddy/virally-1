"use client";

import { useState } from "react";
import { CreationModeSelector, type CreationMode } from "./CreationModeSelector";
import { QuickContentComposer } from "./QuickContentComposer";
import { Composer } from "./Composer";
import { createCampaign } from "@/lib/content/actions";

/**
 * The mode switch itself.
 *
 * A client boundary purely so `mode` can live in state — everything it
 * renders is a composer that already does its own data fetching or receives
 * server-loaded props, so this component owns exactly one decision: which of
 * the two to show.
 */
export function CreatePageClient({
  initialMode,
  accountCount,
  defaultLanguage,
  creditsAvailable,
  creditsReserved,
  unmetered,
}: {
  /** From `?mode=`, e.g. the sidebar's create menu. Falls back to Quick Content. */
  initialMode: CreationMode;
  accountCount: number;
  defaultLanguage: string;
  creditsAvailable: number;
  creditsReserved: number;
  unmetered: boolean;
}) {
  // Quick Content is the default for every new session, per the brief: one
  // piece of content is the more common ask, and defaulting to the campaign
  // form's sixteen fields is what produced six content items for a request
  // that asked for one.
  const [mode, setMode] = useState<CreationMode>(initialMode);

  return (
    <div className="flex flex-col gap-[var(--app-panel-gap)]">
      <CreationModeSelector mode={mode} onChange={setMode} />

      {mode === "quick" ? (
        <QuickContentComposer
          creditsAvailable={creditsAvailable}
          creditsReserved={creditsReserved}
          unmetered={unmetered}
        />
      ) : (
        <Composer
          onSubmit={createCampaign}
          accountCount={accountCount}
          defaultLanguage={defaultLanguage}
          creditsAvailable={creditsAvailable}
          creditsReserved={creditsReserved}
          unmetered={unmetered}
        />
      )}
    </div>
  );
}
