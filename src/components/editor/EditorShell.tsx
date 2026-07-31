"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
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
import { Card, CardBody, CardHeader } from "@/components/app-ui/Card";
import { StatusChip } from "@/components/app-ui/StatusChip";
import { Button } from "@/components/primitives/Button";
import { ASSET_KIND_LABELS } from "@/content/content-library";
import { PLATFORM_OPTIONS } from "@/content/create";
import {
  editorCopy,
  INSPECTOR_TABS,
  SEGMENT_ROLE_LABELS,
  type InspectorTabId,
} from "@/content/editor";

/**
 * The content editing suite.
 *
 * Four regions: assets left, the preview centre, the inspector right, the
 * timeline spanning all three below. That arrangement is borrowed from NLE tools
 * because it matches the task — you pick a source, watch the result, adjust a
 * property, and scrub time — not because it looks professional.
 *
 * The chrome is light like the rest of the product. The preview canvas is the one
 * exception, and it is not a style choice: a light surround raises the perceived
 * black level of the video inside it, so footage judged on a white well reads
 * washed out and a colour decision made there is wrong. Every editing tool puts
 * the canvas on near-black for that reason.
 *
 * What this deliberately is NOT: a working video editor. Nothing here renders,
 * seeks or mutates, because the render pipeline is a queued job and the mutation
 * actions are part of a later phase. Every control that would need that backing
 * is present but disabled with a stated reason, rather than being wired to a
 * handler that silently does nothing. The panels, variant switching, timeline
 * reading and inspector are real and read real rows.
 *
 * Below `lg` the three side regions collapse into a single switchable panel —
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

const MOBILE_PANES = ["assets", "preview", "inspector"] as const;

/** Tallest the preview canvas may grow, so the transport stays above the fold. */
const PREVIEW_MAX_HEIGHT = "56vh";

/**
 * Visibility for one of the three side regions.
 *
 * `flex` appears only in the conditional branch. Pairing a base `flex` with
 * `hidden` would leave the display conflict to Tailwind's stylesheet ordering
 * instead of stating which one applies.
 */
