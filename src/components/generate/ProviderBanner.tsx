import { Plug } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateCopy } from "@/content/generate";

export type ProviderStatus = { id: string; label: string; configured: boolean };

/**
 * States that no provider is configured.
 *
 * Compact, and it does NOT block the form. A user with no credentials can still
 * read the catalogue, price a request and understand the surface; taking the
 * page away from them would teach nothing about what to do next.
 *
 * The wording is deliberately not "generation runs against the mock". It cannot:
 * `startGenerationAction` passes `allowMockFallback: false`, so with nothing
 * configured a submit is refused rather than quietly served demo output. Saying
 * otherwise would be a promise the product does not keep — the mock's outputs
 * appear only in history, from runs a worker or a seed produced, and those carry
 * their own label.
 */
export function ProviderBanner({
  providers,
  className,
}: {
  providers: readonly ProviderStatus[];
  className?: string;
}) {
  if (providers.some((provider) => provider.configured)) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-[var(--space-3)] rounded-[var(--radius-card)]",
        "border border-[var(--warning-mark)] bg-[var(--warning-soft)]",
        "px-[var(--app-panel-pad)] py-[var(--space-4)]",
        className,
      )}
    >
      {/* Icon plus text. A tinted band alone is a colour-only signal. */}
      <Plug
        aria-hidden="true"
        size={16}
        strokeWidth={2}
        className="mt-0.5 shrink-0 text-[color:var(--warning)]"
      />
      <div className="min-w-0">
        <p className="text-[length:var(--text-app-cell)] font-[var(--weight-heading)] text-[color:var(--warning)]">
          {generateCopy.bannerTitle}
        </p>
        <p className="mt-1 max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
          {generateCopy.bannerBody}
        </p>
        {providers.length > 0 && (
          <p className="mt-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]">
            Providers checked: {providers.map((provider) => provider.label).join(", ")}.
          </p>
        )}
      </div>
    </div>
  );
}
