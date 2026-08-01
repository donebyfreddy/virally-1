"use client";

import { useId, useMemo, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateCopy } from "@/content/generate";

/**
 * Reference-image slots.
 *
 * This is a LIBRARY PICKER, not an uploader, and the name is the one thing about
 * it that is misleading. The reason is `isAllowedReferenceUrl` in
 * `lib/generation/actions.ts`: a reference must be a relative path under
 * `/api/storage/`, because a provider fetches whatever URL we hand it and an
 * arbitrary one turns this control into an SSRF primitive. So the only images
 * that can be referenced are ones already in this workspace's storage, and the
 * honest control for "pick something we already hold" is a picker.
 *
 * The number of slots comes from `model.maxReferenceImages` and nothing renders
 * at all when that is zero or undefined — an empty "references" section under a
 * model that ignores them is an invitation to waste a generation.
 *
 * Slot order is meaningful and matches `buildProviderInput`: the first slot is
 * the structure or first-frame reference, the second is the style reference.
 */

export type ReferenceAsset = {
  /**
   * What the form actually submits.
   *
   * An id, not a URL. The action resolves it to a signed, provider-fetchable
   * URL server-side against rows this workspace owns — so the browser never
   * names a location, and an earlier design that shipped a URL and validated
   * its prefix is gone along with the SSRF surface it implied.
   */
  id: string;
  title: string;
  /** Signed URL for the thumbnail. Display only, never submitted. */
  previewUrl: string | null;
};

export function ReferenceUploader({
  slots,
  assets,
  value,
  onChange,
  className,
}: {
  slots: number;
  assets: readonly ReferenceAsset[];
  /** One entry per slot. `null` is an empty slot. */
  value: readonly (string | null)[];
  onChange: (next: readonly (string | null)[]) => void;
  className?: string;
}) {
  const baseId = useId();
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  const byReference = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );

  if (slots <= 0) return null;

  const set = (index: number, reference: string | null) => {
    const next = Array.from({ length: slots }, (_, slot) =>
      slot === index ? reference : value[slot] ?? null,
    );
    onChange(next);
  };

  const usable = assets;

  return (
    <section aria-labelledby={`${baseId}-heading`} className={cn("min-w-0", className)}>
      <h3
        id={`${baseId}-heading`}
        className="text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--text-primary)]"
      >
        {generateCopy.referencesLabel}
      </h3>
      <p className="mt-1 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
        {generateCopy.referencesHint}
      </p>

      <ul className="mt-[var(--space-3)] grid gap-[var(--space-3)] sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: slots }, (_, index) => {
          const reference = value[index] ?? null;
          const asset = reference ? byReference.get(reference) ?? null : null;
          const open = openSlot === index;

          return (
            <li key={`${baseId}-slot-${index}`} className="min-w-0">
              <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-default)]">
                <div className="flex aspect-[4/3] items-center justify-center bg-[var(--surface-muted)]">
                  {asset?.previewUrl ? (
                    // Signed storage URL on a per-deployment host — see the note
                    // in the library grid for why next/image is not used.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.previewUrl}
                      alt={asset.title}
                      loading="lazy"
                      decoding="async"
                      width={320}
                      height={240}
                      className="size-full object-contain"
                    />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-[color:var(--text-muted)]">
                      <ImagePlus aria-hidden="true" size={20} strokeWidth={1.5} />
                      <span className="text-[length:var(--text-app-label)]">
                        {generateCopy.referenceEmpty} {index + 1}
                      </span>
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-[var(--space-2)] p-[var(--space-2)]">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`${baseId}-library-${index}`}
                    onClick={() => setOpenSlot(open ? null : index)}
                    className={cn(
                      "rounded-[var(--radius-chip)] px-2 py-1",
                      "text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
                      "hover:bg-[var(--brand-soft)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)]",
                    )}
                  >
                    {asset ? generateCopy.referenceReplace : generateCopy.referenceChoose}
                    <span className="sr-only"> for slot {index + 1}</span>
                  </button>

                  {reference && (
                    <button
                      type="button"
                      onClick={() => set(index, null)}
                      className={cn(
                        "relative flex size-8 items-center justify-center rounded-[var(--radius-control)]",
                        "text-[color:var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                        "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
                      )}
                    >
                      <X aria-hidden="true" size={14} strokeWidth={2} />
                      <span className="sr-only">
                        {generateCopy.referenceRemove} {index + 1}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              {open && (
                <div
                  id={`${baseId}-library-${index}`}
                  className={cn(
                    "mt-[var(--space-2)] rounded-[var(--radius-control)] border border-[var(--border-default)]",
                    "bg-[var(--surface-primary)] p-[var(--space-2)] shadow-[var(--elevation-card)]",
                    "motion-safe:animate-[virally-app-pop-in_var(--dur-base)_var(--ease-enter)_backwards]",
                  )}
                >
                  {usable.length === 0 ? (
                    <p className="p-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                      {assets.length === 0
                        ? generateCopy.referenceNoneAvailable
                        : generateCopy.referenceUnreachable}
                    </p>
                  ) : (
                    <ul className="grid max-h-64 grid-cols-3 gap-[var(--space-2)] overflow-y-auto">
                      {usable.map((candidate) => (
                        <li key={candidate.id}>
                          <button
                            type="button"
                            onClick={() => {
                              set(index, candidate.id);
                              setOpenSlot(null);
                            }}
                            className={cn(
                              "block w-full overflow-hidden rounded-[var(--radius-chip)] border",
                              reference === candidate.id
                                ? "border-[var(--brand-primary)]"
                                : "border-[var(--border-subtle)]",
                              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                            )}
                          >
                            <span className="flex aspect-square items-center justify-center bg-[var(--surface-muted)]">
                              {candidate.previewUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={candidate.previewUrl}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  width={120}
                                  height={120}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <ImagePlus
                                  aria-hidden="true"
                                  size={16}
                                  strokeWidth={1.5}
                                  className="text-[color:var(--text-muted)]"
                                />
                              )}
                            </span>
                            <span className="block truncate px-1 py-1 text-[length:var(--text-app-label-xs)] text-[color:var(--text-secondary)]">
                              {candidate.title}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
