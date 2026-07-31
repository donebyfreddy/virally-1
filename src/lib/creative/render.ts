import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Composition } from "./composition";
import { validateComposition } from "./composition";

/**
 * Rendering a composition to a file, via Remotion.
 *
 * Remotion's bundler and renderer are imported LAZILY, inside the functions
 * that use them. They pull in a headless Chromium and a webpack bundler —
 * hundreds of megabytes of dependency that must never be loaded by a Next.js
 * request handler, a page, or a unit test that merely imports something else
 * from this module. A top-level import would do exactly that.
 *
 * Nothing here runs in a request. A render takes minutes and holds a browser
 * open; it belongs to a worker, which is why this module exposes a plain async
 * function and takes no session.
 */

/** Entry point Remotion bundles. Registers the single generic composition. */
const ENTRY_POINT = "src/remotion/index.ts";

/** Composition id registered in src/remotion/Root.tsx. */
const COMPOSITION_ID = "Reel";

export type RenderRequest = {
  composition: Composition;
  /** Publicly fetchable URL per media asset id. Signed by the caller. */
  assetUrls: Readonly<Record<string, string>>;
  /** Absolute path to write the MP4 to. */
  outputPath: string;
  /** Reported 0..1. Called often; must be cheap. */
  onProgress?: (progress: number) => void;
  /**
   * Parallel Chromium tabs. Defaults to Remotion's own choice.
   *
   * Worth capping on a shared worker: each tab is a full browser process, and
   * saturating the box makes every concurrent render slower rather than any of
   * them faster.
   */
  concurrency?: number;
};

export type RenderResult = {
  outputPath: string;
  durationFrames: number;
  width: number;
  height: number;
};

export class RenderNotAvailableError extends Error {
  constructor(detail: string) {
    super(`Rendering is not available: ${detail}`);
    this.name = "RenderNotAvailableError";
  }
}

export class CompositionInvalidError extends Error {
  readonly problems: readonly { code: string; message: string }[];
  constructor(problems: readonly { code: string; message: string }[]) {
    super(`The composition cannot be rendered: ${problems.map((p) => p.message).join(" ")}`);
    this.name = "CompositionInvalidError";
    this.problems = problems;
  }
}

/** Whether Remotion's renderer is installed in this deployment. */
export function isRendererAvailable(): boolean {
  try {
    // `require.resolve` rather than an import: this must answer the question
    // without loading the package.
    require.resolve("@remotion/renderer");
    require.resolve("@remotion/bundler");
    return true;
  } catch {
    return false;
  }
}

/**
 * Renders a composition to an MP4.
 *
 * Validates BEFORE bundling. Rendering is the expensive step — minutes of CPU
 * and a browser — so every fault detectable by reading the model is caught
 * first rather than after the spend.
 */
export async function renderComposition(request: RenderRequest): Promise<RenderResult> {
  const problems = validateComposition(request.composition);
  if (problems.length > 0) throw new CompositionInvalidError(problems);

  if (!isRendererAvailable()) {
    throw new RenderNotAvailableError(
      "@remotion/renderer and @remotion/bundler are not installed. Install them on the worker, not on the web deployment.",
    );
  }

  if (!existsSync(ENTRY_POINT)) {
    throw new RenderNotAvailableError(
      `The Remotion entry point ${ENTRY_POINT} was not found. Renders must run from the repository root.`,
    );
  }

  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");

  await mkdir(dirname(request.outputPath), { recursive: true });

  const inputProps = {
    composition: request.composition,
    assetUrls: request.assetUrls,
  };

  const serveUrl = await bundle({
    entryPoint: ENTRY_POINT,
    /**
     * Teaches Remotion's webpack the `@/*` path alias.
     *
     * Remotion bundles with its own webpack config and does NOT read
     * tsconfig.json's `paths`. Without this, `@/lib/creative/composition`
     * resolves to `node_modules/@/lib` and the bundle fails — which is a build
     * error at render time, long after type-checking passed.
     */
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          "@": join(process.cwd(), "src"),
        },
      },
    }),
  });

  // Resolves the composition through `calculateMetadata`, so dimensions and
  // duration come from the composition being rendered rather than from the
  // placeholder registered in Root.tsx. Skipping this is how every export ends
  // up at the placeholder's size regardless of the format requested.
  const selected = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
  });

  await renderMedia({
    composition: selected,
    serveUrl,
    codec: "h264",
    outputLocation: request.outputPath,
    inputProps,
    concurrency: request.concurrency,
    // yuv420p is required for playback on Safari and on every social platform.
    // Remotion's default is fine for h264, but stating it means a codec change
    // cannot silently produce a file that plays nowhere.
    pixelFormat: "yuv420p",
    onProgress: request.onProgress
      ? ({ progress }) => request.onProgress?.(progress)
      : undefined,
  });

  return {
    outputPath: request.outputPath,
    durationFrames: selected.durationInFrames,
    width: selected.width,
    height: selected.height,
  };
}
