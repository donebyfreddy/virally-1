/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import {
  adaptToRatio,
  computeDurationFrames,
  isInsideSafeArea,
  validateComposition,
} from "@/lib/creative/composition";
import { PRODUCTION_MODE_DEFAULTS } from "@/lib/creative/modes";
import { TEMPLATES, buildComposition, templateDefinition, type BuildInput } from "./templates";

const BRAND = {
  primaryColor: "#ffca5c",
  textColor: "#f4f7fb",
  fontFamily: "Geist Sans",
  logoAssetId: null,
};

function input(overrides: Partial<BuildInput> = {}): BuildInput {
  return {
    templateId: "faceless-documentary",
    ratio: "9:16",
    platform: "tiktok",
    fps: 30,
    shots: [
      { id: "s1", startMs: 0, endMs: 3000, mediaAssetId: "a1", mediaKind: "image", onScreenText: "One" },
      { id: "s2", startMs: 3000, endMs: 6000, mediaAssetId: "a2", mediaKind: "image", onScreenText: "Two" },
      { id: "s3", startMs: 6000, endMs: 9000, mediaAssetId: "a3", mediaKind: "image", onScreenText: "Three" },
    ],
    voiceAssetId: "voice-1",
    musicAssetId: "music-1",
    hookText: "The hook",
    ctaText: "Follow for more",
    brand: BRAND,
    ...overrides,
  };
}

describe("template catalogue", () => {
  it("offers the ten templates the brief specifies", () => {
    expect(TEMPLATES).toHaveLength(10);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(10);
  });

  it("assigns every template to at least one production mode", () => {
    const modes = new Set(PRODUCTION_MODE_DEFAULTS.map((m) => m.id));
    for (const template of TEMPLATES) {
      expect(template.modes.length).toBeGreaterThan(0);
      for (const mode of template.modes) expect(modes.has(mode)).toBe(true);
    }
  });

  it("offers at least one template in every production mode", () => {
    for (const mode of PRODUCTION_MODE_DEFAULTS) {
      expect(TEMPLATES.some((t) => t.modes.includes(mode.id))).toBe(true);
    }
  });

  it("throws on an unknown template rather than returning a default", () => {
    // @ts-expect-error — deliberately outside the union.
    expect(() => templateDefinition("does-not-exist")).toThrow();
  });
});

