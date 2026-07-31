import { Composition as RemotionComposition } from "remotion";
import { CompositionRenderer, type CompositionRendererProps } from "./CompositionRenderer";
import { buildComposition } from "./templates";

/**
 * Remotion's entry point.
 *
 * Registers ONE composition, not one per template. Templates are data (see
 * templates.ts), so they all render through the same component with different
 * props — registering ten would create ten render paths that drift apart.
 *
 * The default props below exist only so `npx remotion studio` opens on
 * something. Real renders pass `inputProps` built from a stored composition,
 * which is why every dimension here is overridden at render time via
 * `calculateMetadata`.
 */

const PLACEHOLDER = buildComposition({
  templateId: "faceless-documentary",
  ratio: "9:16",
  platform: "tiktok",
  fps: 30,
  shots: [
    { id: "s1", startMs: 0, endMs: 3000, mediaAssetId: null, mediaKind: "image", onScreenText: "Preview shot one" },
    { id: "s2", startMs: 3000, endMs: 6000, mediaAssetId: null, mediaKind: "image", onScreenText: "Preview shot two" },
  ],
  voiceAssetId: null,
  musicAssetId: null,
  hookText: "Preview hook",
  ctaText: "Preview CTA",
  brand: {
    primaryColor: "#ffca5c",
    textColor: "#f4f7fb",
    fontFamily: "sans-serif",
    logoAssetId: null,
  },
});

export function RemotionRoot() {
  return (
    <RemotionComposition
      id="Reel"
      component={CompositionRenderer}
      // Overridden per render by calculateMetadata below; these are the values
      // the studio opens with.
      durationInFrames={PLACEHOLDER.durationFrames}
      fps={PLACEHOLDER.fps}
      width={PLACEHOLDER.width}
      height={PLACEHOLDER.height}
      defaultProps={{ composition: PLACEHOLDER, assetUrls: {} } satisfies CompositionRendererProps}
      /**
       * Dimensions and duration come from the composition being rendered, not
       * from the registration. Without this, every export would come out at the
       * placeholder's 9:16 size regardless of the format requested — the exact
       * fault the aspect-ratio quality check exists to catch.
       */
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, props.composition.durationFrames),
        fps: props.composition.fps,
        width: props.composition.width,
        height: props.composition.height,
      })}
    />
  );
}
