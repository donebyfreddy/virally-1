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
   * tokens.css for why this exists alongside the two-accent taxonomy.
   *
   * Drawn on surface-1 (the panel), so that is the pairing under contract
   * below. Series colour is assigned by index and is always redundant with a
   * direct label, so these carry no meaning on their own.
   */
  "chart-1": "#6ba8ff",
  "chart-2": "#38dfbd",
  "chart-3": "#c08cf5",
  "chart-4": "#f2b84b",
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

  // Chart series are drawn on surface-1, the panel. Held to the 4.5:1 text
  // floor rather than the 3:1 graphical-object floor: a series is always
  // directly labelled, and that label must be readable in the series colour.
  { foreground: "chart-1", background: "surface-1", large: false, note: "Chart series 1 on panel" },
  { foreground: "chart-2", background: "surface-1", large: false, note: "Chart series 2 on panel" },
  { foreground: "chart-3", background: "surface-1", large: false, note: "Chart series 3 on panel" },
  { foreground: "chart-4", background: "surface-1", large: false, note: "Chart series 4 on panel" },
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
 * Legibility floor for a series line on the panel it is drawn on.
 *
 * Held at the 4.5:1 text floor rather than the 3:1 graphical floor because a
 * series is always directly labelled in its own colour, and that label is text.
 */
export const CHART_SERIES_MIN_CONTRAST = 4.5;
