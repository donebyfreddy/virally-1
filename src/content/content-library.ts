/**
 * Content and library copy.
 *
 * Kept together because the two surfaces share vocabulary: an "asset" in the
 * library becomes a "variant" once it is bound to a platform, and using
 * different words for the same object across two pages is how a product starts
 * feeling like two products.
 */

export const contentCopy = {
  title: "Content",
  body: "Every item this workspace has produced, and the platform variants generated from each one.",
  tableCaption: "Content items in this workspace",
  gridLabel: "Content items",

  /** KPI captions. Sentence case: they sit in ~130px and uppercase truncates. */
  kpis: {
    items: "Items",
    review: "Needs review",
    variants: "Variants",
    published: "Published posts",
  },

  statusTabsLabel: "Filter by review state",
  allStatuses: "All",

  /** Stated on a figure the platforms have not reported for this item. */
  metricUnreported: "Not reported",

  openEditor: "Open editor",
  openCampaign: "Campaign",
  demoLabel: "Demo",

  empty: {
    title: "No content yet.",
    body: "Content appears here once a campaign has generated scripts and assets, or once footage you own has been recomposed.",
  },

  noMatches: {
    title: "No content matches those filters.",
    body: "Nothing in this workspace matches the current combination. Clearing the filters will show everything again.",
  },

  truncated: (shown: number, total: number) =>
    `Showing the ${shown} most recent of ${total.toLocaleString("en-US")}. Narrow the filters to find older items.`,

  onboardingHeading: "How content gets here",
  onboardingBody: "Three routes produce a content item, and all of them land on this page.",
} as const;

/**
 * The routes that populate this page, shown under the first-run empty state.
 *
 * Every `href` is a real route. A first-run user needs the next action more than
 * a longer explanation of why the list is empty, which is why the empty state
 * above this stays one sentence.
 */
export const contentRoutes: readonly {
  id: string;
  title: string;
  body: string;
  href: string;
  cta: string;
}[] = [
  {
    id: "campaign",
    title: "Generate from a campaign",
    body: "The scripts and assets stages of a campaign produce items and their variants.",
    href: "/app/create",
    cta: "Start a campaign",
  },
  {
    id: "recompose",
    title: "Recompose footage you own",
    body: "Source video and images in the library become items once they are recomposed per platform.",
    href: "/app/library",
    cta: "Open the library",
  },
  {
    id: "publish",
    title: "Publish what is approved",
    body: "An approved variant moves to the calendar and out to a connected account.",
    href: "/app/calendar",
    cta: "Open the calendar",
  },
];

/**
 * `review_status` values, in the order the tabs and filters offer them.
 *
 * Shared by the status tabs (which read `content_items.status`) and the variant
 * filter (which reads `content_variants.status`) — the same vocabulary applies to
 * both, and two copies of it would drift.
 */
export const APPROVAL_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "awaiting_review", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "archived", label: "Archived" },
];

/**
 * Sort orders offered on the content list.
 *
 * Every one of these is expressible as a SQL `order by` on the columns the list
 * query already selects. Sorting by views is deliberately absent: per-item view
 * totals come from a second aggregate over `content_metrics`, so ordering by them
 * would mean fetching the whole workspace to sort it in memory.
 */
export const CONTENT_SORT_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "created", label: "Newest created" },
  { id: "title", label: "Title A–Z" },
  { id: "duration", label: "Longest first" },
];

/**
 * Library copy.
 *
 * No eyebrow: the app has none, and "LIBRARY" above "Library" said the same word
 * twice. The filter option sets live inside this object rather than as separate
 * exports so that every string a user reads on this page is in one place, and the
 * page derives its `FilterBar` definitions from them.
 */
