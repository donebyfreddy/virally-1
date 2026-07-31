/**
 * The palette, mirrored from `styles/tokens.css` so it can be measured in
 * tests and rendered in the kitchen sink.
 *
 * `tokens.test.ts` parses the CSS file and asserts every value here matches,
 * so drift between the two fails the test run rather than shipping.
 */

export const palette = {
  canvas: "#07090d",
  "surface-1": "#10151c",
  "surface-2": "#1a212b",
  "surface-3": "#28313f",

  "text-primary": "#f4f7fb",
  "text-secondary": "#a8b2c1",
  "text-muted": "#8d99ab",
  "text-oncolor": "#07090d",

  "border-hairline": "#1f2733",
  border: "#79849a",
  "border-strong": "#98a4b5",

  action: "#ffca5c",
  "action-hover": "#ffd77e",
  "action-press": "#f0b840",
  signal: "#38dfbd",
  focus: "#ffca5c",

  success: "#4dcc88",
  warning: "#f2b84b",
  error: "#ff7070",
  info: "#6ba8ff",

  /**
   * Chart series. The one licensed categorical ramp — see the CHARTS block in
   * tokens.css for why this exists alongside the two-accent taxonomy, and for
   * the six-check validator results these values were selected against.
   *
   * Drawn on surface-1 (the panel), so that is the pairing under contract
   * below. Series colour is assigned by index and is always redundant with a
   * direct label and a stroke pattern, so these carry no meaning alone.
   */
  "chart-1": "#2177f1",
  "chart-2": "#00ae8a",
  "chart-3": "#a952ff",
  "chart-4": "#c68000",
} as const;

export type PaletteToken = keyof typeof palette;

export const surfaces = [
  "canvas",
  "surface-1",
  "surface-2",
  "surface-3",
] as const satisfies readonly PaletteToken[];

/**
 * Every pairing the site actually relies on, with the floor each must clear.
 * `large: true` means the 3:1 floor for large text and UI components.
 */
export const contrastContract: ReadonlyArray<{
  foreground: PaletteToken;
  background: PaletteToken;
  large: boolean;
  note: string;
}> = [
  { foreground: "text-primary", background: "canvas", large: false, note: "Body on canvas" },
  { foreground: "text-primary", background: "surface-1", large: false, note: "Body on band" },
  { foreground: "text-primary", background: "surface-2", large: false, note: "Body in card" },
  { foreground: "text-primary", background: "surface-3", large: false, note: "Body on raised control" },
  { foreground: "text-secondary", background: "canvas", large: false, note: "Secondary on canvas" },
  { foreground: "text-secondary", background: "surface-2", large: false, note: "Secondary in card" },
  { foreground: "text-secondary", background: "surface-3", large: false, note: "Secondary on raised" },
  { foreground: "text-muted", background: "canvas", large: false, note: "Muted on canvas" },
  { foreground: "text-muted", background: "surface-1", large: false, note: "Muted on band" },
  { foreground: "text-muted", background: "surface-2", large: false, note: "Muted in card" },
  { foreground: "text-muted", background: "surface-3", large: false, note: "Muted on raised" },
  { foreground: "action", background: "canvas", large: false, note: "Action text on canvas" },
  { foreground: "action", background: "surface-2", large: false, note: "Action text in card" },
  { foreground: "text-oncolor", background: "action", large: false, note: "Primary button label" },
  { foreground: "signal", background: "canvas", large: false, note: "Machine state on canvas" },
  { foreground: "signal", background: "surface-2", large: false, note: "Machine state in card" },
  { foreground: "border", background: "canvas", large: true, note: "Control border on canvas" },
  { foreground: "border", background: "surface-2", large: true, note: "Control border in card" },
  { foreground: "border", background: "surface-3", large: true, note: "Control border on raised" },
  { foreground: "focus", background: "canvas", large: true, note: "Focus ring on canvas" },
  { foreground: "focus", background: "surface-2", large: true, note: "Focus ring in card" },
  { foreground: "focus", background: "surface-3", large: true, note: "Focus ring on raised" },
  { foreground: "success", background: "canvas", large: false, note: "Success" },
  { foreground: "warning", background: "canvas", large: false, note: "Warning" },
  { foreground: "error", background: "canvas", large: false, note: "Error on canvas" },
  { foreground: "error", background: "surface-2", large: false, note: "Error in card" },
  { foreground: "info", background: "canvas", large: false, note: "Info" },

  // Chart series are drawn on surface-1, the panel, and are held to the 3:1
  // graphical-object floor rather than the 4.5:1 text floor. That is not a
  // relaxation: series colour never carries text. Legend and axis labels wear
  // the text tokens and a coloured mark sits beside them, so nothing a reader
  // has to READ is ever rendered in a series colour.
  { foreground: "chart-1", background: "surface-1", large: true, note: "Chart series 1 mark on panel" },
  { foreground: "chart-2", background: "surface-1", large: true, note: "Chart series 2 mark on panel" },
  { foreground: "chart-3", background: "surface-1", large: true, note: "Chart series 3 mark on panel" },
  { foreground: "chart-4", background: "surface-1", large: true, note: "Chart series 4 mark on panel" },
];

