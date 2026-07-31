import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import {
  appGraphicalTokens,
  appMediaContract,
  appOnColorContract,
  appPalette,
  appSurfaces,
  appTextTokens,
  type AppPaletteToken,
} from "./palette";

/**
 * The authenticated app's light palette, under contract.
 *
 * This file exists because the first pass at this palette was designed by hand
 * arithmetic and three tokens were wrong: the bright aqua the design brief
 * specified measured 2.48:1 on white (failing even the graphical floor), an amber
 * chart series measured 2.90:1 against the muted surface, and the notification
 * badge put white text on a colour only cleared for use as a mark. All three
 * looked fine. None of them were.
 *
 * So the floors are asserted rather than reviewed, and the TS mirror is checked
 * against the shipped CSS so the two cannot drift apart silently.
 */

const APP_THEME_CSS = readFileSync(
  join(process.cwd(), "src/styles/app-theme.css"),
  "utf8",
);

/** WCAG 1.4.3 — normal-size text. */
const TEXT_FLOOR = 4.5;
/** WCAG 1.4.11 — non-text contrast for graphical objects and UI components. */
const GRAPHICAL_FLOOR = 3;

describe("appPalette / app-theme.css parity", () => {
  // Guards against the mirrored TS palette drifting from the shipped CSS. Without
  // this the tests below would keep passing while the browser rendered something
  // else entirely.
  it.each(Object.entries(appPalette))("declares --%s: %s in app-theme.css", (token, hex) => {
    expect(APP_THEME_CSS).toContain(`--${token}: ${hex};`);
  });

  it("scopes every token to .theme-app rather than :root", () => {
    // The marketing site must stay dark. A light token leaking to :root would
    // repaint the landing page, which is the one regression this whole approach
    // is arranged to prevent.
    const rootBlocks = APP_THEME_CSS.match(/(^|\})\s*:root\s*\{/g);
    expect(rootBlocks).toBeNull();
    expect(APP_THEME_CSS).toContain(".theme-app {");
  });
});

describe("text tokens clear 4.5:1 on every app surface", () => {
  const pairs = appTextTokens.flatMap((foreground) =>
    appSurfaces.map((background) => ({ foreground, background })),
  );

  it.each(pairs)("$foreground on $background", ({ foreground, background }) => {
    const ratio = contrastRatio(appPalette[foreground], appPalette[background]);
    expect(
      ratio,
      `${foreground} on ${background} measures ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });
});

describe("graphical tokens clear 3:1 on every app surface", () => {
  const pairs = appGraphicalTokens.flatMap((foreground) =>
    appSurfaces.map((background) => ({ foreground, background })),
  );

  it.each(pairs)("$foreground on $background", ({ foreground, background }) => {
    const ratio = contrastRatio(appPalette[foreground], appPalette[background]);
    expect(
      ratio,
      `${foreground} on ${background} measures ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(GRAPHICAL_FLOOR);
  });
});

describe("text on coloured fills", () => {
  it.each(appOnColorContract)("$note — $foreground on $background", ({ foreground, background }) => {
    const ratio = contrastRatio(appPalette[foreground], appPalette[background]);
    expect(
      ratio,
      `${foreground} on ${background} measures ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(TEXT_FLOOR);
  });
});

describe("the text ramp has usable separation", () => {
  // Three tokens within a whisker of each other read as one washed-out grey, which
  // is the most common way a light theme loses its hierarchy while still passing
  // every contrast check individually.
  const ramp = ["text-primary", "text-secondary", "text-muted"] as const;

  it.each([0, 1])("step %i is meaningfully darker than the next", (index) => {
    const stronger = appPalette[ramp[index]];
    const weaker = appPalette[ramp[index + 1]];
    const white = appPalette["surface-primary"];
    const strongerRatio = contrastRatio(stronger, white);
    const weakerRatio = contrastRatio(weaker, white);

    expect(strongerRatio).toBeGreaterThan(weakerRatio * 1.25);
  });
});

describe("the chart ramp", () => {
  const series = ["chart-1", "chart-2", "chart-3", "chart-4"] as const;

  it("assigns teal to series 1, the primary measure", () => {
    expect(appPalette["chart-1"]).toBe(appPalette["brand-mark"]);
  });

  it("keeps every adjacent pair separated in greyscale", () => {
    // Hue is never the only channel — every series also carries the mandatory
    // stroke pattern from tokens.css — but a pair that is identical in luminance
    // AND close in hue is still a bad chart for a deutan reader.
    for (let i = 1; i < series.length; i += 1) {
      const ratio = contrastRatio(appPalette[series[i - 1]], appPalette[series[i]]);
      expect(ratio, `${series[i - 1]} → ${series[i]} separated by ${ratio.toFixed(3)}`).toBeGreaterThan(
        1.05,
      );
    }
  });
});

describe("the brand pair", () => {
  it("holds the mark and the text teal in the same hue family", () => {
    // If these drift apart the product stops reading as having one accent and
    // starts reading as having two teals, which is worse than having one.
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      let h: number;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return ((h * 60) + 360) % 360;
    };

    expect(Math.abs(hue(appPalette["brand-primary"]) - hue(appPalette["brand-mark"]))).toBeLessThan(
      12,
    );
  });

  it("keeps the mark too light to carry text, which is why the pair exists", () => {
    // A guard against someone "simplifying" the pair down to one token: the mark
    // MUST fail the text floor on white. If it ever passes, the split has been
    // quietly collapsed and --brand-mark will start appearing on labels.
    const onWhite = contrastRatio(appPalette["brand-mark"], appPalette["surface-primary"]);
    expect(onWhite).toBeLessThan(TEXT_FLOOR);
    expect(onWhite).toBeGreaterThanOrEqual(GRAPHICAL_FLOOR);
  });
});

describe("surfaces are close together on purpose", () => {
  it("keeps every surface step subtle", () => {
    // On a light theme the boundary between surfaces is carried by a border, not
    // by a luminance jump. Stacking high-contrast greys is what makes a light
    // dashboard look like a spreadsheet.
    for (let i = 1; i < appSurfaces.length; i += 1) {
      const ratio = contrastRatio(appPalette[appSurfaces[i - 1]], appPalette[appSurfaces[i]]);
      expect(ratio).toBeLessThan(1.2);
    }
  });

  it("still separates the lightest from the darkest enough to be seen", () => {
    const ratio = contrastRatio(
      appPalette["surface-primary"],
      appPalette[appSurfaces[appSurfaces.length - 1] as AppPaletteToken],
    );
    expect(ratio).toBeGreaterThan(1.05);
  });
});

describe("the media canvas", () => {
  it.each(appMediaContract)("$note", ({ foreground, floor }) => {
    const ratio = contrastRatio(appPalette[foreground], appPalette["media-canvas"]);
    expect(
      ratio,
      `${foreground} on media-canvas measures ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(floor);
  });

  it("keeps --text-secondary off the canvas", () => {
    // A guard, not a check. The light-surface text ramp is unusable on a dark
    // well — secondary measures ~2.1:1 there — and the failure mode is someone
    // reaching for the token they use everywhere else. If this ever passes, the
    // canvas has been lightened into a surface that no longer serves its purpose.
    expect(contrastRatio(appPalette["text-secondary"], appPalette["media-canvas"])).toBeLessThan(3);
  });

  it("shares its value with the text ink deliberately", () => {
    // One dark in the system. If these ever diverge it should be a decision, not
    // a drift — so the equality is asserted rather than left as a coincidence.
    expect(appPalette["media-canvas"]).toBe(appPalette["text-primary"]);
  });
});
