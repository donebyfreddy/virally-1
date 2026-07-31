import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  ArrowRight,
  Cpu,
  FileText,
  Film,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Music,
  Plus,
  TriangleAlert,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { campaigns, contentItems, mediaAssets } from "@/lib/db/schema.fragment";
import { getStorageAdapter, type StorageBucket } from "@/lib/storage";
import { formatDuration, relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage, PageStack } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Card, CardBody, CardFooter, CardHeader, KpiCard, KpiGrid } from "@/components/app-ui/Card";
import { CellThumb, DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { CategoryBars } from "@/components/app-ui/charts/CategoryBars";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { ASSET_KIND_LABELS, ASSET_KIND_OPTIONS, libraryCopy } from "@/content/content-library";

export const metadata: Metadata = {
  title: "Library",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;
const countFormatter = new Intl.NumberFormat("en-US");
const centsFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" });

/**
 * Preview URL lifetime.
 *
 * Longer than the adapter's 5-minute default, matching /app/content: this page is
 * `force-dynamic`, so a user who opens it and scrolls back several minutes later
 * would otherwise hit expired URLs across the whole grid.
 */
const PREVIEW_TTL_SECONDS = 900;

const VALID_KINDS = new Set<string>(ASSET_KIND_OPTIONS.map((option) => option.id));
const VALID_SOURCES = new Set<string>(libraryCopy.sources.map((option) => option.id));
const VALID_STATES = new Set<string>(libraryCopy.states.map((option) => option.id));
const VALID_SORTS = new Set<string>(libraryCopy.sorts.map((option) => option.id));

const SOURCE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  libraryCopy.sources.map((option) => [option.id, option.label]),
);
const STATE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  libraryCopy.states.map((option) => [option.id, option.label]),
);

/** Origins whose bytes are stand-ins rather than a real generation or upload. */
const DEMO_ORIGINS = new Set(["mock", "seeded_demo"]);
/** Origins that came out of a generation provider, so a cost figure is meaningful. */
const GENERATED_ORIGINS = new Set(["provider", "mock", "seeded_demo"]);

/**
 * Kinds whose object is itself a still image.
 *
 * Consulted only when `mime_type` is null. A kind of `image` with no recorded MIME
 * type is still an image; a kind of `source_video` never is, and pointing an
 * `<img>` at an mp4 renders a broken-image glyph.
 */
const IMAGE_KINDS = new Set(["image", "generated_image", "thumbnail"]);

const posterAssets = alias(mediaAssets, "poster_assets");

type AssetRow = {
  id: string;
  kind: string;
  filename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  codec: string | null;
  origin: string;
  uploadState: string;
  scanState: string;
  bucket: StorageBucket;
  storagePath: string;
  createdAt: Date;
  updatedAt: Date;
  provider: string | null;
  providerModel: string | null;
  generationCostCents: number;
  checksum: string | null;
  campaignId: string | null;
  campaignName: string | null;
  contentItemId: string | null;
  contentItemTitle: string | null;
  /** Poster frame for a video, already filtered to a readable object. */
  posterBucket: StorageBucket | null;
  posterPath: string | null;
};

type AssetCard = AssetRow & { previewUrl: string | null };

/**
 * The object a preview `<img>` should point at, or null when there is none.
 *
 * Three gates, all of them honest rather than defensive:
 *
 *   - `upload_state = 'ready'` — a row exists before its bytes do, so signing a
 *     `pending` asset produces a URL that 404s.
 *   - `scan_state <> 'rejected'` — media the moderation pass rejected is not
 *     rendered back into the product.
 *   - the object has to be an image. A video's own object is not, so a video only
 *     gets a preview through `poster_asset_id`, which exists for exactly this.
 */
function previewTarget(row: {
  kind: string;
  mimeType: string | null;
  uploadState: string;
  scanState: string;
  bucket: StorageBucket;
  storagePath: string;
  posterBucket: StorageBucket | null;
  posterPath: string | null;
}): { bucket: StorageBucket; path: string } | null {
  const isImage = row.mimeType ? row.mimeType.startsWith("image/") : IMAGE_KINDS.has(row.kind);
  if (isImage && row.uploadState === "ready" && row.scanState !== "rejected") {
    return { bucket: row.bucket, path: row.storagePath };
  }
  if (row.posterBucket && row.posterPath) {
    return { bucket: row.posterBucket, path: row.posterPath };
  }
  return null;
}

function previewKey(target: { bucket: StorageBucket; path: string }): string {
  return `${target.bucket}/${target.path}`;
}

function kindLabel(kind: string): string {
  return ASSET_KIND_LABELS[kind] ?? kind;
}

function assetTitle(row: { filename: string | null; kind: string }): string {
  return row.filename ?? `${kindLabel(row.kind)} asset`;
}

