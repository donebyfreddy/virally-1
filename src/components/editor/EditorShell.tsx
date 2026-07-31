"use client";

import { useMemo, useState } from "react";
import {
  Clapperboard,
  Film,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Music,
  Pause,
  Play,
  Type,
  Volume2,
} from "lucide-react";
import type { ReviewStatus } from "@/types/database";
import { cn } from "@/lib/cn";
import { formatTimecode } from "@/lib/format";
import { Panel } from "@/components/app-ui/Panel";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { Badge } from "@/components/primitives/Badge";
import { Button } from "@/components/primitives/Button";
import { ASSET_KIND_LABELS } from "@/content/content-library";
import { PLATFORM_OPTIONS } from "@/content/create";
import { editorCopy, INSPECTOR_TABS, type InspectorTabId } from "@/content/editor";

/**
 * The content editing suite.
 *
 * Four regions: assets on the left, the preview centre, the inspector right, the
 * timeline below. That arrangement is borrowed from NLE tools because it matches
 * the task — you pick a source, watch the result, adjust a property, and scrub
 * time — not because it looks professional.
 *
 * What this deliberately is NOT: a working video editor. Nothing here renders,
 * seeks or mutates, because the render pipeline is a queued job and the mutation
 * actions are part of a later phase. Every control that would need that backing
 * is present but disabled with a stated reason, rather than being wired to a
 * handler that silently does nothing. The panels, variant switching, timeline
 * reading and inspector are real and read real rows.
 *
 * On narrow viewports the three side regions become a single switchable panel —
 * three columns at 390px would be three unusable columns.
 */

export type EditorItem = {
  id: string;
  title: string;
  typeLabel: string;
  language: string;
  status: ReviewStatus;
  caption: string | null;
  callToAction: string | null;
  durationMs: number | null;
  isMock: boolean;
  revision: number;
  /** ISO string — a Date cannot cross the server/client boundary. */
  updatedAt: string;
  campaignId: string | null;
  campaignName: string | null;
};

export type EditorVariant = {
  id: string;
  platform: string;
  aspectRatio: string;
  width: number | null;
  height: number | null;
  language: string;
  status: ReviewStatus;
  captionOverride: string | null;
  renderedAssetId: string | null;
  thumbnailAssetId: string | null;
};

export type EditorSegment = {
  position: number;
  text: string;
  startMs: number | null;
  endMs: number | null;
  role: string | null;
};

export type EditorAsset = {
  id: string;
  kind: string;
  filename: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  origin: string;
  uploadState: string;
};

/** Which region a narrow viewport is showing. */
type MobilePane = "assets" | "preview" | "inspector";

