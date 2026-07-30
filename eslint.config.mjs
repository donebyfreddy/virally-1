import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      // The content architecture forbids `any` outright.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    // Token discipline: raw colour values may not appear in components.
    // Tokens live in styles/tokens.css and are mirrored (with parity tests) in
    // lib/accessibility/palette.ts — nowhere else.
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b/]",
          message:
            "Hardcoded hex colour. Use a design token from styles/tokens.css instead.",
        },
        {
          selector:
            "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b/]",
          message:
            "Hardcoded hex colour. Use a design token from styles/tokens.css instead.",
        },
      ],
    },
  },

  {
    // The kitchen sink renders the palette itself, so it must be able to
    // import and display raw values.
    files: ["src/app/dev/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
