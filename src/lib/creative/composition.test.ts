/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  adaptToRatio,
  computeDurationFrames,
  dimensionsFor,
  framesToMs,
  isInsideSafeArea,
  msToFrames,
  safeAreaFor,
  validateComposition,
  type Composition,
  type CompositionClip,
  type CompositionTrack,
} from "./composition";

function clip(overrides: Partial<CompositionClip> = {}): CompositionClip {
  return {
    id: "clip-1",
    startFrame: 0,
    endFrame: 60,
    mediaAssetId: "asset-1",
    sourceOffsetFrames: 0,
    box: { x: 0, y: 0, width: 1, height: 1 },
    text: null,
    motion: null,
    transitionInFrames: 0,
    transitionOutFrames: 0,
    volume: 1,
    ...overrides,
  };
}

function track(overrides: Partial<CompositionTrack> = {}): CompositionTrack {
  return { id: "track-1", kind: "video", layer: 0, muted: false, clips: [clip()], ...overrides };
}

function composition(overrides: Partial<Composition> = {}): Composition {
  return {
    id: "comp-1",
    width: 1080,
    height: 1920,
    fps: 30,
    durationFrames: 60,
    templateId: "faceless-documentary",
    ratio: "9:16",
    tracks: [track()],
    platformOverrides: [],
    brand: {
      primaryColor: "#ffca5c",
      textColor: "#f4f7fb",
      fontFamily: "Geist Sans",
      logoAssetId: null,
    },
    ...overrides,
  };
}

describe("timing", () => {
  it("converts milliseconds to whole frames", () => {
    expect(msToFrames(1000, 30)).toBe(30);
    expect(msToFrames(1500, 30)).toBe(45);
    // Rounds rather than truncating: 33ms at 30fps is one frame, not zero.
    expect(msToFrames(33, 30)).toBe(1);
    expect(msToFrames(0, 30)).toBe(0);
  });

  it("round-trips without drift at frame boundaries", () => {
    for (const ms of [0, 1000, 2000, 5000, 60_000]) {
      expect(framesToMs(msToFrames(ms, 30), 30)).toBe(ms);
    }
  });

  it("derives duration from the last frame any clip occupies", () => {
    const tracks = [
      track({ clips: [clip({ startFrame: 0, endFrame: 30 })] }),
      track({ id: "t2", kind: "voice", clips: [clip({ id: "c2", startFrame: 10, endFrame: 90 })] }),
    ];
    expect(computeDurationFrames(tracks)).toBe(90);
  });
});

