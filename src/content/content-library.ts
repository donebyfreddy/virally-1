/**
 * Content and library copy.
 *
 * Kept together because the two surfaces share vocabulary: an "asset" in the
 * library becomes a "variant" once it is bound to a platform, and using
 * different words for the same object across two pages is how a product starts
 * feeling like two products.
 */

export const contentCopy = {
  eyebrow: "CONTENT",
  title: "Every item, and every variant of it.",
  body: "A content item is one idea. Its variants are that idea recomposed for each platform, format and language. Approval happens per variant, because that is what gets published.",
  tableCaption: "Content items in this workspace",

  empty: {
    title: "No content yet.",
    body: "Content appears here once a campaign has generated scripts and assets. You can also upload footage you already have and let Virally recompose it.",
  },

  noMatches: {
    title: "No content matches those filters.",
    body: "Nothing in this workspace matches the current combination. Clearing the filters will show everything again.",
  },

  truncated: (shown: number, total: number) =>
    `Showing the ${shown} most recent of ${total.toLocaleString("en-US")}. Narrow the filters to find older items.`,

  /** Bulk actions are listed but not wired; see the note on the toolbar. */
  bulkUnavailable:
    "Bulk approve, regenerate and schedule act on the publishing pipeline and are part of the review phase. They are not wired up yet, so they are not offered here — a button that silently does nothing is worse than its absence.",
} as const;

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
