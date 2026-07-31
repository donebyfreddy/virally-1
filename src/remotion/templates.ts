import type { AspectRatio } from "@/types/database";
import {
  computeDurationFrames,
  dimensionsFor,
  msToFrames,
  safeAreaFor,
  type BrandStyle,
  type Composition,
  type CompositionClip,
  type CompositionTrack,
  type NormalisedBox,
} from "@/lib/creative/composition";
import type { ProductionMode } from "@/lib/creative/types";

/**
 * Templates, as data.
 *
 * A template is a FUNCTION FROM SCRIPT TO COMPOSITION, not a React component.
 * That distinction is the whole architecture: the renderer
 * (CompositionRenderer.tsx) is generic, so a caption fix lands once rather than
 * ten times, and every template's output is the same inspectable model the
 * studio edits and the quality checks validate.
 *
 * Adding a template is adding a builder here. It cannot introduce a new
 * rendering path, which is what keeps ten templates from becoming ten
 * divergent products.
 */

export type TemplateId =
  | "faceless-documentary"
  | "listicle"
  | "product-demo"
  | "ugc-ad"
  | "educational"
  | "storytelling"
  | "quote"
  | "news-summary"
  | "before-after"
  | "podcast-clip";

export type TemplateDefinition = {
  id: TemplateId;
  label: string;
  description: string;
  /** Modes this template is offered for. */
  modes: readonly ProductionMode[];
  /** Whether shots are stills with camera movement, or generated video. */
  motionSource: "camera_on_stills" | "generated_video" | "mixed";
  /** Whether a hook card opens the reel. */
  hookCard: boolean;
  ctaCard: boolean;
};

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: "faceless-documentary",
    label: "Faceless documentary",
    description: "Narrated stills with slow camera movement. The cheapest format that still reads as produced.",
    modes: ["fast", "hybrid", "cinematic"],
    motionSource: "camera_on_stills",
    hookCard: true,
    ctaCard: true,
  },
  {
    id: "listicle",
    label: "Listicle",
    description: "Numbered beats, one visual per item, hard cuts on the count.",
    modes: ["fast", "hybrid"],
    motionSource: "camera_on_stills",
    hookCard: true,
    ctaCard: true,
  },
  {
    id: "product-demo",
    label: "Product demonstration",
    description: "Generated motion on the product, static captions calling out features.",
    modes: ["hybrid", "cinematic"],
    motionSource: "generated_video",
    hookCard: true,
    ctaCard: true,
  },
  {
    id: "ugc-ad",
    label: "UGC-style advertisement",
    description: "Handheld feel, front-loaded hook, single call to action.",
    modes: ["hybrid", "cinematic"],
    motionSource: "mixed",
    hookCard: true,
    ctaCard: true,
  },
  {
    id: "educational",
    label: "Educational reel",
    description: "Claim, evidence, takeaway. Captions carry the argument.",
    modes: ["fast", "hybrid"],
    motionSource: "camera_on_stills",
    hookCard: true,
    ctaCard: false,
  },
  {
    id: "storytelling",
    label: "Storytelling reel",
    description: "Continuous narration over changing scenes, no on-screen list structure.",
    modes: ["hybrid", "cinematic"],
    motionSource: "mixed",
    hookCard: true,
    ctaCard: true,
  },
  {
    id: "quote",
    label: "Quote or motivational",
    description: "One line of text held over a single moving background.",
    modes: ["fast"],
    motionSource: "camera_on_stills",
    hookCard: false,
    ctaCard: false,
  },
  {
    id: "news-summary",
    label: "News or trend summary",
    description: "Dense, fast cuts, timestamped beats.",
    modes: ["fast", "hybrid"],
    motionSource: "camera_on_stills",
    hookCard: true,
    ctaCard: false,
  },
  {
    id: "before-after",
    label: "Before and after",
    description: "Two states, one transition. The transition is the payload.",
    modes: ["fast", "hybrid"],
    motionSource: "camera_on_stills",
    hookCard: true,
    ctaCard: true,
  },
  {
    id: "podcast-clip",
    label: "Podcast clip",
    description: "Speaker footage with burned-in word-level captions.",
    modes: ["fast", "hybrid"],
    motionSource: "generated_video",
    hookCard: false,
    ctaCard: false,
  },
];