export function EditorShell({
  item,
  variants,
  segments,
  assets,
}: {
  item: EditorItem;
  variants: readonly EditorVariant[];
  segments: readonly EditorSegment[];
  assets: readonly EditorAsset[];
}) {
  const [activeVariantId, setActiveVariantId] = useState<string | null>(variants[0]?.id ?? null);
  const [tab, setTab] = useState<InspectorTabId>("script");
  const [pane, setPane] = useState<MobilePane>("preview");

  const activeVariant = variants.find((variant) => variant.id === activeVariantId) ?? null;

  /** Total duration, from the segments when the item has no stored duration. */
  const durationMs = useMemo(() => {
    if (item.durationMs) return item.durationMs;
    return segments.reduce((max, segment) => Math.max(max, segment.endMs ?? 0), 0);
  }, [item.durationMs, segments]);

  const assetsByKind = useMemo(() => {
    const groups = new Map<string, EditorAsset[]>();
    for (const asset of assets) {
      const list = groups.get(asset.kind) ?? [];
      list.push(asset);
      groups.set(asset.kind, list);
    }
    return [...groups.entries()];
  }, [assets]);

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {/* Header. Kept inside the editor rather than using PageHeader: this
          surface needs a compact strip, not a display-scale hero, because the
          preview below it is the thing that should dominate. */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
            {editorCopy.eyebrow}
            {item.campaignName ? ` · ${item.campaignName}` : ""}
          </p>
          <h1 className="font-display mt-[var(--space-1)] truncate text-[length:var(--text-title)]">
            {item.title}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          {item.isMock && <Badge tone="warning">Demo output</Badge>}
          <StatusChip status={item.status} />

          {/* Autosave status. Reports the truth: nothing on this surface writes
              yet, so it states the last saved revision rather than claiming to
              be saving. */}
          <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
            {editorCopy.savedRevision(item.revision)}
          </span>

          <Button disabled title={editorCopy.actionUnavailable}>
            {editorCopy.approveLabel}
          </Button>
        </div>
      </div>

      {/* Pane switcher — narrow viewports only. */}
      <div
        role="group"
        aria-label={editorCopy.paneSwitcherLabel}
        className="flex gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] p-[var(--space-1)] xl:hidden"
      >
        {(["assets", "preview", "inspector"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={pane === option}
            onClick={() => setPane(option)}
            className={cn(
              "min-h-11 flex-1 rounded-[var(--radius-sm)] px-[var(--space-3)]",
              "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
              "transition-colors duration-[var(--dur-instant)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
              pane === option
                ? "bg-[var(--color-surface-3)] text-[color:var(--color-text-primary)]"
                : "text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]",
            )}
          >
            {editorCopy.paneLabels[option]}
          </button>
        ))}
      </div>

      <div className="grid gap-[var(--space-4)] xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
        {/* ---------- Left: assets ---------- */}
        <Panel
          pad="tight"
          className={cn("min-w-0", pane === "assets" ? "block" : "hidden xl:block")}
        >
          <h2 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
            {editorCopy.assetsHeading}
          </h2>

          {assetsByKind.length > 0 ? (
            <div className="mt-[var(--space-4)] flex flex-col gap-[var(--space-4)]">
              {assetsByKind.map(([kind, list]) => (
                <section key={kind}>
                  <h3 className="flex items-center gap-[var(--space-2)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                    <AssetKindIcon kind={kind} />
                    {ASSET_KIND_LABELS[kind] ?? kind}
                    <span className="ml-auto tabular-nums">{list.length}</span>
                  </h3>

                  <ul className="mt-[var(--space-2)] flex flex-col gap-[var(--space-1)]">
                    {list.map((asset) => (
                      <li
                        key={asset.id}
                        className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-[var(--space-2)] py-[var(--space-2)]"
                      >
                        <span className="block truncate text-[length:var(--text-app-meta)] text-[color:var(--color-text-primary)]">
                          {asset.filename ?? `${ASSET_KIND_LABELS[kind] ?? kind} asset`}
                        </span>
                        <span className="block font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                          {[
                            asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
                            asset.durationMs ? formatTimecode(asset.durationMs / 1000) : null,
                            asset.origin === "mock" ? "demo" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || asset.uploadState}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="mt-[var(--space-4)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
              {editorCopy.noAssets}
            </p>
          )}
        </Panel>

        {/* ---------- Centre: preview ---------- */}
        <div
          className={cn(
            "flex min-w-0 flex-col gap-[var(--space-4)]",
            pane === "preview" ? "flex" : "hidden xl:flex",
          )}
        >
          <Panel pad="tight" className="min-w-0">
            {/* Variant switcher. Real: each chip is a stored content_variant. */}
            {variants.length > 0 && (
              <div className="flex flex-wrap gap-[var(--space-2)]">
                {variants.map((variant) => {
                  const selected = variant.id === activeVariantId;
                  const platformLabel =
                    PLATFORM_OPTIONS.find((option) => option.id === variant.platform)?.label ??
                    variant.platform;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setActiveVariantId(variant.id)}
                      className={cn(
                        "flex min-h-11 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-3)]",
                        "text-[length:var(--text-app-meta)]",
                        "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                        selected
                          ? "border-2 border-[var(--color-action)] bg-[var(--color-action-wash)] px-[calc(var(--space-3)-1px)] text-[color:var(--color-text-primary)]"
                          : "border border-[var(--color-border-hairline)] text-[color:var(--color-text-secondary)] hover:border-[var(--color-border)]",
                      )}
                    >
                      {platformLabel}
                      <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                        {variant.aspectRatio}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* The preview well. An aspect-ratio box reserved at SSR so the
                layout never shifts once media arrives. */}
            <div
              className="mt-[var(--space-4)] flex items-center justify-center rounded-[var(--radius-lg)] bg-[var(--app-panel-inset)]"
              style={{
                aspectRatio: cssAspectRatio(activeVariant?.aspectRatio ?? "9:16"),
                maxHeight: "60vh",
              }}
            >
              {/* No fake frame. Until a render exists there is nothing to show,
                  and a placeholder poster would imply the video is ready. */}
              <div className="flex max-w-[24rem] flex-col items-center gap-[var(--space-3)] p-[var(--space-6)] text-center">
                <Clapperboard
                  aria-hidden="true"
                  size={24}
                  strokeWidth={1.5}
                  className="text-[color:var(--color-text-muted)]"
                />
                <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                  {activeVariant?.renderedAssetId
                    ? editorCopy.previewPending
                    : editorCopy.previewNotRendered}
                </p>
              </div>
            </div>

            {/* Transport. Disabled until there is media to play — a play button
                that does nothing is the clearest possible lie on this surface. */}
            <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-1)]">
                <TransportButton label={editorCopy.playLabel} disabled>
                  <Play aria-hidden="true" size={16} strokeWidth={1.5} />
                </TransportButton>
                <TransportButton label={editorCopy.pauseLabel} disabled>
                  <Pause aria-hidden="true" size={16} strokeWidth={1.5} />
                </TransportButton>
                <TransportButton label={editorCopy.fullscreenLabel} disabled>
                  <Maximize2 aria-hidden="true" size={16} strokeWidth={1.5} />
                </TransportButton>
              </div>

              <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                {formatTimecode(0)} / {formatTimecode(durationMs / 1000)}
              </span>

              {activeVariant?.width && activeVariant.height && (
                <span className="font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                  {activeVariant.width}×{activeVariant.height}
                </span>
              )}

              <span className="ml-auto font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
                {editorCopy.transportUnavailable}
              </span>
            </div>
          </Panel>

          {/* ---------- Timeline ---------- */}
          <Panel pad="tight" className="min-w-0">
            <h2 className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-secondary)]">
              {editorCopy.timelineHeading}
            </h2>

            {segments.length > 0 && durationMs > 0 ? (
              <div className="mt-[var(--space-4)] flex flex-col gap-[var(--space-2)]">
                {/* Tracks. Each is a real row of script segments positioned by
                    their stored start/end times — a drawn ruler, not a mock. */}
                <TimelineTrack
                  label={editorCopy.trackLabels.script}
                  icon={<Type aria-hidden="true" size={12} strokeWidth={1.5} />}
                  segments={segments}
                  durationMs={durationMs}
                />
                <TimelineTrack
                  label={editorCopy.trackLabels.voice}
                  icon={<Volume2 aria-hidden="true" size={12} strokeWidth={1.5} />}
                  segments={segments.filter((segment) => segment.role !== "caption")}
                  durationMs={durationMs}
                  tone="signal"
                />

                {/* The DOM equivalent of the drawing above. The tracks are
                    aria-hidden, so this list is what assistive technology reads. */}
                <details className="mt-[var(--space-2)]">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] [&::-webkit-details-marker]:hidden">
                    {editorCopy.segmentListLabel}
                  </summary>
                  <ol className="mt-[var(--space-3)] flex flex-col gap-[var(--space-2)]">
                    {segments.map((segment) => (
                      <li
                        key={`${segment.position}-${segment.startMs ?? 0}`}
                        className="flex gap-[var(--space-3)] border-t border-[var(--color-border-hairline)] pt-[var(--space-2)]"
                      >
                        <span className="shrink-0 font-utility text-[length:var(--text-utility-xs)] tabular-nums text-[color:var(--color-text-muted)]">
                          {formatTimecode((segment.startMs ?? 0) / 1000)}
                        </span>
                        <span className="min-w-0 text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
                          {segment.text}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            ) : (
              <p className="mt-[var(--space-4)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
                {editorCopy.noTimeline}
              </p>
            )}
          </Panel>
        </div>

        {/* ---------- Right: inspector ---------- */}
        <Panel
          pad="tight"
          className={cn("min-w-0", pane === "inspector" ? "block" : "hidden xl:block")}
        >
          {/* Real tablist semantics: arrow keys are what a tab group is expected
              to support, and `role="tab"` without them is worse than buttons. */}
          <div role="tablist" aria-label={editorCopy.inspectorHeading} className="flex flex-wrap gap-[var(--space-1)]">
            {INSPECTOR_TABS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                id={`inspector-tab-${option.id}`}
                aria-selected={tab === option.id}
                aria-controls={`inspector-panel-${option.id}`}
                tabIndex={tab === option.id ? 0 : -1}
                onClick={() => setTab(option.id)}
                onKeyDown={(event) => {
                  const index = INSPECTOR_TABS.findIndex((entry) => entry.id === tab);
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const delta = event.key === "ArrowRight" ? 1 : -1;
                    const next =
                      INSPECTOR_TABS[(index + delta + INSPECTOR_TABS.length) % INSPECTOR_TABS.length];
                    if (next) {
                      setTab(next.id);
                      document.getElementById(`inspector-tab-${next.id}`)?.focus();
                    }
                  }
                }}
                className={cn(
                  "min-h-9 rounded-[var(--radius-sm)] px-[var(--space-2)]",
                  "font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)]",
                  "transition-colors duration-[var(--dur-instant)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                  tab === option.id
                    ? "bg-[var(--color-surface-3)] text-[color:var(--color-text-primary)]"
                    : "text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`inspector-panel-${tab}`}
            aria-labelledby={`inspector-tab-${tab}`}
            className="mt-[var(--space-4)]"
          >
            <InspectorPanel
              tab={tab}
              item={item}
              variant={activeVariant}
              segments={segments}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** One timeline track. `aria-hidden`; the segment list carries the content. */
function TimelineTrack({
  label,
  icon,
  segments,
  durationMs,
  tone = "neutral",
}: {
  label: string;
  icon: React.ReactNode;
  segments: readonly EditorSegment[];
  durationMs: number;
  tone?: "neutral" | "signal";
}) {
  return (
    <div className="flex items-center gap-[var(--space-3)]">
      <span className="flex w-[5.5rem] shrink-0 items-center gap-[var(--space-2)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
        {icon}
        {label}
      </span>

      <div
        aria-hidden="true"
        className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--app-panel-inset)]"
      >
        {segments.map((segment) => {
          const start = ((segment.startMs ?? 0) / durationMs) * 100;
          const end = ((segment.endMs ?? segment.startMs ?? 0) / durationMs) * 100;
          const width = Math.max(1.5, end - start);
          return (
            <span
              key={`${segment.position}-${segment.startMs ?? 0}`}
              className={cn(
                "absolute top-1 bottom-1 rounded-[var(--radius-sm)]",
                // A 2px surface gap between clips, so adjacent segments read as
                // separate rather than as one long block.
                "border-2 border-[var(--app-panel-inset)]",
                tone === "signal"
                  ? "bg-[var(--color-signal-wash)]"
                  : "bg-[var(--color-surface-3)]",
              )}
              style={{ left: `${start}%`, width: `${width}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

function TransportButton({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? editorCopy.transportUnavailable : label}
      className={cn(
        "flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-sm)]",
        "border border-[var(--color-border-hairline)] text-[color:var(--color-text-secondary)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:border-[var(--color-border)] hover:text-[color:var(--color-text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function InspectorPanel({
  tab,
  item,
  variant,
  segments,
}: {
  tab: InspectorTabId;
  item: EditorItem;
  variant: EditorVariant | null;
  segments: readonly EditorSegment[];
}) {
  if (tab === "script") {
    return segments.length > 0 ? (
      <ol className="flex flex-col gap-[var(--space-3)]">
        {segments.map((segment) => (
          <li key={`${segment.position}-${segment.startMs ?? 0}`}>
            <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {segment.role ?? "line"} · {formatTimecode((segment.startMs ?? 0) / 1000)}
            </p>
            <p className="mt-[var(--space-1)] text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-secondary)]">
              {segment.text}
            </p>
          </li>
        ))}
      </ol>
    ) : (
      <InspectorEmpty message={editorCopy.noScript} />
    );
  }

  if (tab === "caption") {
    const caption = variant?.captionOverride ?? item.caption;
    return caption ? (
      <>
        <p className="whitespace-pre-wrap text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-secondary)]">
          {caption}
        </p>
        {variant?.captionOverride && (
          <p className="mt-[var(--space-3)] font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-action)]">
            {editorCopy.captionOverridden}
          </p>
        )}
        {item.callToAction && (
          <div className="mt-[var(--space-4)] border-t border-[var(--color-border-hairline)] pt-[var(--space-3)]">
            <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {editorCopy.ctaLabel}
            </p>
            <p className="mt-[var(--space-1)] text-[length:var(--text-app-meta)] text-[color:var(--color-text-secondary)]">
              {item.callToAction}
            </p>
          </div>
        )}
      </>
    ) : (
      <InspectorEmpty message={editorCopy.noCaption} />
    );
  }

  if (tab === "format") {
    return (
      <dl className="flex flex-col gap-[var(--space-3)]">
        <InspectorRow label="Item format" value={item.typeLabel} />
        <InspectorRow label="Language" value={item.language.toUpperCase()} />
        {variant ? (
          <>
            <InspectorRow
              label="Platform"
              value={
                PLATFORM_OPTIONS.find((option) => option.id === variant.platform)?.label ??
                variant.platform
              }
            />
            <InspectorRow label="Aspect ratio" value={variant.aspectRatio} />
            <InspectorRow
              label="Resolution"
              value={
                variant.width && variant.height ? `${variant.width}×${variant.height}` : "Not set"
              }
            />
            <InspectorRow label="Variant language" value={variant.language.toUpperCase()} />
          </>
        ) : (
          <p className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
            {editorCopy.noVariants}
          </p>
        )}
      </dl>
    );
  }

  // Voice, music, branding and export all depend on the render pipeline, so
  // rather than four fake panels they share one honest statement of what they
  // will hold and what is blocking them.
  return <InspectorEmpty message={editorCopy.inspectorPending[tab]} />;
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)]">
      <dt className="text-[length:var(--text-app-meta)] text-[color:var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="font-utility text-[length:var(--text-app-meta)] tabular-nums text-[color:var(--color-text-primary)]">
        {value}
      </dd>
    </div>
  );
}

function InspectorEmpty({ message }: { message: string }) {
  return (
    <p className="text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
      {message}
    </p>
  );
}

function AssetKindIcon({ kind }: { kind: string }) {
  const shared = "text-[color:var(--color-text-muted)]";
  if (kind.includes("video")) return <Film aria-hidden="true" size={12} strokeWidth={1.5} className={shared} />;
  if (kind.includes("image") || kind === "thumbnail")
    return <ImageIcon aria-hidden="true" size={12} strokeWidth={1.5} className={shared} />;
  if (kind === "music") return <Music aria-hidden="true" size={12} strokeWidth={1.5} className={shared} />;
  if (kind === "voiceover" || kind === "audio")
    return <Volume2 aria-hidden="true" size={12} strokeWidth={1.5} className={shared} />;
  return <Layers aria-hidden="true" size={12} strokeWidth={1.5} className={shared} />;
}

/**
 * Maps a stored aspect-ratio string to a CSS `aspect-ratio` value.
 *
 * `custom` has no fixed shape, so it falls back to the vertical default rather
 * than producing an invalid declaration that collapses the preview box.
 */
function cssAspectRatio(ratio: string): string {
  if (ratio === "custom") return "9 / 16";
  const [width, height] = ratio.split(":");
  return width && height ? `${width} / ${height}` : "9 / 16";
}
