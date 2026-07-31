import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import type {
  BrandStyle,
  Composition,
  CompositionClip,
  CompositionTrack,
  NormalisedBox,
} from "@/lib/creative/composition";

/**
 * Renders the canonical composition model.
 *
 * One generic renderer rather than a component per template. A template is
 * DATA — which tracks exist, how clips are timed, which motion is applied — not
 * a separate React tree. Ten hand-written template components would drift: a
 * caption fix would land in three of them, and the composition model would stop
 * describing what actually renders.
 *
 * Everything is driven by props. Nothing here fetches, and nothing reads the
 * database: Remotion renders this in a headless browser with no session and no
 * network credentials, so any data access would fail at render time rather than
 * at review time.
 *
 * Normalised boxes become percentages, which is what makes one composition
 * render at any size without a second layout pass.
 */

export type CompositionRendererProps = {
  composition: Composition;
  /**
   * Resolved, publicly-fetchable URLs for each media asset.
   *
   * Passed in rather than looked up. The renderer runs in a browser context
   * that cannot sign a storage URL, so the caller resolves them first — and a
   * missing entry renders a visible gap rather than a silent black frame.
   */
  assetUrls: Readonly<Record<string, string>>;
};

export function CompositionRenderer({ composition, assetUrls }: CompositionRendererProps) {
  // Sorted so `layer` genuinely controls stacking rather than relying on the
  // order the tracks happened to be stored in.
  const visualTracks = [...composition.tracks]
    .filter((track) => track.kind !== "voice" && track.kind !== "music" && track.kind !== "sfx")
    .sort((a, b) => a.layer - b.layer);

  const audioTracks = composition.tracks.filter(
    (track) => track.kind === "voice" || track.kind === "music" || track.kind === "sfx",
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#07090d" }}>
      {visualTracks.map((track) =>
        track.clips.map((clip) => (
          <ClipSequence
            key={clip.id}
            clip={clip}
            track={track}
            brand={composition.brand}
            assetUrls={assetUrls}
          />
        )),
      )}

      {audioTracks
        .filter((track) => !track.muted)
        .map((track) =>
          track.clips.map((clip) => {
            const url = clip.mediaAssetId ? assetUrls[clip.mediaAssetId] : undefined;
            if (!url) return null;
            return (
              <Sequence
                key={clip.id}
                from={clip.startFrame}
                durationInFrames={clip.endFrame - clip.startFrame}
              >
                <Audio src={url} volume={clip.volume} />
              </Sequence>
            );
          }),
        )}
    </AbsoluteFill>
  );
}

function ClipSequence({
  clip,
  track,
  brand,
  assetUrls,
}: {
  clip: CompositionClip;
  track: CompositionTrack;
  brand: BrandStyle;
  assetUrls: Readonly<Record<string, string>>;
}) {
  const duration = clip.endFrame - clip.startFrame;
  // Remotion throws on a non-positive duration. A clip like this is already
  // rejected by validateComposition; skipping here keeps a bad row from
  // crashing an entire render.
  if (duration <= 0) return null;

  return (
    <Sequence from={clip.startFrame} durationInFrames={duration}>
      <ClipContent clip={clip} track={track} brand={brand} assetUrls={assetUrls} />
    </Sequence>
  );
}

function ClipContent({
  clip,
  track,
  brand,
  assetUrls,
}: {
  clip: CompositionClip;
  track: CompositionTrack;
  brand: BrandStyle;
  assetUrls: Readonly<Record<string, string>>;
}) {
  const frame = useCurrentFrame();
  const duration = clip.endFrame - clip.startFrame;

  // Camera movement, interpolated across the clip's own length. This is what
  // makes a Fast Reel work: motion computed here rather than bought from a
  // video model at 90 cents a clip.
  const box = clip.motion
    ? interpolateBox(clip.motion.from, clip.motion.to, frame / Math.max(1, duration - 1))
    : clip.box;

  const opacity = fadeOpacity(frame, duration, clip.transitionInFrames, clip.transitionOutFrames);

  const style: React.CSSProperties = {
    position: "absolute",
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
    opacity,
  };

  const url = clip.mediaAssetId ? assetUrls[clip.mediaAssetId] : undefined;

  if (track.kind === "video") {
    if (!url) return <MissingAsset style={style} />;
    return (
      <OffthreadVideo
        src={url}
        // Trimmed clips start partway into their source. `trimBefore` is the
        // current name; `startFrom` is deprecated in Remotion 4 and takes the
        // same frame-based value.
        trimBefore={clip.sourceOffsetFrames}
        volume={track.muted ? 0 : clip.volume}
        style={{ ...style, objectFit: "cover" }}
      />
    );
  }

  if (track.kind === "image") {
    if (!url) return <MissingAsset style={style} />;
    return <Img src={url} style={{ ...style, objectFit: "cover" }} />;
  }

  if (track.kind === "caption" || track.kind === "overlay") {
    if (!clip.text) return null;
    return (
      <div
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontFamily: brand.fontFamily,
          color: brand.textColor,
          // Sized against the frame rather than in fixed pixels, so the same
          // composition stays legible at 1080p and at 4K.
          fontSize: `${box.height * 60}%`,
          fontWeight: 700,
          lineHeight: 1.15,
          // Captions sit over arbitrary footage, so contrast cannot be assumed.
          // The shadow is what keeps white text readable over a white wall.
          textShadow: "0 2px 12px rgba(0,0,0,0.85)",
          padding: "0 2%",
        }}
      >
        {clip.text}
      </div>
    );
  }

  return null;
}

/**
 * Renders a visible placeholder for an unresolved asset.
 *
 * Deliberately obvious. A missing asset that rendered as transparent would
 * produce a video with a silent gap that passes every automated check and is
 * only caught by a human watching the whole thing.
 */
function MissingAsset({ style }: { style: React.CSSProperties }) {
  return (
    <div
      style={{
        ...style,
        backgroundColor: "#28313f",
        border: "4px dashed #ff7070",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#ff7070",
        fontFamily: "monospace",
        fontSize: 32,
      }}
    >
      MISSING ASSET
    </div>
  );
}

function interpolateBox(from: NormalisedBox, to: NormalisedBox, progress: number): NormalisedBox {
  const t = Math.min(1, Math.max(0, progress));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    width: from.width + (to.width - from.width) * t,
    height: from.height + (to.height - from.height) * t,
  };
}

/**
 * Fade in and out.
 *
 * Guards against a transition longer than the clip: two overlapping ranges
 * would otherwise interpolate to a negative opacity and Remotion would throw
 * mid-render.
 */
function fadeOpacity(frame: number, duration: number, fadeIn: number, fadeOut: number): number {
  const safeIn = Math.min(fadeIn, Math.floor(duration / 2));
  const safeOut = Math.min(fadeOut, Math.floor(duration / 2));

  let opacity = 1;
  if (safeIn > 0) {
    opacity = Math.min(opacity, interpolate(frame, [0, safeIn], [0, 1], { extrapolateRight: "clamp" }));
  }
  if (safeOut > 0) {
    opacity = Math.min(
      opacity,
      interpolate(frame, [duration - safeOut, duration], [1, 0], { extrapolateLeft: "clamp" }),
    );
  }
  return opacity;
}
