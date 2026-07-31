import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq, ilike, isNull, sql, type SQL } from "drizzle-orm";
import { Film, FileText, Image as ImageIcon, Music, Volume2 } from "lucide-react";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor, PRODUCT_HOME } from "@/lib/auth/routes";
import { db } from "@/lib/db";
import { mediaAssets } from "@/lib/db/schema.fragment";
import { relativeDay, formatTimecode } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AppPage } from "@/components/app-ui/AppPage";
import { PageHeader } from "@/components/app-ui/PageHeader";
import { Panel } from "@/components/app-ui/Panel";
import { FilterBar } from "@/components/app-ui/FilterBar";
import { EmptyState } from "@/components/app-ui/States";
import { DataTable, PrimaryCell, type Column } from "@/components/app-ui/DataTable";
import { Badge } from "@/components/primitives/Badge";
import { ButtonLink } from "@/components/primitives/ButtonLink";
import { ASSET_KIND_LABELS, ASSET_KIND_OPTIONS, libraryCopy } from "@/content/content-library";

export const metadata: Metadata = {
  title: "Library",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;
const countFormatter = new Intl.NumberFormat("en-US");

const VALID_KINDS = new Set<string>(ASSET_KIND_OPTIONS.map((option) => option.id));

type AssetRow = {
  id: string;
  kind: string;
  filename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  origin: string;
  uploadState: string;
  createdAt: Date;
};

/**
 * Library.
 *
 * Table view rather than a thumbnail grid. A grid needs poster images, and
 * serving those means signed URLs from the storage adapter per asset — which is a
 * real feature, not a styling choice. Until posters exist, a grid of identical
 * placeholder tiles carries less information than a table row and takes four
 * times the space, so the table is the honest default.
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

  const conditions: SQL[] = [
    eq(mediaAssets.workspaceId, context.workspaceId),
    isNull(mediaAssets.deletedAt),
  ];
  if (query) conditions.push(ilike(mediaAssets.filename, `%${query}%`));
  if (kindParam && VALID_KINDS.has(kindParam)) {
    conditions.push(sql`${mediaAssets.kind}::text = ${kindParam}`);
  }
  const where = and(...conditions);

  const [rows, totalRows, byKind] = await Promise.all([
    db
      .select({
        id: mediaAssets.id,
        kind: mediaAssets.kind,
        filename: mediaAssets.filename,
        mimeType: mediaAssets.mimeType,
        byteSize: mediaAssets.byteSize,
        durationMs: mediaAssets.durationMs,
        width: mediaAssets.width,
        height: mediaAssets.height,
        origin: mediaAssets.origin,
        uploadState: mediaAssets.uploadState,
        createdAt: mediaAssets.createdAt,
      })
      .from(mediaAssets)
      .where(where)
      .orderBy(desc(mediaAssets.createdAt))
      .limit(PAGE_SIZE),

    db.select({ value: sql<number>`count(*)::int` }).from(mediaAssets).where(where),

    // Totals per kind, over the whole library rather than the filtered view — a
    // filter should not change the summary of what exists.
    db
      .select({
        kind: mediaAssets.kind,
        value: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${mediaAssets.byteSize}), 0)::bigint`,
      })
      .from(mediaAssets)
      .where(
        and(eq(mediaAssets.workspaceId, context.workspaceId), isNull(mediaAssets.deletedAt)),
      )
      .groupBy(mediaAssets.kind),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const filtered = Boolean(query || kindParam);
  const totalBytes = byKind.reduce((sum, row) => sum + Number(row.bytes), 0);

  const columns: readonly Column<AssetRow>[] = [
    {
      id: "name",
      header: "Asset",
      cell: (row) => (
        <PrimaryCell
          title={row.filename ?? `${ASSET_KIND_LABELS[row.kind] ?? row.kind} asset`}
          detail={row.mimeType ?? undefined}
          leading={<KindIcon kind={row.kind} />}
        />
      ),
    },
    {
      id: "kind",
      header: "Type",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
          {ASSET_KIND_LABELS[row.kind] ?? row.kind}
        </span>
      ),
    },
    {
      id: "dimensions",
      header: "Dimensions",
      hideBelow: "lg",
      cell: (row) =>
        row.width && row.height ? (
          `${row.width}×${row.height}`
        ) : (
          <span className="text-[color:var(--color-text-muted)]">—</span>
        ),
    },
    {
      id: "duration",
      header: "Duration",
      numeric: true,
      hideBelow: "md",
      cell: (row) =>
        row.durationMs ? (
          formatTimecode(row.durationMs / 1000)
        ) : (
          <span className="text-[color:var(--color-text-muted)]">—</span>
        ),
    },
    {
      id: "size",
      header: "Size",
      numeric: true,
      hideBelow: "sm",
      cell: (row) => (row.byteSize ? formatBytes(row.byteSize) : "—"),
    },
    {
      id: "state",
      header: "State",
      hideBelow: "xl",
      cell: (row) => (
        <span className="flex items-center gap-[var(--space-2)]">
          {row.origin === "mock" && <Badge tone="warning">Demo</Badge>}
          {row.uploadState !== "ready" && (
            <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-muted)]">
              {row.uploadState}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "created",
      header: "Added",
      hideBelow: "md",
      cell: (row) => (
        <span className="font-utility text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
          {relativeDay(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <AppPage>
      <PageHeader
        title={libraryCopy.title}
        description={libraryCopy.body}
        meta={[
          total === 1 ? "1 asset" : `${countFormatter.format(total)} assets`,
          formatBytes(totalBytes),
          context.workspaceName,
        ]}
      />

      <Panel className="mt-[var(--space-8)]">
        <FilterBar
          searchPlaceholder="Search assets by filename"
          filters={[{ key: "kind", label: "Type", options: ASSET_KIND_OPTIONS }]}
        />

        <div className="mt-[var(--space-6)]">
          {rows.length > 0 && (
            <DataTable
              caption="Media assets in this workspace"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
            />
          )}

          {rows.length === 0 && (
            <EmptyState
              title={filtered ? libraryCopy.noMatches.title : libraryCopy.empty.title}
              body={filtered ? libraryCopy.noMatches.body : libraryCopy.empty.body}
              actions={
                filtered ? (
                  <ButtonLink href="/app/library" variant="secondary">
                    Clear filters
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/app/create">Create a campaign</ButtonLink>
                )
              }
            />
          )}
        </div>

        <p className="mt-[var(--space-6)] border-t border-[var(--color-border-hairline)] pt-[var(--space-4)] text-[length:var(--text-utility-xs)] leading-[var(--leading-snug)] text-[color:var(--color-text-muted)]">
          {libraryCopy.uploadUnavailable}
        </p>
      </Panel>
    </AppPage>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const shared = cn("text-[color:var(--color-text-muted)]");
  const size = 16;
  if (kind.includes("video"))
    return <Film aria-hidden="true" size={size} strokeWidth={1.5} className={shared} />;
  if (kind.includes("image") || kind === "thumbnail")
    return <ImageIcon aria-hidden="true" size={size} strokeWidth={1.5} className={shared} />;
  if (kind === "music")
    return <Music aria-hidden="true" size={size} strokeWidth={1.5} className={shared} />;
  if (kind === "voiceover" || kind === "audio")
    return <Volume2 aria-hidden="true" size={size} strokeWidth={1.5} className={shared} />;
  return <FileText aria-hidden="true" size={size} strokeWidth={1.5} className={shared} />;
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