export function templateDefinition(id: TemplateId): TemplateDefinition {
  const found = TEMPLATES.find((template) => template.id === id);
  if (!found) throw new Error(`Unknown template "${id}".`);
  return found;
}

/** One timed beat of the script, already resolved to an asset where it has one. */
export type TemplateShot = {
  id: string;
  startMs: number;
  endMs: number;
  /** Ingested asset backing this shot. Null renders a visible placeholder. */
  mediaAssetId: string | null;
  /** Whether the asset is a video clip or a still. */
  mediaKind: "video" | "image";
  onScreenText: string | null;
};

export type BuildInput = {
  templateId: TemplateId;
  ratio: AspectRatio;
  platform: string;
  fps: number;
  shots: readonly TemplateShot[];
  /** Voiceover covering the whole reel, when one was generated. */
  voiceAssetId: string | null;
  musicAssetId: string | null;
  hookText: string | null;
  ctaText: string | null;
  brand: BrandStyle;
};

/**
 * Builds a composition from a template and a timed shot list.
 *
 * Deterministic: the same input always produces the same composition, so a
 * re-render after an unrelated edit does not silently reflow the whole reel.
 */
export function buildComposition(input: BuildInput): Composition {
  const definition = templateDefinition(input.templateId);
  const { width, height } = dimensionsFor(input.ratio);
  const safe = safeAreaFor(input.platform);
  const fps = input.fps;

  const visualClips: CompositionClip[] = input.shots.map((shot, index) => {
    const startFrame = msToFrames(shot.startMs, fps);
    const endFrame = msToFrames(shot.endMs, fps);

    return {
      id: shot.id,
      startFrame,
      endFrame,
      mediaAssetId: shot.mediaAssetId,
      sourceOffsetFrames: 0,
      box: { x: 0, y: 0, width: 1, height: 1 },
      text: null,
      // Stills get camera movement; generated video already moves, and adding a
      // second movement on top reads as a mistake.
      motion:
        shot.mediaKind === "image" && definition.motionSource !== "generated_video"
          ? kenBurns(index)
          : null,
      // No fade on the first clip: a reel that opens on black loses the first
      // second of attention, which for short-form is most of it.
      transitionInFrames: index === 0 ? 0 : Math.round(fps * 0.2),
      transitionOutFrames: Math.round(fps * 0.2),
      volume: shot.mediaKind === "video" ? 0 : 1,
    };
  });

  const captionClips: CompositionClip[] = input.shots
    .filter((shot) => shot.onScreenText !== null)
    .map((shot) => ({
      id: `${shot.id}-caption`,
      startFrame: msToFrames(shot.startMs, fps),
      endFrame: msToFrames(shot.endMs, fps),
      mediaAssetId: null,
      sourceOffsetFrames: 0,
      // Positioned above the platform's bottom inset, not at a fixed fraction —
      // TikTok's action rail sits where a 0.8 caption would be unreadable.
      box: captionBox(safe),
      text: shot.onScreenText,
      motion: null,
      transitionInFrames: Math.round(fps * 0.1),
      transitionOutFrames: Math.round(fps * 0.1),
      volume: 0,
    }));

  const overlayClips: CompositionClip[] = [];
  const lastFrame = visualClips.reduce((max, clip) => Math.max(max, clip.endFrame), 0);

  if (definition.hookCard && input.hookText) {
    overlayClips.push({
      id: "hook-card",
      startFrame: 0,
      // Held for the opening beat only. A hook that outstays it competes with
      // the content it was supposed to introduce.
      endFrame: Math.min(msToFrames(2500, fps), lastFrame),
      mediaAssetId: null,
      sourceOffsetFrames: 0,
      box: { x: safe.left, y: safe.top + 0.05, width: 1 - safe.left - safe.right, height: 0.2 },
      text: input.hookText,
      motion: null,
      transitionInFrames: 0,
      transitionOutFrames: Math.round(fps * 0.25),
      volume: 0,
    });
  }

  if (definition.ctaCard && input.ctaText && lastFrame > 0) {
    const ctaFrames = Math.min(msToFrames(2000, fps), lastFrame);
    overlayClips.push({
      id: "cta-card",
      startFrame: lastFrame - ctaFrames,
      endFrame: lastFrame,
      mediaAssetId: null,
      sourceOffsetFrames: 0,
      box: { x: safe.left, y: 0.5 - 0.1, width: 1 - safe.left - safe.right, height: 0.2 },
      text: input.ctaText,
      motion: null,
      transitionInFrames: Math.round(fps * 0.25),
      transitionOutFrames: 0,
      volume: 0,
    });
  }

  const tracks: CompositionTrack[] = [
    { id: "visual", kind: "image", layer: 0, muted: false, clips: visualClips },
    { id: "captions", kind: "caption", layer: 10, muted: false, clips: captionClips },
  ];

  if (overlayClips.length > 0) {
    tracks.push({ id: "overlays", kind: "overlay", layer: 20, muted: false, clips: overlayClips });
  }

  if (input.voiceAssetId && lastFrame > 0) {
    tracks.push({
      id: "voice",
      kind: "voice",
      layer: 0,
      muted: false,
      clips: [audioClip("voice-1", input.voiceAssetId, lastFrame, 1)],
    });
  }

  if (input.musicAssetId && lastFrame > 0) {
    tracks.push({
      id: "music",
      kind: "music",
      layer: 0,
      muted: false,
      // Ducked well under the voice. Music at parity makes narration
      // unintelligible on a phone speaker, which is where this is watched.
      clips: [audioClip("music-1", input.musicAssetId, lastFrame, input.voiceAssetId ? 0.18 : 0.6)],
    });
  }

  return {
    id: `${input.templateId}-${input.ratio}`,
    width,
    height,
    fps,
    // Derived, never assumed: a stored duration longer than the content renders
    // trailing black that the quality check reports as corruption.
    durationFrames: computeDurationFrames(tracks),
    templateId: input.templateId,
    ratio: input.ratio,
    tracks,
    platformOverrides: [],
    brand: input.brand,
  };
}