export const libraryCopy = {
  title: "Library",
  body: "Every asset this workspace holds — uploaded footage, generated stills and clips, voiceovers, music and exports. Assets stay reusable across campaigns.",

  gridLabel: "Media assets",
  tableCaption: "Media assets in this workspace",
  searchPlaceholder: "Search by filename",

  /** KPI captions. Sentence case: they sit in ~130px and uppercase truncates. */
  kpis: {
    assets: "Assets",
    stored: "Stored",
    uploaded: "Uploaded",
    generated: "Generated",
    notReady: "Not ready",
  },

  /** Filter dimension names, shown in the control until one is applied. */
  filters: {
    kind: "Type",
    campaign: "Campaign",
    source: "Source",
    state: "State",
    sort: "Sort",
  },

  /**
   * `output_origin` values. `provider` means a real generation provider produced
   * the bytes; `mock` and `seeded_demo` mean they are stand-ins, and both are
   * labelled as such wherever they appear.
   */
  sources: [
    { id: "user_upload", label: "Uploaded" },
    { id: "provider", label: "Generated" },
    { id: "mock", label: "Demo output" },
    { id: "seeded_demo", label: "Seeded demo" },
  ],

  /**
   * `media_assets.upload_state`. A row exists before the bytes land, which is why
   * this is a filter rather than an implementation detail: an interrupted upload
   * is a thing the user needs to be able to find.
   */
  states: [
    { id: "ready", label: "Ready" },
    /**
     * Not an `upload_state` value: it is the complement of `ready`, and it exists
     * because the "Not ready" KPI counts every state except that one. Without it
     * the tile's figure and the list it links to would disagree.
     */
    { id: "not_ready", label: "Not ready" },
    { id: "processing", label: "Processing" },
    { id: "uploaded", label: "Uploaded, not processed" },
    { id: "pending", label: "Awaiting bytes" },
    { id: "failed", label: "Failed" },
  ],

  /** Every one of these is a SQL `order by` on a column the list already selects. */
  sorts: [
    { id: "recent", label: "Newest first" },
    { id: "oldest", label: "Oldest first" },
    { id: "name", label: "Filename A–Z" },
    { id: "size", label: "Largest first" },
    { id: "duration", label: "Longest first" },
  ],

  /**
   * The upload panel.
   *
   * It states that it does not accept files rather than rendering a drop target
   * that silently swallows them: there is no upload path in the app yet (nothing
   * calls the storage adapter's `putObject`), and a dashed rectangle that looks
   * like a dropzone is a promise the product cannot keep.
   */
  upload: {
    title: "Add assets",
    body: "Assets arrive two ways: a campaign generates them, or you upload source footage and images.",
    unavailable:
      "Direct upload is part of the media phase and is not built yet, so this panel does not accept files. Until it is, generation is the only route into the library.",
    campaignCta: "Create a campaign",
    contentCta: "Open content",
  },

  /**
   * What the "Stored" figure covers.
   *
   * `byte_size` is nullable, so the sum is a total of the rows that carry one. A
   * partial sum presented as the library's size would be a quiet overstatement of
   * how much is known.
   */
  sizeDetail: {
    none: "Nothing stored yet",
    all: "All sizes recorded",
    partial: (sized: number, total: number) =>
      `${sized.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} sized`,
  },

  notReadyDetail: {
    some: "Bytes have not landed",
    none: "Every asset is ready",
  },

  storageHeading: "Stored bytes by type",
  storageEmpty: "No asset in this workspace has a recorded size yet.",

  /**
   * Shown on the well when there is no image to show.
   *
   * Audio, documents and any video without a poster frame have no still to
   * render, and a grey rectangle implies one exists. The glyph names the format
   * instead.
   */
  previewMissing: "No stored preview",

  details: {
    heading: "Asset details",
    open: "Details",
    close: "Close details",
    format: "Format",
    provenance: "Provenance",
    storage: "Storage",
    links: "Used in",
    fields: {
      kind: "Type",
      mimeType: "MIME type",
      dimensions: "Dimensions",
      aspectRatio: "Aspect ratio",
      duration: "Duration",
      codec: "Codec",
      size: "Size",
      source: "Source",
      provider: "Provider",
      model: "Model",
      cost: "Generation cost",
      checksum: "Checksum",
      uploadState: "Upload state",
      scanState: "Scan state",
      added: "Added",
      updated: "Updated",
      bucket: "Bucket",
      path: "Object key",
      campaign: "Campaign",
      contentItem: "Content item",
    },
    notFound: {
      title: "That asset is not in this workspace",
      body: "It may have been deleted, or the link may point at another workspace's asset.",
    },
    noLinks: "Not attached to a campaign or content item.",
  },

  /** A field the row does not carry. Never rendered as 0 or as an empty string. */
  unknown: "Not recorded",
  demoLabel: "Demo",

  empty: {
    title: "The library is empty",
    body: "Assets land here once a campaign generates them, or once source footage is uploaded.",
  },

  noMatches: {
    title: "No assets match those filters",
    body: "Nothing in this workspace matches the current combination.",
  },

  truncated: (shown: number, total: number) =>
    `Showing ${shown} of ${total.toLocaleString("en-US")}. Narrow the filters to find older assets.`,
} as const;

/** `asset_kind` enum values, in the order the filter offers them. */
export const ASSET_KIND_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "source_video", label: "Source video" },
  { id: "generated_video", label: "Generated video" },
  { id: "image", label: "Image" },
  { id: "generated_image", label: "Generated image" },
  { id: "audio", label: "Audio" },
  { id: "voiceover", label: "Voiceover" },
  { id: "music", label: "Music" },
  { id: "thumbnail", label: "Thumbnail" },
  { id: "document", label: "Document" },
  { id: "brand_asset", label: "Brand asset" },
  { id: "export", label: "Export" },
];

export const ASSET_KIND_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  ASSET_KIND_OPTIONS.map((option) => [option.id, option.label]),
);

/**
 * `content_items.content_type` values.
 *
 * These ids must match the column's `$type<>` union exactly. A label that does
 * not correspond to a stored value produces a filter that always returns nothing
 * and gives no indication why.
 */
export const CONTENT_TYPE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "short_video", label: "Short video" },
  { id: "long_video", label: "Long video" },
  { id: "image", label: "Image" },
  { id: "carousel", label: "Carousel" },
  { id: "text", label: "Text" },
];

export const CONTENT_TYPE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((option) => [option.id, option.label]),
);
