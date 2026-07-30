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
];