function audioClip(
  id: string,
  mediaAssetId: string,
  endFrame: number,
  volume: number,
): CompositionClip {
  return {
    id,
    startFrame: 0,
    endFrame,
    mediaAssetId,
    sourceOffsetFrames: 0,
    box: { x: 0, y: 0, width: 1, height: 1 },
    text: null,
    motion: null,
    transitionInFrames: 0,
    transitionOutFrames: 0,
    volume,
  };
}

function captionBox(safe: { top: number; bottom: number; left: number; right: number }) {
  const height = 0.12;
  return {
    x: safe.left,
    // Sits just above the platform's bottom inset.
    y: 1 - safe.bottom - height - 0.02,
    width: 1 - safe.left - safe.right,
    height,
  };
}

/**
 * Slow push or pull across a still.
 *
 * Alternates direction by index so consecutive shots do not all drift the same
 * way, which reads as a slideshow rather than as camera work. The 8% range is
 * deliberately small: anything larger looks like a zoom effect rather than a
 * camera, and on a generated still it exposes upscaling artefacts.
 */
function kenBurns(index: number): { from: NormalisedBox; to: NormalisedBox } {
  const push = index % 2 === 0;
  const wide: NormalisedBox = { x: 0, y: 0, width: 1, height: 1 };
  const tight: NormalisedBox = { x: -0.04, y: -0.04, width: 1.08, height: 1.08 };
  return push ? { from: wide, to: tight } : { from: tight, to: wide };
}