describe("format adaptation", () => {
  it("changes the pixel dimensions to the target ratio", () => {
    const adapted = adaptToRatio(composition(), "16:9", "youtube");
    expect(adapted.width).toBe(1920);
    expect(adapted.height).toBe(1080);
    expect(adapted.ratio).toBe("16:9");
  });

  it("does not touch the timeline", () => {
    // Re-framing must never re-time. If adaptation changed frames, the
    // voiceover would desync from the captions in every non-native format.
    const base = composition({
      durationFrames: 300,
      tracks: [track({ clips: [clip({ startFrame: 12, endFrame: 300 })] })],
    });
    const adapted = adaptToRatio(base, "1:1", "instagram");
    const original = base.tracks[0]!.clips[0]!;
    const moved = adapted.tracks[0]!.clips[0]!;

    expect(moved.startFrame).toBe(original.startFrame);
    expect(moved.endFrame).toBe(original.endFrame);
    expect(adapted.durationFrames).toBe(base.durationFrames);
  });

  it("keeps captions inside the target platform's safe area", () => {
    // The failure this prevents: a caption that sat fine in 9:16 for TikTok
    // ending up under the action rail after adaptation, unreadable.
    const base = composition({
      tracks: [
        track(),
        track({
          id: "captions",
          kind: "caption",
          clips: [clip({ id: "cap", box: { x: 0.05, y: 0.95, width: 0.9, height: 0.08 }, text: "Hello", mediaAssetId: null })],
        }),
      ],
    });

    const adapted = adaptToRatio(base, "9:16", "tiktok");
    const caption = adapted.tracks[1]!.clips[0]!;
    expect(isInsideSafeArea(caption.box, "tiktok")).toBe(true);
  });

  it("narrows captions when the frame widens", () => {
    // A caption spanning a full 16:9 frame is a line too long to read at a
    // glance, even though it technically fits.
    const base = composition({
      tracks: [
        track(),
        track({
          id: "captions",
          kind: "caption",
          clips: [clip({ id: "cap", box: { x: 0.05, y: 0.7, width: 0.9, height: 0.08 }, text: "Hi", mediaAssetId: null })],
        }),
      ],
    });

    const widened = adaptToRatio(base, "16:9", "youtube");
    expect(widened.tracks[1]!.clips[0]!.box.width).toBeLessThan(0.9);
  });

  it("leaves audio clips geometrically untouched", () => {
    // A bug that gave audio a box could silently mute a track.
    const base = composition({
      tracks: [
        track(),
        track({ id: "voice", kind: "voice", clips: [clip({ id: "v", volume: 0.8 })] }),
      ],
    });
    const adapted = adaptToRatio(base, "1:1", "instagram");
    const voice = adapted.tracks[1]!.clips[0]!;

    expect(voice.box).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(voice.volume).toBe(0.8);
  });

  it("fills the frame with visual media rather than letterboxing", () => {
    const adapted = adaptToRatio(composition(), "16:9", "youtube");
    expect(adapted.tracks[0]!.clips[0]!.box).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("adapts a clip's camera movement alongside its box", () => {
    const base = composition({
      tracks: [
        track({
          clips: [
            clip({
              motion: {
                from: { x: 0, y: 0, width: 1, height: 1 },
                to: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
              },
            }),
          ],
        }),
      ],
    });
    const adapted = adaptToRatio(base, "4:5", "instagram");
    expect(adapted.tracks[0]!.clips[0]!.motion).not.toBeNull();
  });

  it("gives every supported ratio real dimensions", () => {
    for (const ratio of ["9:16", "4:5", "1:1", "16:9", "4:3"] as const) {
      const { width, height } = dimensionsFor(ratio);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      // Even dimensions: h264 requires them and an odd one fails encoding.
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
    }
  });
});

describe("safe areas", () => {
  it("reserves more bottom space on TikTok than the generic default", () => {
    expect(safeAreaFor("tiktok").bottom).toBeGreaterThan(safeAreaFor("unknown-platform").bottom);
  });

  it("rejects a box that overlaps the platform's own interface", () => {
    expect(isInsideSafeArea({ x: 0.05, y: 0.9, width: 0.9, height: 0.08 }, "tiktok")).toBe(false);
    expect(isInsideSafeArea({ x: 0.05, y: 0.5, width: 0.6, height: 0.08 }, "tiktok")).toBe(true);
  });
});

describe("validation", () => {
  it("accepts a well-formed composition", () => {
    expect(validateComposition(composition())).toHaveLength(0);
  });

  it("catches a stored duration that disagrees with the tracks", () => {
    // Renders trailing black frames, which the quality check then reports as a
    // corrupt export — far from the actual cause.
    const problems = validateComposition(composition({ durationFrames: 900 }));
    expect(problems.map((p) => p.code)).toContain("duration_mismatch");
  });

  it("catches a clip that ends before it starts", () => {
    const problems = validateComposition(
      composition({ tracks: [track({ clips: [clip({ startFrame: 60, endFrame: 30 })] })], durationFrames: 30 }),
    );
    expect(problems.map((p) => p.code)).toContain("empty_clip");
  });

  it("catches a media clip with no asset", () => {
    const problems = validateComposition(
      composition({ tracks: [track({ clips: [clip({ mediaAssetId: null })] })] }),
    );
    expect(problems.map((p) => p.code)).toContain("missing_media");
  });

  it("catches a composition that would render black", () => {
    const problems = validateComposition(
      composition({
        tracks: [track({ id: "voice", kind: "voice", clips: [clip({ id: "v" })] })],
      }),
    );
    expect(problems.map((p) => p.code)).toContain("no_visual");
  });

  it("catches an out-of-range volume", () => {
    const problems = validateComposition(
      composition({ tracks: [track({ clips: [clip({ volume: 4 })] })] }),
    );
    expect(problems.map((p) => p.code)).toContain("invalid_volume");
  });

  it("reports every problem, not just the first", () => {
    const problems = validateComposition(
      composition({
        durationFrames: 999,
        tracks: [track({ clips: [clip({ volume: -1, mediaAssetId: null })] })],
      }),
    );
    expect(problems.length).toBeGreaterThan(2);
  });
});