function paneClasses(region: MobilePane, active: MobilePane): string {
  return cn("min-w-0 flex-col", region === active ? "flex" : "hidden lg:flex");
}

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
  const previewRatio = activeVariant?.aspectRatio ?? "9:16";

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
    <div className="flex flex-col gap-[var(--app-panel-gap)]">
      <EditorHeader item={item} />

      {/* Pane switcher — narrow viewports only. A segmented control on the muted
          track, matching the grid/table toggle on the list pages. */}
      <div
        role="group"
        aria-label={editorCopy.paneSwitcherLabel}
        className="flex gap-0.5 rounded-[var(--radius-control)] bg-[var(--surface-muted)] p-0.5 lg:hidden"
      >
        {MOBILE_PANES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={pane === option}
            onClick={() => setPane(option)}
            className={cn(
              "h-8 flex-1 rounded-[var(--radius-chip)] px-[var(--space-3)]",
              "text-[length:var(--text-app-cell)]",
              "transition-colors duration-[var(--dur-instant)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              pane === option
                ? "bg-[var(--surface-primary)] font-[var(--weight-strong)] text-[color:var(--text-primary)] shadow-[var(--elevation-card)]"
                : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]",
            )}
          >
            {editorCopy.paneLabels[option]}
          </button>
        ))}
      </div>

      {/*
        The timeline is a fourth region spanning the full width rather than a panel
        inside the preview column: a track is read against absolute time, and a
        ruler cropped to the centre column loses the resolution that makes it worth
        drawing. It stays visible at every width because it is the one region that
        works in a short, wide box.
      */}
      <div className="grid gap-[var(--app-panel-gap)] lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
        {/* ---------- Left: assets ---------- */}
        <Card className={paneClasses("assets", pane)}>
          <CardHeader
            as="h2"
            divided
            title={editorCopy.assetsHeading}
            action={<Count value={assets.length} />}
          />
          <CardBody pad="tight" className="min-w-0">
            {assetsByKind.length > 0 ? (
              <div className="flex flex-col gap-[var(--space-4)]">
                {assetsByKind.map(([kind, list]) => (
                  <section key={kind}>
                    <h3 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--text-secondary)]">
                      <AssetKindIcon kind={kind} />
                      <span className="min-w-0 truncate">
                        {ASSET_KIND_LABELS[kind] ?? kind}
                      </span>
                      <span className="app-figure ml-auto text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                        {list.length}
                      </span>
                    </h3>

                    <ul className="mt-[var(--space-2)] flex flex-col gap-1">
                      {list.map((asset) => (
                        <li
                          key={asset.id}
                          className={cn(
                            "rounded-[var(--radius-chip)] border border-[var(--border-subtle)]",
                            "bg-[var(--surface-secondary)] px-[var(--space-2)] py-1.5",
                          )}
                        >
                          <span className="block truncate text-[length:var(--text-app-meta)] text-[color:var(--text-primary)]">
                            {asset.filename ?? `${ASSET_KIND_LABELS[kind] ?? kind} asset`}
                          </span>
                          <span className="app-figure block truncate text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                            {[
                              asset.width && asset.height
                                ? `${asset.width}×${asset.height}`
                                : null,
                              asset.durationMs ? formatTimecode(asset.durationMs / 1000) : null,
                              asset.origin === "mock" ? editorCopy.demoLabel : null,
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
              <PanelNote message={editorCopy.noAssets} />
            )}
          </CardBody>
        </Card>

        {/* ---------- Centre: preview ---------- */}
        <Card className={paneClasses("preview", pane)}>
          {/* Variant switcher. Real: each chip is a stored content_variant. */}
          {variants.length > 0 && (
            <div
              role="group"
              aria-label={editorCopy.variantSwitcherLabel}
              className={cn(
                "flex flex-wrap gap-[var(--space-1)] border-b border-[var(--border-subtle)]",
                "px-[var(--app-panel-pad-tight)] py-[var(--space-2)]",
              )}
            >
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
                      "flex h-8 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-3)]",
                      "text-[length:var(--text-app-cell)]",
                      "transition-colors duration-[var(--dur-instant)] ease-[var(--ease-cut)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                      selected
                        ? "bg-[var(--brand-soft)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]"
                        : "text-[color:var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                    )}
                  >
                    {platformLabel}
                    <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                      {variant.aspectRatio}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <CardBody pad="tight" className="flex min-w-0 flex-1 flex-col">
            {/*
              The canvas. Near-black, and the ONE dark surface in the product.

              `--text-primary` is the fill because the theme has no `--media-canvas`
              token and the darkest ink in the ramp is the closest honest thing to
              one. Contrast duties invert with it: text uses `--text-on-brand`
              (16.29:1 against this fill), never `--text-secondary`, which measures
              2.10:1 here — the pairings have to be re-derived, not carried over.

              The aspect box is reserved at SSR so the layout never shifts once
              media arrives.
            */}
            <div
              className="flex w-full items-center justify-center self-center overflow-hidden rounded-[var(--radius-control)] bg-[var(--media-canvas)]"
              style={{
                aspectRatio: cssAspectRatio(previewRatio),
                // Capped by HEIGHT, expressed as a max-width, so the ratio always
                // holds. Setting `maxHeight` alongside a full-width aspect box
                // over-constrains it: the browser keeps the width and drops the
                // ratio, which turns a 9:16 variant's well into a landscape box with
                // the portrait frame floating inside it. Deriving the width instead
                // gives a real portrait canvas with light chrome either side.
                maxWidth: `calc(${PREVIEW_MAX_HEIGHT} * ${ratioFraction(previewRatio)})`,
              }}
            >
              {/* No fake frame. Until a render exists there is nothing to show,
                  and a placeholder poster would imply the video is ready. */}
              <div className="flex max-w-[26rem] flex-col items-center gap-[var(--space-3)] p-[var(--space-6)] text-center">
                <Clapperboard
                  aria-hidden="true"
                  size={22}
                  strokeWidth={1.5}
                  // A mark token on a decorative glyph: 4.35:1 on the fill, which
                  // clears the graphical-object floor and carries no text.
                  className="text-[color:var(--brand-mark)]"
                />
                <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-on-brand)]">
                  {activeVariant?.renderedAssetId
                    ? editorCopy.previewPending
                    : editorCopy.previewNotRendered}
                </p>
              </div>
            </div>

            {/* Transport. Disabled until there is media to play — a play button
                that does nothing is the clearest possible lie on this surface. */}
            <div className="mt-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-3)]">
              {/*
                `gap-2` is load-bearing. Each 36px icon button carries a transparent
                44px hit target, which overhangs 4px per side; an 8px gap makes two
                neighbouring targets meet exactly instead of overlapping, so no
                button steals its neighbour's clicks.
              */}
              <div className="flex items-center gap-[var(--space-2)]">
                <TransportButton label={editorCopy.playLabel} disabled>
                  <Play aria-hidden="true" size={15} strokeWidth={1.75} />
                </TransportButton>
                <TransportButton label={editorCopy.pauseLabel} disabled>
                  <Pause aria-hidden="true" size={15} strokeWidth={1.75} />
                </TransportButton>
                <TransportButton label={editorCopy.fullscreenLabel} disabled>
                  <Maximize2 aria-hidden="true" size={15} strokeWidth={1.75} />
                </TransportButton>
              </div>

              <span className="app-figure text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
                {formatTimecode(0)} / {formatTimecode(durationMs / 1000)}
              </span>

              {/* Compared against null rather than truthiness: a 0 would render as
                  the literal string "0" beside the timecode. */}
              {activeVariant !== null &&
                activeVariant.width !== null &&
                activeVariant.height !== null && (
                  <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                    {activeVariant.width}×{activeVariant.height}
                  </span>
                )}

              <span className="ml-auto text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                {editorCopy.transportUnavailable}
              </span>
            </div>
          </CardBody>
        </Card>

        {/* ---------- Right: inspector ---------- */}
        <Card className={paneClasses("inspector", pane)}>
          {/* Real tablist semantics: arrow keys are what a tab group is expected
              to support, and `role="tab"` without them is worse than buttons. */}
          <div
            role="tablist"
            aria-label={editorCopy.inspectorHeading}
            className={cn(
              "flex flex-wrap gap-1 border-b border-[var(--border-subtle)]",
              "px-[var(--app-panel-pad-tight)] py-[var(--space-2)]",
            )}
          >
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
                      INSPECTOR_TABS[
                        (index + delta + INSPECTOR_TABS.length) % INSPECTOR_TABS.length
                      ];
                    if (next) {
                      setTab(next.id);
                      document.getElementById(`inspector-tab-${next.id}`)?.focus();
                    }
                  }
                }}
                className={cn(
                  "h-8 rounded-[var(--radius-chip)] px-[var(--space-2)]",
                  "text-[length:var(--text-app-cell)]",
                  "transition-colors duration-[var(--dur-instant)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                  tab === option.id
                    ? "bg-[var(--brand-soft)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]"
                    : "text-[color:var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* The tabpanel role lives on an inner div rather than on `CardBody`,
              which renders its own element and forwards no attributes. */}
          <CardBody pad="tight" className="min-w-0 flex-1">
            <div
              role="tabpanel"
              id={`inspector-panel-${tab}`}
              aria-labelledby={`inspector-tab-${tab}`}
            >
              <InspectorPanel tab={tab} item={item} variant={activeVariant} segments={segments} />
            </div>
          </CardBody>
        </Card>

        {/* ---------- Timeline ---------- */}
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader
            as="h2"
            divided
            title={editorCopy.timelineHeading}
            action={
              durationMs > 0 ? (
                <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                  {formatTimecode(durationMs / 1000)}
                </span>
              ) : undefined
            }
          />

          <CardBody pad="tight" className="min-w-0">
            {segments.length > 0 && durationMs > 0 ? (
              <div className="flex flex-col gap-[var(--space-2)]">
                <TimelineRuler durationMs={durationMs} />

                {/* Tracks. Each is a real row of script segments positioned by
                    their stored start/end times — a drawn ruler, not a mock. */}
                <TimelineTrack
                  label={editorCopy.trackLabels.script}
                  icon={<Type aria-hidden="true" size={12} strokeWidth={1.75} />}
                  segments={segments}
                  durationMs={durationMs}
                />
                <TimelineTrack
                  label={editorCopy.trackLabels.voice}
                  icon={<Volume2 aria-hidden="true" size={12} strokeWidth={1.75} />}
                  segments={segments.filter((segment) => segment.role !== "caption")}
                  durationMs={durationMs}
                  tone="signal"
                />

                {/* The DOM equivalent of the drawing above. The tracks are
                    aria-hidden, so this list is what assistive technology reads. */}
                <details className="mt-[var(--space-1)]">
                  <summary
                    className={cn(
                      "inline-flex h-8 cursor-pointer list-none items-center rounded-[var(--radius-chip)]",
                      "text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]",
                      "transition-colors duration-[var(--dur-instant)]",
                      "hover:text-[color:var(--text-primary)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                      "[&::-webkit-details-marker]:hidden",
                    )}
                  >
                    {editorCopy.segmentListLabel}
                  </summary>
                  <ol className="mt-[var(--space-2)] flex flex-col">
                    {segments.map((segment) => (
                      <li
                        key={`${segment.position}-${segment.startMs ?? 0}`}
                        className="flex gap-[var(--space-4)] border-t border-[var(--border-subtle)] py-[var(--space-2)]"
                      >
                        <span className="app-figure w-[4.5rem] shrink-0 text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
                          {formatTimecode((segment.startMs ?? 0) / 1000)}
                        </span>
                        {/* Dropped below `sm`: a timecode column plus a role column
                            plus the line leaves the line itself about 150px at
                            390px, and the line is the content. */}
                        <span className="hidden w-[5.5rem] shrink-0 text-[length:var(--text-app-label)] text-[color:var(--text-muted)] sm:block">
                          {segment.role ? SEGMENT_ROLE_LABELS[segment.role] ?? segment.role : ""}
                        </span>
                        <span className="min-w-0 text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                          {segment.text}
                        </span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            ) : (
              <PanelNote message={editorCopy.noTimeline} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/**
 * The editor's command strip.
 *
 * Deliberately not `PageHeader`: this surface's `<h1>` sits at section-title size
 * rather than page-title size, because the preview below it is what should
 * dominate and a 32px headline above a video canvas competes with it. Heading
 * LEVEL is still h1 — the size is a visual decision, not a semantic one.
 */
function EditorHeader({ item }: { item: EditorItem }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-[var(--space-2)] text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
          <Link
            href="/app/content"
            className={cn(
              "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-chip)]",
              "transition-colors duration-[var(--dur-instant)]",
              "hover:text-[color:var(--text-primary)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
            )}
          >
            <ArrowLeft aria-hidden="true" size={13} strokeWidth={2} />
            {editorCopy.backToContent}
          </Link>

          {item.campaignId && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={`/app/campaigns/${item.campaignId}`}
                className={cn(
                  "min-w-0 truncate rounded-[var(--radius-chip)]",
                  "transition-colors duration-[var(--dur-instant)]",
                  "hover:text-[color:var(--text-primary)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
                )}
              >
                {item.campaignName ?? "Campaign"}
              </Link>
            </>
          )}
        </p>

        <h1 className="app-section-title mt-0.5 truncate text-[color:var(--text-primary)]">
          {item.title}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        {item.isMock && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-[var(--radius-chip)]",
              "bg-[var(--warning-soft)] px-2 py-1",
              "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
              "text-[color:var(--warning)]",
            )}
          >
            {editorCopy.demoLabel}
          </span>
        )}
        <StatusChip status={item.status} />

        {/*
          Autosave status. Reports the truth: nothing on this surface writes yet, so
          it states the last saved revision rather than claiming to be saving.

          Deliberately not "saved 2 hours ago". This is a client component, so the
          server and the browser would each format `item.updatedAt` against their own
          clock and locale — which for anything older than a week resolves through
          `Intl.DateTimeFormat` in two different time zones and hydrates as a
          mismatch. A revision number is the same string on both sides.
        */}
        <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
          {editorCopy.savedRevision(item.revision)}
        </span>

        <Button disabled title={editorCopy.actionUnavailable}>
          {editorCopy.approveLabel}
        </Button>
      </div>
    </header>
  );
}

/** A count beside a panel heading. */
function Count({ value }: { value: number }) {
  return (
    <span className="app-figure text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
      {value}
    </span>
  );
}

/**
 * The timeline's time axis.
 *
 * `aria-hidden`: it is the scale for a drawing that is itself aria-hidden, and the
 * segment list below carries every timecode as text. Five marks rather than a
 * dense ruler — this is a reading aid, not a scrub target, because nothing seeks.
 */
function TimelineRuler({ durationMs }: { durationMs: number }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-[var(--space-3)]">
      {/* Matches the track labels' width so the scale lines up with the bars. */}
      <span className="w-[5.5rem] shrink-0" />
      <div className="relative h-4 min-w-0 flex-1">
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const edge = fraction === 0 || fraction === 1;
          return (
            <span
              key={fraction}
              className={cn(
                "app-figure absolute top-0 text-[length:var(--text-app-label-xs)]",
                "text-[color:var(--text-muted)]",
                fraction === 0 && "left-0",
                fraction === 1 && "right-0",
                !edge && "-translate-x-1/2",
                // The quarter marks drop out below `sm`. Five eight-character
                // timecodes need about 260px of track and a 390px viewport leaves
                // roughly 230px, so all five would overlap into an unreadable smear.
                fraction === 0.25 || fraction === 0.75 ? "hidden sm:block" : undefined,
              )}
              style={edge ? undefined : { left: `${fraction * 100}%` }}
            >
              {formatTimecode((durationMs * fraction) / 1000)}
            </span>
          );
        })}
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
      <span className="flex w-[5.5rem] shrink-0 items-center gap-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]">
        <span aria-hidden="true" className="text-[color:var(--text-muted)]">
          {icon}
        </span>
        {label}
      </span>

      <div
        aria-hidden="true"
        className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-chip)] bg-[var(--surface-muted)]"
      >
        {segments.map((segment) => {
          const start = ((segment.startMs ?? 0) / durationMs) * 100;
          const end = ((segment.endMs ?? segment.startMs ?? 0) / durationMs) * 100;
          const width = Math.max(1.5, end - start);
          return (
            <span
              key={`${segment.position}-${segment.startMs ?? 0}`}
              className={cn(
                "absolute top-1 bottom-1 rounded-[var(--radius-chip)]",
                // A 2px track-coloured stroke between clips, so adjacent segments
                // read as separate rather than as one long block.
                "border-2 border-[var(--surface-muted)]",
                // Both tones are teal: the two tracks describe the same work. The
                // voice track is the solid mark because it is the one the timings
                // are actually derived from, so it should read as the denser row.
                tone === "signal"
                  ? "bg-[var(--brand-mark)]"
                  : "bg-[var(--brand-soft)] shadow-[inset_0_0_0_1px_var(--brand-soft-border)]",
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
        "relative flex size-9 items-center justify-center rounded-[var(--radius-control)]",
        "border border-[var(--border-default)] bg-[var(--surface-primary)]",
        "text-[color:var(--text-secondary)]",
        "transition-colors duration-[var(--dur-instant)]",
        "hover:border-[var(--border-strong)] hover:text-[color:var(--text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border-default)]",
        // Icon-only and under 44px, so the paint stays 36px and a transparent
        // pseudo-element brings the hit area up to the target floor.
        "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
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
      <ol className="flex flex-col">
        {segments.map((segment, index) => (
          <li
            key={`${segment.position}-${segment.startMs ?? 0}`}
            className={cn(index > 0 && "border-t border-[var(--border-subtle)] pt-[var(--space-3)] mt-[var(--space-3)]")}
          >
            <p className="flex items-baseline justify-between gap-[var(--space-2)] text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              <span className="font-[var(--weight-strong)]">
                {segment.role ? SEGMENT_ROLE_LABELS[segment.role] ?? segment.role : "Line"}
              </span>
              <span className="app-figure">
                {formatTimecode((segment.startMs ?? 0) / 1000)}
              </span>
            </p>
            <p className="mt-1 text-[length:var(--text-app-cell)] leading-[var(--leading-snug)] text-[color:var(--text-secondary)]">
              {segment.text}
            </p>
          </li>
        ))}
      </ol>
    ) : (
      <PanelNote message={editorCopy.noScript} />
    );
  }

  if (tab === "caption") {
    const caption = variant?.captionOverride ?? item.caption;
    return caption ? (
      <>
        <p className="whitespace-pre-wrap text-[length:var(--text-app-cell)] leading-[var(--leading-snug)] text-[color:var(--text-secondary)]">
          {caption}
        </p>
        {variant?.captionOverride && (
          <p className="mt-[var(--space-3)] text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--brand-primary)]">
            {editorCopy.captionOverridden}
          </p>
        )}
        {item.callToAction && (
          <div className="mt-[var(--space-4)] border-t border-[var(--border-subtle)] pt-[var(--space-3)]">
            <p className="text-[length:var(--text-app-label)] font-[var(--weight-strong)] text-[color:var(--text-muted)]">
              {editorCopy.ctaLabel}
            </p>
            <p className="mt-1 text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
              {item.callToAction}
            </p>
          </div>
        )}
      </>
    ) : (
      <PanelNote message={editorCopy.noCaption} />
    );
  }

  if (tab === "format") {
    return (
      <>
        <dl className="flex flex-col gap-[var(--space-2)]">
          <InspectorRow label="Item format" value={item.typeLabel} />
          <InspectorRow label="Language" value={item.language.toUpperCase()} />
          {variant && (
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
                  variant.width && variant.height
                    ? `${variant.width}×${variant.height}`
                    : "Not set"
                }
              />
              <InspectorRow label="Variant language" value={variant.language.toUpperCase()} />
            </>
          )}
        </dl>

        {/* Outside the list, not inside it. A `<dl>` may only contain dt/dd/div,
            so a bare paragraph in there is invalid markup and the accessibility
            tree drops it out of the list. */}
        {!variant && (
          <p className="mt-[var(--space-3)] text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--text-muted)]">
            {editorCopy.noVariants}
          </p>
        )}
      </>
    );
  }

  // Voice, music, branding and export all depend on the render pipeline, so
  // rather than four fake panels they share one honest statement of what they
  // will hold and what is blocking them.
  return <PanelNote message={editorCopy.inspectorPending[tab]} />;
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)]">
      <dt className="text-[length:var(--text-app-cell)] text-[color:var(--text-muted)]">
        {label}
      </dt>
      <dd className="app-figure text-[length:var(--text-app-cell)] font-[var(--weight-strong)] text-[color:var(--text-primary)]">
        {value}
      </dd>
    </div>
  );
}

