import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests — run against a REAL Postgres.
 *
 * Separate from vitest.config.ts for three reasons, each of which caused a real
 * failure before this file existed:
 *
 * 1. `pool: "forks"`. The default worker-thread pool loses DNS resolution in
 *    this environment, so every connection to Neon failed with ENOTFOUND while
 *    the identical query succeeded from the shell. Forks get a normal process
 *    resolver.
 *
 * 2. `testTimeout: 30_000`. These tests do several round trips to a remote
 *    database inside a transaction. The 5s default timed out mid-transaction,
 *    which looks exactly like a deadlock and is not one.
 *
 * 3. `environment: "node"` and no jsdom setup file. These exercise server-only
 *    modules; a `window` present would trip the credential guard in
 *    src/lib/creative/env.ts.
 *
 * Run with `npm run test:integration`. `npm test` excludes these so it stays
 * fast and needs no database.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    // Serialised: these tests contend on advisory locks and assert exact
    // balances, so concurrent files would interfere with each other's timing.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
