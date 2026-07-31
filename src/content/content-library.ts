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

export const libraryCopy = {
  eyebrow: "LIBRARY",
  title: "Source footage and everything generated from it.",
  body: "Every asset the workspace holds: uploads, generated stills and clips, voiceovers, music and finished exports. Assets are reusable across campaigns.",

  empty: {
    title: "The library is empty.",
    body: "Assets arrive two ways: you upload source footage and images, or a campaign generates them. Both land here and stay reusable.",
  },

  noMatches: {
    title: "No assets match those filters.",
    body: "Nothing in this workspace matches the current combination. Clearing the filters will show everything again.",
  },

  uploadUnavailable:
    "Direct upload is part of the media phase and is not wired up yet. Assets currently arrive through campaign generation.",
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
