import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Integration tests need a real database and live in their own config
    // (vitest.integration.config.ts). Excluded here so `npm test` stays fast,
    // hermetic and runnable with no DATABASE_URL.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.integration.test.ts"],
  },
});