describe("composition building", () => {
  it("produces a valid composition for every template", () => {
    for (const template of TEMPLATES) {
      const composition = buildComposition(input({ templateId: template.id }));
      expect(validateComposition(composition)).toEqual([]);
    }
  });

  it("derives duration from the shots rather than storing a guess", () => {
    const composition = buildComposition(input());
    // 9000ms at 30fps.
    expect(composition.durationFrames).toBe(270);
    expect(composition.durationFrames).toBe(computeDurationFrames(composition.tracks));
  });

  it("is deterministic", () => {
    // A re-render after an unrelated edit must not silently reflow the reel.
    expect(buildComposition(input())).toEqual(buildComposition(input()));
  });

  it("does not fade in on the first shot", () => {
    // A reel that opens on black loses the first second of attention.
    const composition = buildComposition(input());
    const first = composition.tracks[0]!.clips[0]!;
    expect(first.startFrame).toBe(0);
    expect(first.transitionInFrames).toBe(0);
  });

  it("adds camera movement to stills but not to generated video", () => {
    const stills = buildComposition(input());
    expect(stills.tracks[0]!.clips[0]!.motion).not.toBeNull();

    const video = buildComposition(
      input({
        templateId: "product-demo",
        shots: [
          { id: "s1", startMs: 0, endMs: 5000, mediaAssetId: "v1", mediaKind: "video", onScreenText: null },
        ],
      }),
    );
    // Generated footage already moves; a second movement on top reads as a bug.
    expect(video.tracks[0]!.clips[0]!.motion).toBeNull();
  });

  it("alternates camera direction so consecutive shots do not all drift the same way", () => {
    const composition = buildComposition(input());
    const [a, b] = composition.tracks[0]!.clips;
    expect(a!.motion!.from.width).not.toBe(b!.motion!.from.width);
  });

  it("places captions inside the platform's safe area", () => {
    for (const platform of ["tiktok", "instagram", "youtube", "facebook"]) {
      const composition = buildComposition(input({ platform }));
      const captions = composition.tracks.find((t) => t.kind === "caption");
      expect(captions!.clips.length).toBeGreaterThan(0);
      for (const clip of captions!.clips) {
        expect(isInsideSafeArea(clip.box, platform)).toBe(true);
      }
    }
  });

  it("ducks music under the voiceover", () => {
    // Music at parity makes narration unintelligible on a phone speaker.
    const withVoice = buildComposition(input());
    const music = withVoice.tracks.find((t) => t.kind === "music")!.clips[0]!;
    const voice = withVoice.tracks.find((t) => t.kind === "voice")!.clips[0]!;
    expect(music.volume).toBeLessThan(voice.volume);

    // With no voice, music carries the reel and comes up.
    const noVoice = buildComposition(input({ voiceAssetId: null }));
    const soloMusic = noVoice.tracks.find((t) => t.kind === "music")!.clips[0]!;
    expect(soloMusic.volume).toBeGreaterThan(music.volume);
  });

  it("mutes generated video's own audio so it cannot fight the voiceover", () => {
    const composition = buildComposition(
      input({
        templateId: "product-demo",
        shots: [
          { id: "s1", startMs: 0, endMs: 5000, mediaAssetId: "v1", mediaKind: "video", onScreenText: null },
        ],
      }),
    );
    expect(composition.tracks[0]!.clips[0]!.volume).toBe(0);
  });

  it("omits the hook card for templates that do not use one", () => {
    const quote = buildComposition(input({ templateId: "quote" }));
    const overlays = quote.tracks.find((t) => t.kind === "overlay");
    expect(overlays?.clips.some((c) => c.id === "hook-card") ?? false).toBe(false);
  });

  it("ends the CTA exactly at the end of the reel", () => {
    const composition = buildComposition(input());
    const cta = composition.tracks
      .find((t) => t.kind === "overlay")!
      .clips.find((c) => c.id === "cta-card")!;
    expect(cta.endFrame).toBe(composition.durationFrames);
  });

  it("renders a placeholder rather than a gap when a shot has no asset", () => {
    // A missing asset that rendered transparent would produce a silent gap that
    // passes every automated check.
    const composition = buildComposition(
      input({
        shots: [
          { id: "s1", startMs: 0, endMs: 3000, mediaAssetId: null, mediaKind: "image", onScreenText: null },
        ],
      }),
    );
    // The clip still exists and is timed; CompositionRenderer draws MISSING ASSET.
    expect(composition.tracks[0]!.clips[0]!.mediaAssetId).toBeNull();
    expect(composition.tracks[0]!.clips[0]!.endFrame).toBe(90);
  });

  it("survives adaptation to every supported ratio", () => {
    const base = buildComposition(input());
    for (const ratio of ["9:16", "4:5", "1:1", "16:9", "4:3"] as const) {
      const adapted = adaptToRatio(base, ratio, "instagram");
      expect(validateComposition(adapted)).toEqual([]);
      // Re-framing never re-times.
      expect(adapted.durationFrames).toBe(base.durationFrames);
    }
  });

  it("keeps captions readable after adaptation to a wide format", () => {
    const base = buildComposition(input());
    const wide = adaptToRatio(base, "16:9", "youtube");
    const captions = wide.tracks.find((t) => t.kind === "caption")!;
    for (const clip of captions.clips) {
      expect(isInsideSafeArea(clip.box, "youtube")).toBe(true);
    }
  });

  it("handles a single-shot reel without producing an invalid CTA", () => {
    const composition = buildComposition(
      input({
        shots: [
          { id: "s1", startMs: 0, endMs: 1000, mediaAssetId: "a1", mediaKind: "image", onScreenText: null },
        ],
      }),
    );
    expect(validateComposition(composition)).toEqual([]);
    const overlays = composition.tracks.find((t) => t.kind === "overlay");
    for (const clip of overlays?.clips ?? []) {
      // A CTA longer than the reel would start at a negative frame.
      expect(clip.startFrame).toBeGreaterThanOrEqual(0);
      expect(clip.endFrame).toBeLessThanOrEqual(composition.durationFrames);
    }
  });
});
