import { Bricolage_Grotesque, Geist, JetBrains_Mono } from "next/font/google";

/**
 * Three typographic roles, four weights total across the whole site.
 *
 * Display and Body are preloaded — both appear above the fold in the hero.
 * Utility is not preloaded: its first meaningful use is below the fold, and
 * preloading a third family would push us past the ~95KB woff2 budget.
 */

export const fontDisplay = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["800"],
  display: "swap",
  preload: true,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: true,
});

export const fontBody = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  preload: true,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: true,
});

export const fontUtility = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "monospace"],
});

export const fontVariables = [
  fontDisplay.variable,
  fontBody.variable,
  fontUtility.variable,
].join(" ");