/**
 * The chart ramp, in the fixed order series are assigned.
 *
 * Exported as an ordered tuple rather than left for callers to index into
 * `palette`: assignment order is part of the contract (series 1 is always the
 * primary measure), and a caller picking its own order would break the
 * consistency that makes the ramp readable across pages.
 */
export const chartSeries = ["chart-1", "chart-2", "chart-3", "chart-4"] as const satisfies readonly PaletteToken[];

/**
 * The stroke pattern each series must carry, mirrored from tokens.css.
 *
 * This is not styling polish — it is the accessibility mechanism for the ramp.
 * The four series colours are all bright so they stay legible as thin lines on
 * a dark panel, which necessarily puts them close together in luminance
 * (series 1 and 3 measure 1.04 apart, i.e. indistinguishable in greyscale).
 * The dash pattern is what a reader who cannot separate the hues uses instead,
 * so a chart drawn without it is not accessible.
 */
export const chartDashPatterns: Readonly<Record<(typeof chartSeries)[number], string>> = {
  "chart-1": "none",
  "chart-2": "6 3",
  "chart-3": "2 3",
  "chart-4": "10 3 2 3",
};

/**
 * Legibility floor for a series mark on the panel it is drawn on.
 *
 * The 3:1 graphical-object floor. Series colour never carries text — see the
 * contrast contract above — so the 4.5:1 text floor does not apply, and holding
 * the ramp to it would force the four hues brighter than the validated
 * lightness band allows.
 */
export const CHART_SERIES_MIN_CONTRAST = 3;

/* ==========================================================================
   THE AUTHENTICATED APP PALETTE

   Mirrored from `styles/app-theme.css`, for the same reason the dark palette is
   mirrored from `tokens.css`: so the values can be MEASURED in a test rather
   than reviewed by eye. `appPalette.test.ts` asserts every hex here appears in
   the CSS, so drift between the two fails the test run instead of shipping.

   This exists as a second palette rather than as extra keys on the first because
   the two are genuinely different systems with different contrast maths. A token
   that passes on #07090d tells you nothing about #ffffff — the dark chart ramp
   was tuned against a near-black panel and measures as low as 1.5:1 on white.
   ========================================================================= */

export const appPalette = {
  "app-background": "#f4f7f8",
  "surface-primary": "#ffffff",
  "surface-secondary": "#f8fafb",
  "surface-muted": "#f1f5f6",

  "text-primary": "#17212b",
  "text-secondary": "#48545f",
  "text-muted": "#636f7d",
  "text-on-brand": "#ffffff",

  "brand-primary": "#0f766e",
  "brand-primary-hover": "#0c6058",
  "brand-primary-active": "#0a524b",
  "brand-mark": "#0d9488",
  "brand-soft": "#ddf5f1",
  "brand-soft-border": "#a7ddd6",
  "brand-ink": "#0f766e",

  "accent-secondary": "#4f5fd7",

  success: "#0c7a54",
  "success-mark": "#16a06b",
  "success-soft": "#e2f6ed",

  warning: "#8a5a00",
  "warning-mark": "#b8780a",
  "warning-soft": "#fdf2df",

  error: "#c02f3c",
  "error-mark": "#d94452",
  "error-soft": "#fceaec",

  info: "#1d6fc4",
  "info-mark": "#3d86e0",
  "info-soft": "#edf4fd",

  "border-subtle": "#eaeff1",
  "border-default": "#dae2e5",
  "border-strong": "#c3ced3",
  "border-control": "#818f9a",

  "focus-ring": "#0f766e",

  /* The one dark surface. Same value as --text-primary by design — see the
     MEDIA CANVAS block in app-theme.css. */
  "media-canvas": "#17212b",
  "text-on-media": "#ffffff",

  "chart-1": "#0d9488",
  "chart-2": "#2563eb",
  "chart-3": "#7c3aed",
  "chart-4": "#cf7005",
} as const;

