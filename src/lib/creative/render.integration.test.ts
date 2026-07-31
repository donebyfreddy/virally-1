/**
 * @vitest-environment node
 *
 * End-to-end render: composition model -> Remotion -> MP4 -> ffprobe.
 *
 * This is the test that proves the pipeline actually produces video, rather
 * than that its parts type-check. It bundles the real Remotion entry point,
 * renders in real headless Chromium, and inspects the output with the same
 * quality checks the product runs on a real export.
 *
 * Slow by nature — bundling and a browser launch dominate — so it is scoped to
 * a 2-second composition and lives in the integration suite. The first run also
 * downloads Chrome Headless Shell (~150MB); the test is skipped rather than
 * failed if the renderer is unavailable, and the skip is reported.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adaptToRatio } from "./composition";
import { checkExport } from "./quality";
import { CompositionInvalidError, isRendererAvailable, renderComposition } from "./render";
import { buildComposition } from "@/remotion/templates";

const CAN_RENDER = isRendererAvailable();

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "virally-render-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BRAND = {
  primaryColor: "#ffca5c",
  textColor: "#f4f7fb",
  fontFamily: "sans-serif",
  logoAssetId: null,
};

/**
 * A 2x2 solid PNG as a data URI.
 *
 * Data URIs rather than files or fixtures on disk: Remotion renders inside a
 * headless browser served from a bundled dev server, so a `file://` path would
 * not resolve, and a network URL would make the test non-hermetic. Inlining
 * keeps the render self-contained while still exercising the real <Img> path.
 */
const RED_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8Dwn4GBgYEJQoAAIxUD4wF2vAX3AAAAAElFTkSuQmCC";

const ASSET_URLS = { a1: RED_PNG, a2: RED_PNG } as const;

/**
 * A short two-shot reel backed by inline images.
 *
 * Real asset ids, because `validateComposition` refuses a media clip with no
 * asset — a null here would render a silent gap, and that guard is exactly what
 * the first version of this test tripped over.
 */
function shortReel(ratio: "9:16" | "1:1" | "16:9" = "9:16") {
  return buildComposition({
    templateId: "faceless-documentary",
    ratio,
    platform: "tiktok",
    fps: 24,
    shots: [
      { id: "s1", startMs: 0, endMs: 1000, mediaAssetId: "a1", mediaKind: "image", onScreenText: "First beat" },
      { id: "s2", startMs: 1000, endMs: 2000, mediaAssetId: "a2", mediaKind: "image", onScreenText: "Second beat" },
    ],
    voiceAssetId: null,
    musicAssetId: null,
    hookText: "Hook line",
    ctaText: "Follow",
    brand: BRAND,
  });
}

describe.skipIf(!CAN_RENDER)("render pipeline (integration)", () => {
  it("renders a composition to a real, decodable MP4", { timeout: 600_000 }, async () => {
    const composition = shortReel();
    const outputPath = join(dir, "reel.mp4");

    const progress: number[] = [];
    const result = await renderComposition({
      composition,
      assetUrls: ASSET_URLS,
      outputPath,
      onProgress: (value) => progress.push(value),
    });

    const file = await stat(outputPath);
    expect(file.size).toBeGreaterThan(1000);

    // Metadata came from the composition, not from the placeholder registered
    // in Root.tsx — the failure `calculateMetadata` exists to prevent.
    expect(result.width).toBe(composition.width);
    expect(result.height).toBe(composition.height);
    expect(result.durationFrames).toBe(composition.durationFrames);

    // Progress is reported and monotonic, so a UI can show real state rather
    // than a fake timer.
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]!);
    }

    const report = await checkExport(outputPath, {
      ratio: "9:16",
      expectedDurationMs: 2000,
      expectsAudio: false,
      minHeightPx: 1080,
    });

    expect(report.checks.find((c) => c.id === "decodable")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "aspect_ratio")?.status).toBe("pass");
    expect(report.checks.find((c) => c.id === "video_codec")?.status).toBe("pass");
    expect(report.probe?.widthPx).toBe(1080);
    expect(report.probe?.heightPx).toBe(1920);
    expect(report.passed).toBe(true);
  });

  it("renders the SAME composition at another ratio without re-timing it", { timeout: 600_000 }, async () => {
    // The product claim: format adaptation is a re-frame, not a re-generation.
    const base = shortReel();
    const square = adaptToRatio(base, "1:1", "instagram");
    const outputPath = join(dir, "reel-square.mp4");

    const result = await renderComposition({ composition: square, assetUrls: ASSET_URLS, outputPath });

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1080);
    // Same timeline, different shape.
    expect(result.durationFrames).toBe(base.durationFrames);

    const report = await checkExport(outputPath, {
      ratio: "1:1",
      expectedDurationMs: 2000,
      expectsAudio: false,
      minHeightPx: 1080,
    });
    expect(report.passed).toBe(true);
  });

  it("refuses an invalid composition before spending a render", async () => {
    // Validation runs before bundling. This must reject in milliseconds, not
    // after a browser launch.
    const broken = { ...shortReel(), durationFrames: 99_999 };

    await expect(
      renderComposition({ composition: broken, assetUrls: ASSET_URLS, outputPath: join(dir, "never.mp4") }),
    ).rejects.toBeInstanceOf(CompositionInvalidError);
  });
});

describe.skipIf(CAN_RENDER)("render pipeline (integration)", () => {
  it("is skipped because @remotion/renderer is not installed", () => {
    expect(CAN_RENDER).toBe(false);
  });
});
