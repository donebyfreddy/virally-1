/**
 * Content-editor copy.
 *
 * The editor has more disabled controls than any other surface, because it is
 * the surface most dependent on the render pipeline. Every one of those controls
 * carries a specific reason here rather than a generic "coming soon" — a user
 * looking at a greyed-out Rerender button needs to know whether their work is
 * safe, not that a feature is planned.
 */

export const INSPECTOR_TABS = [
  { id: "script", label: "Script" },
  { id: "caption", label: "Caption" },
  { id: "voice", label: "Voice" },
  { id: "music", label: "Music" },
  { id: "branding", label: "Brand" },
  { id: "format", label: "Format" },
  { id: "export", label: "Export" },
] as const;

export type InspectorTabId = (typeof INSPECTOR_TABS)[number]["id"];

export const editorCopy = {
  assetsHeading: "Assets",
  timelineHeading: "Timeline",
  inspectorHeading: "Inspector",
  previewHeading: "Preview",
  segmentListLabel: "Read segments as a list",

  backToContent: "All content",

  paneSwitcherLabel: "Editor panel",
  paneLabels: {
    assets: "Assets",
    preview: "Preview",
    inspector: "Inspector",
  },

  variantSwitcherLabel: "Platform variant",

  trackLabels: {
    script: "Script",
    voice: "Voice",
  },

  playLabel: "Play",
  pauseLabel: "Pause",
  fullscreenLabel: "Fullscreen",
  approveLabel: "Approve",
  ctaLabel: "Call to action",
  demoLabel: "Demo output",

  /** Sentence case: this sits in a control strip, not in a table header. */
  savedRevision: (revision: number) => `Revision ${revision} · saved`,

  captionOverridden: "This variant overrides the item caption",

  /**
   * Stated on every disabled control. Names the dependency rather than the
   * roadmap, so it reads as a system state rather than a promise.
   */
  actionUnavailable:
    "Editing actions write through the render pipeline, which is not wired up on this surface yet.",
  transportUnavailable: "Playback needs a render",

  previewNotRendered:
    "This variant has not been rendered yet. A preview appears once the render job completes — nothing is shown here in the meantime, because a placeholder frame would imply the video exists.",
  previewPending:
    "A render exists for this variant, but its preview link could not be loaded just now. Reload the page to try again.",

  noAssets:
    "No assets are attached to this item yet. Generated stills, clips and voiceovers appear here as the campaign produces them.",
  noScript:
    "No script has been generated for this item. The scripts stage of the campaign produces one from the selected hook.",
  noCaption: "No caption has been written for this item yet.",
  noVariants:
    "This item has no platform variants yet. Variants are created when the item is recomposed for each platform and format.",
  noTimeline:
    "The timeline needs a script with segment timings. Those are produced together with the voiceover, because the timings come from the spoken audio.",

  /** Per-tab explanation for the panels that depend on the render pipeline. */
  inspectorPending: {
    script: "",
    caption: "",
    format: "",
    voice:
      "Voice selection, speed and pronunciation overrides live here. They apply at voiceover generation, so they are read-only until this item has a voiceover.",
    music:
      "Music bed, volume ducking against the voiceover, and start offset live here. They apply during the edit, which runs in the render pipeline.",
    branding:
      "Logo placement, brand colours, font and lower-third styling live here. They are read from the brand profile and applied at render.",
    export:
      "Per-platform export settings — bitrate, container, caption burn-in and safe-area padding. These are applied by the render job.",
  } satisfies Record<InspectorTabId, string>,
} as const;

/** Script-segment roles, as the inspector and timeline name them. */
export const SEGMENT_ROLE_LABELS: Readonly<Record<string, string>> = {
  hook: "Hook",
  body: "Body",
  cta: "Call to action",
  outro: "Outro",
};