export type AppPaletteToken = keyof typeof appPalette;

/**
 * The four light surfaces, lightest first.
 *
 * `surface-muted` is the darkest, so a foreground that clears its floor against
 * that one clears it against all four. The contract below still states each
 * pairing explicitly rather than relying on that shortcut, because the shortcut
 * stops being true the moment someone adds a fifth surface.
 */
export const appSurfaces = [
  "surface-primary",
  "surface-secondary",
  "app-background",
  "surface-muted",
] as const satisfies readonly AppPaletteToken[];

/**
 * Foregrounds that carry TEXT. Every one must clear 4.5:1 on every surface.
 *
 * Note what is absent: `--brand-mark` and each `--{state}-mark`. Those are the
 * 3:1 graphical halves of their pairs and are never allowed to render text —
 * that split is the whole reason the pairs exist, and this list is where the rule
 * is enforced rather than merely documented.
 */
export const appTextTokens = [
  "text-primary",
  "text-secondary",
  "text-muted",
  "success",
  "warning",
  "error",
  "info",
  "brand-primary",
  "brand-ink",
  "accent-secondary",
] as const satisfies readonly AppPaletteToken[];

/**
 * Foregrounds that are drawn, not read: chart strokes, progress fills, status
 * dots, form-control borders. Held to the 3:1 graphical-object floor of WCAG
 * 1.4.11.
 */
export const appGraphicalTokens = [
  "brand-mark",
  "success-mark",
  "warning-mark",
  "error-mark",
  "info-mark",
  "border-control",
  "focus-ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
] as const satisfies readonly AppPaletteToken[];

/**
 * Pairings that do not involve a surface: text on a coloured fill.
 *
 * These are the ones a light-theme palette gets wrong most often, because the
 * fill is chosen for how it looks as a block and the label is added afterwards.
 */
/**
 * The media canvas is a surface, so its foregrounds need their own contract — the
 * app-surface lists above are all light and say nothing about a dark well.
 */
export const appMediaContract: ReadonlyArray<{
  foreground: AppPaletteToken;
  floor: number;
  note: string;
}> = [
  { foreground: "text-on-media", floor: 4.5, note: "Message and transport text on the canvas" },
  { foreground: "brand-mark", floor: 3, note: "Decorative glyph on the canvas — graphical only" },
];

export const appOnColorContract: ReadonlyArray<{
  foreground: AppPaletteToken;
  background: AppPaletteToken;
  note: string;
}> = [
  { foreground: "text-on-brand", background: "brand-primary", note: "Primary button label" },
  { foreground: "text-on-brand", background: "brand-primary-hover", note: "Primary button, hover" },
  { foreground: "text-on-brand", background: "brand-primary-active", note: "Primary button, active" },
  { foreground: "text-on-brand", background: "error", note: "Notification count badge" },
  { foreground: "brand-ink", background: "brand-soft", note: "Active rail item, soft chip" },
  { foreground: "text-secondary", background: "brand-soft", note: "Secondary text on a soft chip" },
  { foreground: "success", background: "success-soft", note: "Approved status chip" },
  { foreground: "warning", background: "warning-soft", note: "Needs-review status chip" },
  { foreground: "error", background: "error-soft", note: "Rejected status chip, error panel" },
  { foreground: "info", background: "info-soft", note: "Informational chip" },
];