/**
 * Bytes as a human size.
 *
 * Binary units (1024) with decimal labels, matching what operating systems show,
 * so a 1.4 GB file here is the 1.4 GB the user saw when they uploaded it.
 */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Library.
 *
 * A media grid with a table alternative, filtered in SQL from validated URL
 * params, plus a details panel that is also URL state (`?asset=<id>`). Making the
 * panel a search param rather than client state means the page stays a server
 * component, a specific asset is a shareable link, and the back button closes the
 * panel — none of which a `useState` drawer gives.
 *
 * Previews are signed per object and only for objects that can actually be
 * rendered as an image (see `previewTarget`). Everything else gets a format glyph
 * on a muted well: a placeholder poster would imply a still that does not exist.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect(PRODUCT_HOME);
  if (session.status === "anonymous") redirect(signInPathFor("/app/library"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect(PRODUCT_HOME);

  const { context } = resolution;
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const query = single("q")?.trim() ?? "";
  const kindParam = single("kind");
  const campaignParam = single("campaign");
  const sourceParam = single("source");
  const stateParam = single("state");
  const sortParam = single("sort");
  const assetParam = single("asset");
  const view = single("view") === "table" ? "table" : "grid";

  const sort = sortParam && VALID_SORTS.has(sortParam) ? sortParam : "recent";
  const uuid = /^[0-9a-f-]{36}$/i;
  const selectedId = assetParam && uuid.test(assetParam) ? assetParam : null;

  // Every predicate is validated against its own option set before it reaches
  // SQL, so a hand-edited URL cannot introduce one of its own.
  const conditions: SQL[] = [
    eq(mediaAssets.workspaceId, context.workspaceId),
    isNull(mediaAssets.deletedAt),
  ];
  if (query) conditions.push(ilike(mediaAssets.filename, `%${query}%`));
  // The enum and `$type<>` columns are compared as SQL text rather than through
  // `eq`, because casting a validated plain string into the column's union would
  // assert what the option-set check has already proved.
  if (kindParam && VALID_KINDS.has(kindParam)) {
    conditions.push(sql`${mediaAssets.kind}::text = ${kindParam}`);
  }
  if (campaignParam && uuid.test(campaignParam)) {
    conditions.push(eq(mediaAssets.campaignId, campaignParam));
  }
  if (sourceParam && VALID_SOURCES.has(sourceParam)) {
    conditions.push(sql`${mediaAssets.origin}::text = ${sourceParam}`);
  }
  if (stateParam && VALID_STATES.has(stateParam)) {
    // `not_ready` is the complement rather than a stored value — see the comment on
    // `libraryCopy.states`.
    conditions.push(
      stateParam === "not_ready"
        ? sql`${mediaAssets.uploadState} <> 'ready'`
        : sql`${mediaAssets.uploadState} = ${stateParam}`,
    );
  }

  const where = and(...conditions);
  const inWorkspace = and(
    eq(mediaAssets.workspaceId, context.workspaceId),
    isNull(mediaAssets.deletedAt),
  );

  // `desc()` alone puts nulls first in Postgres, which would head "Largest first"
  // with every asset whose size was never recorded.
  const orderBy =
    sort === "oldest"
      ? asc(mediaAssets.createdAt)
      : sort === "name"
        ? sql`${mediaAssets.filename} asc nulls last`
        : sort === "size"
          ? sql`${mediaAssets.byteSize} desc nulls last`
          : sort === "duration"
            ? sql`${mediaAssets.durationMs} desc nulls last`
            : desc(mediaAssets.createdAt);

  const columnsToSelect = {
    id: mediaAssets.id,
    kind: mediaAssets.kind,
    filename: mediaAssets.filename,
    mimeType: mediaAssets.mimeType,
    byteSize: mediaAssets.byteSize,
    durationMs: mediaAssets.durationMs,
    width: mediaAssets.width,
    height: mediaAssets.height,
    aspectRatio: mediaAssets.aspectRatio,
    codec: mediaAssets.codec,
    origin: mediaAssets.origin,
    uploadState: mediaAssets.uploadState,
    scanState: mediaAssets.scanState,
    bucket: mediaAssets.bucket,
    storagePath: mediaAssets.storagePath,
    createdAt: mediaAssets.createdAt,
    updatedAt: mediaAssets.updatedAt,
    provider: mediaAssets.provider,
    providerModel: mediaAssets.providerModel,
    generationCostCents: mediaAssets.generationCostCents,
    checksum: mediaAssets.checksum,
    campaignId: mediaAssets.campaignId,
    campaignName: campaigns.name,
    contentItemId: mediaAssets.contentItemId,
    contentItemTitle: contentItems.title,
    posterBucket: posterAssets.bucket,
    posterPath: posterAssets.storagePath,
  };

  /**
   * The poster join carries the readability gates with it, so a poster whose bytes
   * never landed is simply absent rather than signed into a URL that 404s.
   */
  const posterJoin = and(
    eq(posterAssets.id, mediaAssets.posterAssetId),
    isNull(posterAssets.deletedAt),
    sql`${posterAssets.uploadState} = 'ready'`,
    sql`${posterAssets.scanState} <> 'rejected'`,
  );

  // Six queries, one round trip. The summary aggregates are deliberately
  // unfiltered: a "stored bytes" figure computed from the current 48-row slice
  // would describe the filter rather than the workspace.
  const [rows, totalRows, summaryRows, byKind, campaignOptions, selectedRows] = await Promise.all([
    db
      .select(columnsToSelect)
      .from(mediaAssets)
      .leftJoin(campaigns, eq(mediaAssets.campaignId, campaigns.id))
      .leftJoin(contentItems, eq(mediaAssets.contentItemId, contentItems.id))
      .leftJoin(posterAssets, posterJoin)
      .where(where)
      .orderBy(orderBy)
      .limit(PAGE_SIZE),

    db.select({ value: sql<number>`count(*)::int` }).from(mediaAssets).where(where),

    db
      .select({
        total: sql<number>`count(*)::int`,
        // Cast to bigint and read as a string: the driver returns numeric as a
        // string, so typing this as `number` here would be a lie.
        bytes: sql<string | null>`sum(${mediaAssets.byteSize})::bigint`,
        // How many rows actually carry a size, so the byte total can say what it
        // is a total OF rather than implying it covers everything.
        sized: sql<number>`count(${mediaAssets.byteSize})::int`,
        uploaded: sql<number>`count(*) filter (where ${mediaAssets.origin}::text = 'user_upload')::int`,
        generated: sql<number>`count(*) filter (where ${mediaAssets.origin}::text = 'provider')::int`,
        notReady: sql<number>`count(*) filter (where ${mediaAssets.uploadState} <> 'ready')::int`,
      })
      .from(mediaAssets)
      .where(inWorkspace),

    db
      .select({
        kind: mediaAssets.kind,
        value: sql<number>`count(*)::int`,
        bytes: sql<string | null>`sum(${mediaAssets.byteSize})::bigint`,
      })
      .from(mediaAssets)
      .where(inWorkspace)
      .groupBy(mediaAssets.kind),

    // The campaign filter offers this workspace's own campaigns, so the control
    // can never name a campaign the user cannot see.
    db
      .select({ id: campaigns.id, label: campaigns.name })
      .from(campaigns)
      .where(and(eq(campaigns.workspaceId, context.workspaceId), isNull(campaigns.deletedAt)))
      .orderBy(desc(campaigns.updatedAt))
      .limit(50),

    // Fetched by id AND workspace, not by id alone: the details panel is a URL
    // param, so it is user input.
    selectedId === null
      ? []
      : db
          .select(columnsToSelect)
          .from(mediaAssets)
          .leftJoin(campaigns, eq(mediaAssets.campaignId, campaigns.id))
          .leftJoin(contentItems, eq(mediaAssets.contentItemId, contentItems.id))
          .leftJoin(posterAssets, posterJoin)
          .where(and(eq(mediaAssets.id, selectedId), inWorkspace))
          .limit(1),
  ]);

  // Signed in parallel, deduplicated by object: a real adapter may make a network
  // call per object, and 48 of those in series would dominate TTFB.
  const storage = getStorageAdapter();
  const targets = new Map<string, { bucket: StorageBucket; path: string }>();
  for (const row of [...rows, ...selectedRows]) {
    const target = previewTarget(row);
    if (target) targets.set(previewKey(target), target);
  }
  const previewUrls = new Map(
    await Promise.all(
      [...targets].map(
        async ([key, target]) =>
          [key, await storage.getSignedUrl(target.bucket, target.path, PREVIEW_TTL_SECONDS)] as const,
      ),
    ),
  );

  const withPreview = (row: AssetRow): AssetCard => {
    const target = previewTarget(row);
    return { ...row, previewUrl: target ? previewUrls.get(previewKey(target)) ?? null : null };
  };

  const cards: AssetCard[] = rows.map(withPreview);
  const selected = selectedRows[0] ? withPreview(selectedRows[0]) : null;

  const total = totalRows[0]?.value ?? 0;
  const summary = summaryRows[0] ?? {
    total: 0,
    bytes: null,
    sized: 0,
    uploaded: 0,
    generated: 0,
    notReady: 0,
  };
  const totalBytes = summary.bytes === null ? null : Number(summary.bytes);
  const filtered = Boolean(query || kindParam || campaignParam || sourceParam || stateParam);
  const canCreate = can(context.role, "content.create");

  /** Preserves every other param, so opening details keeps the current filters. */
  const hrefWith = (key: string, value: string | null): string => {
    const search = new URLSearchParams();
    for (const [param, raw] of Object.entries(params)) {
      if (param === key) continue;
      const first = Array.isArray(raw) ? raw[0] : raw;
      if (first) search.set(param, first);
    }
    if (value) search.set(key, value);
    const serialised = search.toString();
    return serialised ? `/app/library?${serialised}` : "/app/library";
  };

  const detailsHref = (id: string) => hrefWith("asset", id);
  const closeHref = hrefWith("asset", null);

  const storageByKind = byKind
    .map((row) => ({
      id: row.kind,
      label: kindLabel(row.kind),
      value: row.bytes === null ? 0 : Number(row.bytes),
      detail: row.value === 1 ? "1 asset" : `${countFormatter.format(row.value)} assets`,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  const columns: readonly Column<AssetCard>[] = [
    {
      id: "asset",
      header: "Asset",
      cell: (row) => (
        <PrimaryCell
          title={assetTitle(row)}
          detail={row.mimeType ?? kindLabel(row.kind)}
          leading={<CellThumb src={row.previewUrl} fallback={assetTitle(row)} />}
        />
      ),
    },
    {
      id: "kind",
      header: "Type",
      hideBelow: "sm",
      cell: (row) => <span className="whitespace-nowrap">{kindLabel(row.kind)}</span>,
    },
    {
      id: "campaign",
      header: "Campaign",
      hideBelow: "xl",
      cell: (row) =>
        row.campaignName ? (
          <span className="block max-w-[12rem] truncate">{row.campaignName}</span>
        ) : (
          <Absent />
        ),
    },
    {
      id: "dimensions",
      header: "Dimensions",
      numeric: true,
      hideBelow: "lg",
      cell: (row) =>
        row.width && row.height ? `${row.width}×${row.height}` : <Absent />,
    },
    {
      id: "duration",
      header: "Duration",
      numeric: true,
      hideBelow: "md",
      cell: (row) => (row.durationMs === null ? <Absent /> : formatDuration(row.durationMs / 1000)),
    },
    {
      id: "size",
      header: "Size",
      numeric: true,
      hideBelow: "sm",
      cell: (row) => (row.byteSize === null ? <Absent /> : formatBytes(row.byteSize)),
    },
    {
      id: "source",
      header: "Source",
      hideBelow: "lg",
      cell: (row) => (
        <span className="flex items-center gap-[var(--space-2)]">
          <span className="whitespace-nowrap">{SOURCE_LABELS[row.origin] ?? row.origin}</span>
          {DEMO_ORIGINS.has(row.origin) && <DemoChip />}
        </span>
      ),
    },
    {
      id: "state",
      header: "State",
      hideBelow: "md",
      cell: (row) => <StateChip uploadState={row.uploadState} scanState={row.scanState} />,
    },
    {
      id: "added",
      header: "Added",
      hideBelow: "md",
      cell: (row) => (
        <span className="whitespace-nowrap text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
          {relativeDay(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <AppPage>
      <PageStack>
        <PageHeader
          title={libraryCopy.title}
          description={libraryCopy.body}
          meta={[
            summary.total === 1 ? "1 asset" : `${countFormatter.format(summary.total)} assets`,
            context.workspaceName,
          ]}
          actions={
            canCreate ? (
              <ButtonLink href="/app/create">
                <Plus aria-hidden="true" size={15} strokeWidth={2.25} />
                {libraryCopy.upload.campaignCta}
              </ButtonLink>
            ) : undefined
          }
        />

        <KpiGrid columns={5}>
          <KpiCard
            label={libraryCopy.kpis.assets}
            value={countFormatter.format(summary.total)}
            icon={<Layers size={14} strokeWidth={1.75} />}
          />
          <KpiCard
            // `byte_size` is nullable, so this total covers only the rows that
            // carry one. The detail line says how many that is rather than letting
            // a partial sum read as the whole library.
            label={libraryCopy.kpis.stored}
            value={totalBytes === null ? libraryCopy.unknown : formatBytes(totalBytes)}
            icon={<HardDrive size={14} strokeWidth={1.75} />}
            detail={
              <span className="text-[color:var(--text-muted)]">
                {summary.total === 0
                  ? libraryCopy.sizeDetail.none
                  : summary.sized === summary.total
                    ? libraryCopy.sizeDetail.all
                    : libraryCopy.sizeDetail.partial(summary.sized, summary.total)}
              </span>
            }
          />
          <KpiCard
            label={libraryCopy.kpis.uploaded}
            value={countFormatter.format(summary.uploaded)}
            icon={<Upload size={14} strokeWidth={1.75} />}
            href={summary.uploaded > 0 ? "/app/library?source=user_upload" : undefined}
          />
          <KpiCard
            label={libraryCopy.kpis.generated}
            value={countFormatter.format(summary.generated)}
            icon={<Cpu size={14} strokeWidth={1.75} />}
            href={summary.generated > 0 ? "/app/library?source=provider" : undefined}
          />
          <KpiCard
            label={libraryCopy.kpis.notReady}
            value={countFormatter.format(summary.notReady)}
            tone={summary.notReady > 0 ? "warning" : "neutral"}
            icon={<TriangleAlert size={14} strokeWidth={1.75} />}
            href={summary.notReady > 0 ? "/app/library?state=not_ready" : undefined}
            detail={
              <span
                className={
                  summary.notReady > 0
                    ? "text-[color:var(--warning)]"
                    : "text-[color:var(--text-muted)]"
                }
              >
                {summary.notReady > 0
                  ? libraryCopy.notReadyDetail.some
                  : libraryCopy.notReadyDetail.none}
              </span>
            }
          />
        </KpiGrid>

        {/*
          Two columns once the details panel is open, rather than an overlay.

          A floating drawer would owe the accessibility floor Escape-to-dismiss and
          focus restoration, and both of those need client state. This panel is URL
          state instead, so it stays server-rendered, shareable and back-button
          dismissable — and because it sits beside the grid rather than over it, it
          hides none of the data the user is comparing.
        */}
        <div
          className={cn(
            "grid gap-[var(--space-6)]",
            selectedId && "xl:grid-cols-[minmax(0,1fr)_21rem]",
          )}
        >
          {/* First in the DOM so the panel a user just opened is the next thing a
              keyboard or screen reader lands on, and placed right at `xl`. */}
          {selectedId && (
            <aside
              aria-labelledby="asset-details-heading"
              className={cn(
                "xl:col-start-2 xl:row-start-1 xl:self-start",
                "xl:sticky xl:top-[calc(var(--app-topbar-height)+var(--space-6))]",
                // A pinned panel taller than the viewport would have its last
                // fields unreachable, so it scrolls inside itself once it runs out
                // of room. The page below the top bar is the available height.
                "xl:max-h-[calc(100dvh-var(--app-topbar-height)-var(--space-12))] xl:overflow-y-auto",
                "motion-safe:animate-[virally-app-pop-in_var(--dur-base)_var(--ease-enter)_backwards]",
              )}
            >
              {selected ? (
                <AssetDetails asset={selected} closeHref={closeHref} />
              ) : (
                <Card>
                  <CardHeader
                    as="h2"
                    id="asset-details-heading"
                    title={libraryCopy.details.notFound.title}
                    action={<CloseDetails href={closeHref} />}
                  />
                  <CardBody className="pt-[var(--space-2)]">
                    <p className="text-[length:var(--text-app-cell)] text-[color:var(--text-secondary)]">
                      {libraryCopy.details.notFound.body}
                    </p>
                  </CardBody>
                </Card>
              )}
            </aside>
          )}

          <div className="flex min-w-0 flex-col gap-[var(--space-6)] xl:col-start-1 xl:row-start-1">
            <div className="grid gap-[var(--app-panel-gap)] lg:grid-cols-2">
              <Card>
                <CardHeader
                  as="h2"
                  title={libraryCopy.upload.title}
                  description={libraryCopy.upload.body}
                />
                <CardBody className="pt-[var(--space-3)]">
                  {/*
                    Deliberately not a dashed dropzone. There is no upload path in
                    the app yet — nothing calls the storage adapter's `putObject` —
                    and a rectangle that looks like a drop target is a promise the
                    product cannot keep. It states what it is instead.
                  */}
                  <div
                    className={cn(
                      "flex items-start gap-[var(--space-3)] rounded-[var(--radius-control)]",
                      "bg-[var(--surface-muted)] p-[var(--space-4)]",
                    )}
                  >
                    <Upload
                      aria-hidden="true"
                      size={18}
                      strokeWidth={1.5}
                      className="mt-0.5 shrink-0 text-[color:var(--text-muted)]"
                    />
                    <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-secondary)]">
                      {libraryCopy.upload.unavailable}
                    </p>
                  </div>
                </CardBody>
                <CardFooter>
                  {canCreate && (
                    <QuietLink href="/app/create">{libraryCopy.upload.campaignCta}</QuietLink>
                  )}
                  <QuietLink href="/app/content">{libraryCopy.upload.contentCta}</QuietLink>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader as="h2" title={libraryCopy.storageHeading} />
                <CardBody className="pt-[var(--space-3)]">
                  {storageByKind.length > 0 ? (
                    <CategoryBars data={storageByKind} formatValue={formatBytes} />
                  ) : (
                    <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
                      {libraryCopy.storageEmpty}
                    </p>
                  )}
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardBody pad="tight" className="border-b border-[var(--border-subtle)]">
                <FilterBar
                  searchPlaceholder={libraryCopy.searchPlaceholder}
                  views={["grid", "table"]}
                  filters={[
                    { key: "kind", label: libraryCopy.filters.kind, options: ASSET_KIND_OPTIONS },
                    {
                      key: "campaign",
                      label: libraryCopy.filters.campaign,
                      options: campaignOptions,
                    },
                    { key: "source", label: libraryCopy.filters.source, options: libraryCopy.sources },
                    { key: "state", label: libraryCopy.filters.state, options: libraryCopy.states },
                    { key: "sort", label: libraryCopy.filters.sort, options: libraryCopy.sorts },
                  ]}
                />
              </CardBody>

              {cards.length > 0 && view === "grid" && (
                <CardBody>
                  <ul
                    aria-label={libraryCopy.gridLabel}
                    className="grid gap-[var(--app-panel-gap)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                  >
                    {cards.map((row) => (
                      <li key={row.id}>
                        <AssetTile
                          row={row}
                          href={detailsHref(row.id)}
                          selected={row.id === selectedId}
                        />
                      </li>
                    ))}
                  </ul>
                </CardBody>
              )}

              {cards.length > 0 && view === "table" && (
                <CardBody pad="none">
                  <DataTable
                    caption={libraryCopy.tableCaption}
                    columns={columns}
                    rows={cards}
                    rowKey={(row) => row.id}
                    rowHref={(row) => detailsHref(row.id)}
                  />
                </CardBody>
              )}

              {/* Stated rather than silent. A capped list that looks complete is
                  worse than one that says it is capped. */}
              {cards.length > 0 && total > cards.length && (
                <CardFooter>{libraryCopy.truncated(cards.length, total)}</CardFooter>
              )}

              {cards.length === 0 && (
                <EmptyState
                  bare
                  icon={<Layers size={20} strokeWidth={1.75} />}
                  title={filtered ? libraryCopy.noMatches.title : libraryCopy.empty.title}
                  body={filtered ? libraryCopy.noMatches.body : libraryCopy.empty.body}
                  actions={
                    filtered ? (
                      <ButtonLink href="/app/library" variant="secondary">
                        Clear filters
                      </ButtonLink>
                    ) : (
                      <>
                        {canCreate && (
                          <ButtonLink href="/app/create">
                            {libraryCopy.upload.campaignCta}
                          </ButtonLink>
                        )}
                        <ButtonLink href="/app/content" variant="secondary">
                          {libraryCopy.upload.contentCta}
                        </ButtonLink>
                      </>
                    )
                  }
                />
              )}
            </Card>
          </div>
        </div>
      </PageStack>
    </AppPage>
  );
}

/**
 * One asset in the grid.
 *
 * Media-dominant, because on this surface the still is the identity of the row.
 * The well is a fixed 4:3 with the image contained rather than cropped: a 9:16
 * still cropped to landscape loses the framing that is the thing being judged.
 *
 * The whole tile is the link to the details panel, so there is exactly one target
 * per card rather than a title link plus a details link competing inside it.
 */
function AssetTile({
  row,
  href,
  selected,
}: {
  row: AssetCard;
  href: string;
  selected: boolean;
}) {
  const meta = [
    kindLabel(row.kind),
    row.width && row.height ? `${row.width}×${row.height}` : null,
    row.byteSize === null ? null : formatBytes(row.byteSize),
  ].filter(Boolean);

  return (
    <Card
      as="article"
      interactive
      className={cn(
        "relative flex h-full flex-col overflow-hidden",
        selected && "border-[var(--brand-primary)]",
      )}
    >
      {/*
        One stretched link rather than `Card as="a"`, for two reasons: the whole
        tile is a single target instead of a title link competing with a details
        link, and `next/link` gives a client transition with `scroll={false}` —
        opening the panel must not throw the reader back to the top of the grid.
        `Card` renders a plain element, so an anchor version could not pass either.
      */}
      <Link
        href={href}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "absolute inset-0 z-[var(--z-raised)] rounded-[var(--radius-card)]",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        )}
      >
        <span className="sr-only">
          {libraryCopy.details.open}: {assetTitle(row)}
        </span>
      </Link>

      <div className="relative flex aspect-[4/3] items-center justify-center bg-[var(--surface-muted)]">
        {row.previewUrl ? (
          // A signed storage URL on a per-deployment host, which next/image cannot
          // optimise without a remote-pattern allowlist per tenant. The parts that
          // matter here are the reserved intrinsic box and lazy loading, both set.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.previewUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={640}
            height={480}
            className="size-full object-contain"
          />
        ) : (
          // Glyph only, no caption. The format is already stated in the meta line
          // below, and 48 tiles each repeating "No stored preview" is noise rather
          // than information — the details panel says it once, where the well is
          // large enough that an unexplained empty box would be a question.
          <KindGlyph kind={row.kind} />
        )}

        {DEMO_ORIGINS.has(row.origin) && (
          <span className="absolute left-[var(--space-2)] top-[var(--space-2)]">
            <DemoChip />
          </span>
        )}

        {row.durationMs !== null && (
          <span
            className={cn(
              "app-figure absolute bottom-[var(--space-2)] right-[var(--space-2)]",
              "rounded-[var(--radius-chip)] bg-[var(--surface-primary)] px-1.5 py-0.5",
              "text-[length:var(--text-app-label)] text-[color:var(--text-secondary)]",
              "shadow-[var(--elevation-card)]",
            )}
          >
            {formatDuration(row.durationMs / 1000)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-[var(--space-2)] p-[var(--app-panel-pad-tight)]">
        <p className="truncate font-[var(--weight-strong)] text-[color:var(--text-primary)]">
          {assetTitle(row)}
        </p>

        <p className="app-figure truncate text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
          {meta.join(" · ")}
        </p>

        <div className="mt-auto flex items-center justify-between gap-[var(--space-2)] pt-[var(--space-1)]">
          <span className="whitespace-nowrap text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
            {relativeDay(row.createdAt)}
          </span>
          <StateChip uploadState={row.uploadState} scanState={row.scanState} />
        </div>
      </div>
    </Card>
  );
}

/**
 * The details panel for one asset.
 *
 * Every field the row carries, grouped by what a person is asking when they look:
 * what is it, where did it come from, where does it live, what is it used in. A
 * field the row does not carry renders an em dash with a stated reason, never a
 * zero and never a blank.
 */
function AssetDetails({ asset, closeHref }: { asset: AssetCard; closeHref: string }) {
  const { fields } = libraryCopy.details;
  const generated = GENERATED_ORIGINS.has(asset.origin);

  return (
    <Card>
      <CardHeader
        as="h2"
        id="asset-details-heading"
        title={libraryCopy.details.heading}
        action={<CloseDetails href={closeHref} />}
        divided
      />

      <div className="flex aspect-[4/3] items-center justify-center border-b border-[var(--border-subtle)] bg-[var(--surface-muted)]">
        {asset.previewUrl ? (
          // Same reasoning as the grid tile: a signed URL on an arbitrary host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.previewUrl}
            alt={assetTitle(asset)}
            loading="lazy"
            decoding="async"
            width={640}
            height={480}
            className="size-full object-contain"
          />
        ) : (
          <span className="flex flex-col items-center gap-[var(--space-2)] text-center">
            <KindGlyph kind={asset.kind} />
            <span className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">
              {libraryCopy.previewMissing}
            </span>
          </span>
        )}
      </div>

      <CardBody className="flex flex-col gap-[var(--space-4)]">
        <div>
          <p className="app-card-title break-words text-[color:var(--text-primary)]">
            {assetTitle(asset)}
          </p>
          <div className="mt-[var(--space-2)] flex flex-wrap items-center gap-[var(--space-2)]">
            <StateChip uploadState={asset.uploadState} scanState={asset.scanState} />
            {DEMO_ORIGINS.has(asset.origin) && <DemoChip />}
          </div>
        </div>

        <DetailGroup title={libraryCopy.details.format}>
          <DetailRow label={fields.kind} value={kindLabel(asset.kind)} />
          <DetailRow label={fields.mimeType} value={asset.mimeType} />
          <DetailRow
            label={fields.dimensions}
            value={asset.width && asset.height ? `${asset.width}×${asset.height}` : null}
            figure
          />
          <DetailRow label={fields.aspectRatio} value={asset.aspectRatio} figure />
          <DetailRow
            label={fields.duration}
            value={asset.durationMs === null ? null : formatDuration(asset.durationMs / 1000)}
            figure
          />
          <DetailRow label={fields.codec} value={asset.codec} />
          <DetailRow
            label={fields.size}
            value={asset.byteSize === null ? null : formatBytes(asset.byteSize)}
            figure
          />
        </DetailGroup>

        <DetailGroup title={libraryCopy.details.provenance}>
          <DetailRow label={fields.source} value={SOURCE_LABELS[asset.origin] ?? asset.origin} />
          {generated && (
            <>
              <DetailRow label={fields.provider} value={asset.provider} />
              <DetailRow label={fields.model} value={asset.providerModel} />
              {/* Shown only for a generated object, where a cost of zero is a real
                  measurement. On an upload the column is a structural default and
                  printing €0.00 would read as a finding. */}
              <DetailRow
                label={fields.cost}
                value={centsFormatter.format(asset.generationCostCents / 100)}
                figure
              />
            </>
          )}
          <DetailRow label={fields.added} value={relativeDay(asset.createdAt)} />
          <DetailRow label={fields.updated} value={relativeDay(asset.updatedAt)} />
        </DetailGroup>

        <DetailGroup title={libraryCopy.details.storage}>
          <DetailRow label={fields.bucket} value={asset.bucket} />
          <DetailRow label={fields.path} value={asset.storagePath} wrap />
          <DetailRow label={fields.checksum} value={asset.checksum} wrap figure />
          <DetailRow label={fields.uploadState} value={STATE_LABELS[asset.uploadState] ?? asset.uploadState} />
          <DetailRow label={fields.scanState} value={asset.scanState} />
        </DetailGroup>

        <DetailGroup title={libraryCopy.details.links}>
          {asset.campaignId || asset.contentItemId ? (
            <>
              {asset.campaignId && (
                <DetailRow
                  label={fields.campaign}
                  value={asset.campaignName ?? asset.campaignId}
                  href={`/app/campaigns/${asset.campaignId}`}
                />
              )}
              {asset.contentItemId && (
                <DetailRow
                  label={fields.contentItem}
                  value={asset.contentItemTitle ?? asset.contentItemId}
                  href={`/app/content/${asset.contentItemId}`}
                />
              )}
            </>
          ) : (
            <p className="text-[length:var(--text-app-meta)] text-[color:var(--text-muted)]">
              {libraryCopy.details.noLinks}
            </p>
          )}
        </DetailGroup>
      </CardBody>
    </Card>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="app-label">{title}</h3>
      <dl className="mt-[var(--space-2)] flex flex-col gap-[var(--space-2)]">{children}</dl>
    </section>
  );
}

/**
 * One label/value pair.
 *
 * A null value renders an em dash plus an sr-only reason, so "we have not recorded
 * this" never reads as a measured zero or an empty string.
 */
function DetailRow({
  label,
  value,
  href,
  figure = false,
  wrap = false,
}: {
  label: string;
  value: string | null;
  href?: string;
  figure?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-[var(--space-3)]">
      <dt className="text-[length:var(--text-app-label)] text-[color:var(--text-muted)]">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-[length:var(--text-app-meta)] text-[color:var(--text-primary)]",
          figure && "app-figure",
          wrap ? "break-all" : "truncate",
        )}
      >
        {value === null ? (
          <span className="text-[color:var(--text-muted)]">
            <span aria-hidden="true">—</span>
            <span className="sr-only">{libraryCopy.unknown}</span>
          </span>
        ) : href ? (
          <Link
            href={href}
            className={cn(
              "rounded-[var(--radius-chip)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
            )}
          >
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/** Closes the details panel by dropping the `asset` param. */
function CloseDetails({ href }: { href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-[var(--radius-control)]",
        "text-[color:var(--text-muted)] transition-colors duration-[var(--dur-instant)]",
        "hover:bg-[var(--surface-muted)] hover:text-[color:var(--text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        // An icon-only control under 44px carries a transparent inset so the hit
        // area clears the target-size floor without changing the paint.
        "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
      )}
    >
      <X aria-hidden="true" size={16} strokeWidth={2} />
      <span className="sr-only">{libraryCopy.details.close}</span>
    </Link>
  );
}

/** A quiet inline link, for a card footer. */
function QuietLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-chip)]",
        "text-[length:var(--text-app-meta)] font-[var(--weight-strong)] text-[color:var(--brand-ink)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
      )}
    >
      {children}
      <ArrowRight aria-hidden="true" size={13} strokeWidth={2} />
    </Link>
  );
}

/** A value the row does not carry, in a table cell. */
function Absent() {
  return (
    <span className="text-[color:var(--text-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{libraryCopy.unknown}</span>
    </span>
  );
}

/**
 * Provenance marker for stand-in bytes.
 *
 * Labelled wherever it appears, so a reviewer never mistakes a demo object for a
 * real generation.
 */
function DemoChip() {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-chip)]",
        "bg-[var(--warning-soft)] px-1.5 py-0.5",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        "text-[color:var(--warning)]",
      )}
    >
      {libraryCopy.demoLabel}
    </span>
  );
}