/** A stated reason a region is empty. One sentence, quiet, never an error. */
function PanelNote({ message }: { message: string }) {
  return (
    <p className="text-[length:var(--text-app-meta)] leading-[var(--leading-snug)] text-[color:var(--text-muted)]">
      {message}
    </p>
  );
}

function AssetKindIcon({ kind }: { kind: string }) {
  const shared = "shrink-0 text-[color:var(--text-muted)]";
  if (kind.includes("video"))
    return <Film aria-hidden="true" size={13} strokeWidth={1.75} className={shared} />;
  if (kind.includes("image") || kind === "thumbnail")
    return <ImageIcon aria-hidden="true" size={13} strokeWidth={1.75} className={shared} />;
  if (kind === "music")
    return <Music aria-hidden="true" size={13} strokeWidth={1.75} className={shared} />;
  if (kind === "voiceover" || kind === "audio")
    return <Volume2 aria-hidden="true" size={13} strokeWidth={1.75} className={shared} />;
  return <Layers aria-hidden="true" size={13} strokeWidth={1.75} className={shared} />;
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

/** The same ratio as a number, for sizing the canvas by its height. */
function ratioFraction(ratio: string): number {
  if (ratio === "custom") return 9 / 16;
  const [width, height] = ratio.split(":").map(Number);
  return width && height ? width / height : 9 / 16;
}
