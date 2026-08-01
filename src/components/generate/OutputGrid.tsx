import type { ReactNode } from "react";
import { Download, ExternalLink, Film, Image as ImageIcon, Volume2 } from "lucide-react";
import type { GeneratedAsset, GenerationStatus } from "@/lib/generation/data";
import { DEMO_OUTPUT_LABEL, centsToCredits } from "@/lib/creative";
import { formatDuration, relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/app-ui/States";
import { generateCopy } from "@/content/generate";
import { DemoChip, RunProgress, RunStateChip, isInFlight } from "./RunState";

/**
 * The results grid.
 *
 * A server component, and it stays one: nothing here needs state. The whole
 * history — including the thumbnails, which are signed on the server — renders
 * in the initial HTML, and only the live queue above it crosses the client
 * boundary. Pushing this into the client would ship the entire history as JSON
 * inside the flight payload for no interaction gained.
 *
 * Grouped by RUN rather than flattened into a wall of assets. A run is the unit
 * a user reasons about: it has one prompt, one model, one cost and one state,
 * and a grid of loose thumbnails loses every one of those.
 */
export function OutputGrid({
  runs,
  emptyTitle,
  emptyBody,
}: {
  runs: readonly GenerationStatus[];
  emptyTitle: string;
  emptyBody: string;
}) {
  if (runs.length === 0) {
    return <EmptyState bare icon={<ImageIcon size={20} strokeWidth={1.75} />} title={emptyTitle} body={emptyBody} />;
  }

  return (
    <ul className="flex flex-col gap-[var(--app-panel-gap)]">
      {runs.map((run) => (
        <li key={run.runId}>
          <RunCard run={run} />
        </li>
      ))}
    </ul>
  );
}

function RunCard({ run }: { run: GenerationStatus }) {
  // Charged when the run is settled, estimated while it is not. Both are
  // Production Credits — the internal cent figures the row carries are our cost
  // basis, never the customer's price, and no currency appears on this surface.
  const settled = run.actualCents !== null;
  const credits = Math.max(1, centsToCredits(run.actualCents ?? run.estimatedCents));

  return (
    <article
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--border-default)]",
        "bg-[var(--surface-primary)] shadow-[var(--elevation-card)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)] p-[var(--app-panel-pad)]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <RunStateChip state={run.state} />
            {run.isMock && <DemoChip label={DEMO_OUTPUT_LABEL} />}
            <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              {relativeDay(run.createdAt)}
            </span>
          </div>

          {run.prompt.length > 0 && (
            <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-app-cell)] text-[color:var(--text-primary)]">
              {run.prompt}
            </p>
          )}

          <p className="mt-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
            {run.model} · {run.providerId} ·{" "}
            <span className="app-figure">
              {credits.toLocaleString("en-US")} {generateCopy.costUnit}
            </span>{" "}
            {settled ? "charged" : "reserved"}
          </p>

          {run.isMock && (
            <p className="mt-1 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              {generateCopy.demoExplanation}
            </p>
          )}
        </div>
      </div>

      {isInFlight(run.state) && (
        <div className="px-[var(--app-panel-pad)] pb-[var(--app-panel-pad)]">
          <RunProgress progress={run.progress} label={`${run.model} generation`} />
        </div>
      )}

      {run.failureMessage && (
        <div className="px-[var(--app-panel-pad)] pb-[var(--app-panel-pad)]">
          <p className="flex items-start gap-[var(--space-2)] rounded-[var(--radius-control)] bg-[var(--error-soft)] p-[var(--space-3)] text-[length:var(--text-app-meta)] text-[color:var(--error)]">
            {/* Icon plus text: a failure is never carried by the tint alone. */}
            <span aria-hidden="true">✕</span>
            <span className="min-w-0 text-[color:var(--text-primary)]">
              {run.failureMessage}
              {run.failureCode && (
                <span className="app-figure block text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                  {run.failureCode}
                </span>
              )}
            </span>
          </p>
        </div>
      )}

      {run.assets.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] p-[var(--app-panel-pad)]">
          <ul className="grid gap-[var(--app-panel-gap)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {run.assets.map((asset) => (
              <li key={asset.id}>
                <AssetTile asset={asset} isMock={run.isMock} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/**
 * One produced asset.
 *
 * The demo label sits ON the tile, not only on the run header: a screenshot of a
 * single output has to carry its own provenance, or the label is lost exactly
 * where it matters most.
 */
function AssetTile({ asset, isMock }: { asset: GeneratedAsset; isMock: boolean }) {
  const isImage = asset.mimeType?.startsWith("image/") ?? asset.kind.includes("image");
  const meta = [
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
    asset.durationMs === null ? null : formatDuration(asset.durationMs / 1000),
  ].filter((entry): entry is string => entry !== null);

  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-default)]">
      <div className="relative flex aspect-[4/3] items-center justify-center bg-[var(--surface-muted)]">
        {isImage && asset.previewUrl ? (
          // A signed storage URL on a per-deployment host, which next/image
          // cannot optimise without a remote-pattern allowlist per tenant. The
          // reserved box and lazy loading — the parts that matter — are set.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.previewUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={640}
            height={480}
            className="size-full object-contain"
          />
        ) : (
          <KindGlyph kind={asset.kind} mimeType={asset.mimeType} />
        )}

        {isMock && (
          <span className="absolute left-[var(--space-2)] top-[var(--space-2)]">
            <DemoChip label={DEMO_OUTPUT_LABEL} />
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] p-[var(--space-3)]">
        <span className="app-figure min-w-0 truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {meta.length > 0 ? meta.join(" · ") : asset.kind}
        </span>

        {asset.previewUrl ? (
          <span className="flex shrink-0 items-center gap-[var(--space-1)]">
            <AssetAction href={asset.previewUrl} label={generateCopy.assetOpen} newTab>
              <ExternalLink aria-hidden="true" size={14} strokeWidth={2} />
            </AssetAction>
            <AssetAction href={asset.previewUrl} label={generateCopy.assetDownload} download>
              <Download aria-hidden="true" size={14} strokeWidth={2} />
            </AssetAction>
          </span>
        ) : (
          <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {generateCopy.noPreview}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * An icon-only action on an asset.
 *
 * A plain `<a>` rather than a button, so middle-click and copy-link keep
 * working. Under 44px, so it carries the transparent inset that brings the hit
 * area to the target-size floor without changing the paint.
 */
function AssetAction({
  href,
  label,
  children,
  newTab = false,
  download = false,
}: {
  href: string;
  label: string;
  children: ReactNode;
  newTab?: boolean;
  download?: boolean;
}) {
  return (
    <a
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
      download={download || undefined}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-[var(--radius-control)]",
        "text-[color:var(--text-muted)] transition-colors duration-[var(--dur-instant)]",
        "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
      )}
    >
      {children}
      <span className="sr-only">{label}</span>
    </a>
  );
}

/** Stand-in for a file that is not a still. Decorative — the kind is stated beside it. */
function KindGlyph({ kind, mimeType }: { kind: string; mimeType: string | null }) {
  const shared = "text-[color:var(--text-muted)]";
  if (mimeType?.startsWith("audio/") || kind.includes("audio") || kind === "music" || kind === "voiceover") {
    return <Volume2 aria-hidden="true" size={26} strokeWidth={1.25} className={shared} />;
  }
  if (mimeType?.startsWith("video/") || kind.includes("video")) {
    return <Film aria-hidden="true" size={26} strokeWidth={1.25} className={shared} />;
  }
  return <ImageIcon aria-hidden="true" size={26} strokeWidth={1.25} className={shared} />;
}