/**
 * Upload and moderation state.
 *
 * Renders nothing for the ordinary case — a ready, clean asset needs no badge, and
 * a column of "Ready" chips is noise. A rejected scan outranks the upload state,
 * because it is the reason the asset cannot be used.
 */
function StateChip({ uploadState, scanState }: { uploadState: string; scanState: string }) {
  if (scanState === "rejected") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-chip)]",
          "bg-[var(--error-soft)] px-1.5 py-0.5",
          "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
          "text-[color:var(--error)]",
        )}
      >
        <span aria-hidden="true">✕</span>
        Scan rejected
      </span>
    );
  }

  if (uploadState === "ready") return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-chip)] px-1.5 py-0.5",
        "text-[length:var(--text-app-label)] font-[var(--weight-strong)] leading-4",
        uploadState === "failed"
          ? "bg-[var(--error-soft)] text-[color:var(--error)]"
          : "bg-[var(--warning-soft)] text-[color:var(--warning)]",
      )}
    >
      {STATE_LABELS[uploadState] ?? uploadState}
    </span>
  );
}

/** Stand-in for a missing still. Decorative — the format is stated beside it. */
function KindGlyph({ kind }: { kind: string }) {
  const shared = "text-[color:var(--text-muted)]";
  const size = 26;
  if (kind.includes("video"))
    return <Film aria-hidden="true" size={size} strokeWidth={1.25} className={shared} />;
  if (IMAGE_KINDS.has(kind))
    return <ImageIcon aria-hidden="true" size={size} strokeWidth={1.25} className={shared} />;
  if (kind === "music")
    return <Music aria-hidden="true" size={size} strokeWidth={1.25} className={shared} />;
  if (kind === "voiceover" || kind === "audio")
    return <Volume2 aria-hidden="true" size={size} strokeWidth={1.25} className={shared} />;
  return <FileText aria-hidden="true" size={size} strokeWidth={1.25} className={shared} />;
}
