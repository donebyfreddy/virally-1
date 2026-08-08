/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { assetKindFor } from "./assetKind";

describe("assetKindFor", () => {
  it("maps image and video kinds directly, ignoring capability", () => {
    expect(assetKindFor("image")).toBe("generated_image");
    expect(assetKindFor("video")).toBe("generated_video");
  });

  it("tells a voiceover apart from a music track by capability, not just kind", () => {
    // Both are `kind: "audio"` — capability is the only signal that
    // distinguishes them. Collapsing both to a generic "audio" asset (the
    // prior behaviour) is what made `defaultTrackFor` in generation/attach.ts
    // unable to route a voiceover onto the dedicated voice track.
    expect(assetKindFor("audio", "audio")).toBe("voiceover");
    expect(assetKindFor("audio", "music")).toBe("music");
  });

  it("falls back to a generic audio kind for sound effects and when no capability was recorded", () => {
    expect(assetKindFor("audio", "sound-effect")).toBe("audio");
    expect(assetKindFor("audio", null)).toBe("audio");
    expect(assetKindFor("audio")).toBe("audio");
  });
});
