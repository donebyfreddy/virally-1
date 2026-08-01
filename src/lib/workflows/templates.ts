import type { GenerationCapability } from "@/lib/creative/capabilities";
import type { ProductionMode } from "@/lib/creative/types";

/**
 * The workflows Virally ships, as typed code rather than as data a user draws.
 *
 * The brief asks for a visual builder eventually and typed templates first, and
 * the order matters: a node editor shipped before the engine exists produces a
 * graph nothing can execute, and every wiring mistake becomes a runtime failure
 * discovered by a paying user. Declaring each step's inputs and outputs here
 * means `validateTemplate` catches an unsatisfiable wiring in CI, and the same
 * check will run unchanged over a graph the builder emits later. These types
 * are the contract the builder will have to produce — not a stopgap it replaces.
 *
 * Nothing here executes anything. A template is copied into `workflow_steps` at
 * run start (see schema.workflow.ts for why the copy exists), and the engine
 * works from that copy.
 */

export type WorkflowStepKind =
  | "generate_image"
  | "generate_video"
  | "generate_audio"
  | "generate_lipsync"
  | "upscale"
  | "language"
  | "compose"
  | "render"
  | "validate"
  | "export";

/** A step's declared inputs and outputs, so the engine can type-check a wiring. */
export type WorkflowValueType =
  | "text"
  | "image_asset"
  | "video_asset"
  | "audio_asset"
  | "composition"
  | "json";

export type WorkflowStepSpec = {
  key: string;
  kind: WorkflowStepKind;
  capability?: GenerationCapability;
  label: string;
  description?: string;
  /** Step keys this depends on. Empty means it reads only the workflow inputs. */
  dependsOn: readonly string[];
  inputs: Readonly<Record<string, WorkflowValueType>>;
  outputs: Readonly<Record<string, WorkflowValueType>>;
  /** A failure here does not fail the run. */
  optional?: boolean;
  /** How many times this step may fan out, e.g. one per storyboard shot. */
  fanOut?: "none" | "per_shot" | "per_platform";
};

export type WorkflowTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Production modes this template is offered for. */
  modes: readonly ProductionMode[];
  inputs: Readonly<Record<string, WorkflowValueType>>;
  steps: readonly WorkflowStepSpec[];
};

const ALL_MODES: readonly ProductionMode[] = ["fast", "hybrid", "cinematic"];

/**
 * Kinds after which nothing further is expected to run.
 *
 * A template that stops at a generation step has produced files nobody can
 * watch. Enforced rather than documented because it is the single mistake a
 * hand-written template makes most often.
 */
const TERMINAL_KINDS: readonly WorkflowStepKind[] = ["compose", "render", "export"];

export function isTerminalStepKind(kind: WorkflowStepKind): boolean {
  return TERMINAL_KINDS.includes(kind);
}

// =============================================================================
// Templates
// =============================================================================

const PROMPT_IMAGES_VOICE_REEL: WorkflowTemplate = {
  id: "tpl_prompt_images_voice_reel",
  slug: "prompt-images-voice-reel",
  name: "Prompt → Images → Voice → Reel",
  description:
    "A written idea becomes a script, a shot list, one still per shot, a voiceover, and a rendered vertical reel.",
  modes: ALL_MODES,
  inputs: { prompt: "text" },
  steps: [
    {
      key: "script",
      kind: "language",
      label: "Write the script",
      dependsOn: [],
      inputs: { prompt: "text" },
      outputs: { script: "text" },
    },
    {
      key: "storyboard",
      kind: "language",
      label: "Break the script into shots",
      // Separate from `script` because the shot count drives the fan-out below,
      // and a single call that returns both prose and a shot list gives the
      // engine nothing to count before it has parsed the prose.
      dependsOn: ["script"],
      inputs: { script: "text" },
      outputs: { shotList: "json" },
    },
    {
      key: "shot_images",
      kind: "generate_image",
      capability: "text-to-image",
      label: "Generate a still per shot",
      dependsOn: ["storyboard"],
      inputs: { shotList: "json" },
      outputs: { shotImage: "image_asset" },
      fanOut: "per_shot",
    },
    {
      key: "voiceover",
      kind: "generate_audio",
      capability: "audio",
      label: "Record the voiceover",
      // Depends on the script, not the storyboard — the narration is read
      // straight through and must not wait on image planning.
      dependsOn: ["script"],
      inputs: { script: "text" },
      outputs: { voiceover: "audio_asset" },
    },
    {
      key: "captions",
      kind: "language",
      label: "Time the captions to the voiceover",
      dependsOn: ["voiceover"],
      inputs: { voiceover: "audio_asset" },
      outputs: { captions: "json" },
      // Optional: an uncaptioned reel is worse but still deliverable, and a
      // caption timing failure must not throw away the generated footage.
      // Downstream steps that read its output must tolerate its absence.
      optional: true,
    },
    {
      key: "compose",
      kind: "compose",
      label: "Assemble the Remotion composition",
      dependsOn: ["shot_images", "voiceover", "captions"],
      inputs: { shotImage: "image_asset", voiceover: "audio_asset", captions: "json" },
      outputs: { composition: "composition" },
    },
    {
      key: "render",
      kind: "render",
      label: "Render the reel",
      dependsOn: ["compose"],
      inputs: { composition: "composition" },
      outputs: { reel: "video_asset" },
    },
  ],
};

const PROMPT_CLIPS_VOICE_REEL: WorkflowTemplate = {
  id: "tpl_prompt_clips_voice_reel",
  slug: "prompt-clips-voice-reel",
  name: "Prompt → Video Clips → Voice → Reel",
  description:
    "The same shape as the stills reel, with each shot generated as motion instead of a still. The expensive one.",
  // Not offered in Fast: a per-shot text-to-video call costs an order of
  // magnitude more than a still, which is the distinction Fast mode exists for.
  modes: ["hybrid", "cinematic"],
  inputs: { prompt: "text" },
  steps: [
    {
      key: "script",
      kind: "language",
      label: "Write the script",
      dependsOn: [],
      inputs: { prompt: "text" },
      outputs: { script: "text" },
    },
    {
      key: "storyboard",
      kind: "language",
      label: "Break the script into shots",
      dependsOn: ["script"],
      inputs: { script: "text" },
      outputs: { shotList: "json" },
    },
    {
      key: "shot_clips",
      kind: "generate_video",
      capability: "text-to-video",
      label: "Generate a clip per shot",
      dependsOn: ["storyboard"],
      inputs: { shotList: "json" },
      outputs: { shotClip: "video_asset" },
      fanOut: "per_shot",
    },
    {
      key: "voiceover",
      kind: "generate_audio",
      capability: "audio",
      label: "Record the voiceover",
      dependsOn: ["script"],
      inputs: { script: "text" },
      outputs: { voiceover: "audio_asset" },
    },
    {
      key: "music",
      kind: "generate_audio",
      capability: "music",
      label: "Generate a music bed",
      dependsOn: ["script"],
      inputs: { script: "text" },
      outputs: { music: "audio_asset" },
      optional: true,
    },
    {
      key: "captions",
      kind: "language",
      label: "Time the captions to the voiceover",
      dependsOn: ["voiceover"],
      inputs: { voiceover: "audio_asset" },
      outputs: { captions: "json" },
      optional: true,
    },
    {
      key: "compose",
      kind: "compose",
      label: "Assemble the Remotion composition",
      dependsOn: ["shot_clips", "voiceover", "music", "captions"],
      inputs: {
        shotClip: "video_asset",
        voiceover: "audio_asset",
        music: "audio_asset",
        captions: "json",
      },
      outputs: { composition: "composition" },
    },
    {
      key: "render",
      kind: "render",
      label: "Render the reel",
      dependsOn: ["compose"],
      inputs: { composition: "composition" },
      outputs: { reel: "video_asset" },
    },
  ],
};

const PRODUCT_URL_AD_REEL: WorkflowTemplate = {
  id: "tpl_product_url_ad_reel",
  slug: "product-url-ad-reel",
  name: "Product URL → Script → Product Images → Ad Reel",
  description:
    "Reads a product page, writes an ad script from what it actually says, and restyles the product's own imagery per shot.",
  modes: ALL_MODES,
  inputs: { productUrl: "text" },
  steps: [
    {
      key: "product_research",
      kind: "language",
      label: "Read the product page",
      // Emits the product's own photography alongside the facts. Generating a
      // product from a prompt would invent a product that does not exist, which
      // is a claim about someone's merchandise, not a stylistic liberty.
      dependsOn: [],
      inputs: { productUrl: "text" },
      outputs: { productFacts: "json", productImage: "image_asset" },
    },
    {
      key: "brand_safety",
      kind: "validate",
      label: "Check the claims are supportable",
      // Runs against the scraped facts rather than the finished script, so a
      // regulated claim is caught before it has been narrated and rendered.
      dependsOn: ["product_research"],
      inputs: { productFacts: "json" },
      outputs: { safetyReport: "json" },
    },
    {
      key: "script",
      kind: "language",
      label: "Write the ad script",
      dependsOn: ["product_research"],
      inputs: { productFacts: "json" },
      outputs: { script: "text" },
    },
    {
      key: "storyboard",
      kind: "language",
      label: "Break the script into shots",
      dependsOn: ["script"],
      inputs: { script: "text" },
      outputs: { shotList: "json" },
    },
    {
      key: "product_images",
      kind: "generate_image",
      capability: "image-to-image",
      label: "Restyle the product per shot",
      dependsOn: ["storyboard", "product_research"],
      inputs: { shotList: "json", productImage: "image_asset" },
      outputs: { shotImage: "image_asset" },
      fanOut: "per_shot",
    },
    {
      key: "voiceover",
      kind: "generate_audio",
      capability: "audio",
      label: "Record the voiceover",
      dependsOn: ["script"],
      inputs: { script: "text" },
      outputs: { voiceover: "audio_asset" },
    },
    {
      key: "compose",
      kind: "compose",
      label: "Assemble the ad composition",
      // Takes the safety report as an input so the composition cannot be built
      // from a script the check never saw.
      dependsOn: ["product_images", "voiceover", "brand_safety"],
      inputs: {
        shotImage: "image_asset",
        voiceover: "audio_asset",
        safetyReport: "json",
      },
      outputs: { composition: "composition" },
    },
    {
      key: "render",
      kind: "render",
      label: "Render the ad reel",
      dependsOn: ["compose"],
      inputs: { composition: "composition" },
      outputs: { adReel: "video_asset" },
    },
  ],
};

const PODCAST_CLIPS_SOCIAL: WorkflowTemplate = {
  id: "tpl_podcast_clips_social",
  slug: "podcast-clips-social",
  name: "Podcast → Clips → Captions → Social Variants",
  description:
    "Finds the moments worth cutting out of a long recording and reformats each one per platform.",
  // Repurposing generates no new footage, so the cinematic budget buys nothing
  // here and offering it would charge for capacity the workflow cannot use.
  modes: ["fast", "hybrid"],
  inputs: { podcastAudio: "audio_asset", podcastVideo: "video_asset" },
  steps: [
    {
      key: "transcribe",
      kind: "language",
      label: "Transcribe the recording",
      dependsOn: [],
      inputs: { podcastAudio: "audio_asset" },
      outputs: { transcript: "text" },
    },
    {
      key: "find_moments",
      kind: "language",
      label: "Pick the moments worth clipping",
      dependsOn: ["transcribe"],
      inputs: { transcript: "text" },
      outputs: { clipPlan: "json" },
    },
    {
      key: "cut_clips",
      kind: "compose",
      label: "Cut each moment out of the source",
      // Reads the original video from the workflow inputs rather than from an
      // upstream step: the source is never regenerated, only cut, and routing
      // it through a step would imply it can be replaced.
      dependsOn: ["find_moments"],
      inputs: { clipPlan: "json", podcastVideo: "video_asset" },
      outputs: { clip: "video_asset" },
      fanOut: "per_shot",
    },
    {
      key: "captions",
      kind: "language",
      label: "Burn-in captions per clip",
      // Not optional here, unlike the reel templates: a silent-autoplay social
      // clip with no captions is unwatchable, so a failure is worth stopping for.
      dependsOn: ["cut_clips"],
      inputs: { clip: "video_asset" },
      outputs: { captions: "json" },
    },
    {
      key: "social_variants",
      kind: "compose",
      label: "Reframe per platform",
      dependsOn: ["cut_clips", "captions"],
      inputs: { clip: "video_asset", captions: "json" },
      outputs: { composition: "composition" },
      fanOut: "per_platform",
    },
    {
      key: "render",
      kind: "render",
      label: "Render each variant",
      dependsOn: ["social_variants"],
      inputs: { composition: "composition" },
      outputs: { socialClip: "video_asset" },
    },
    {
      key: "export",
      kind: "export",
      label: "Package the variants for download and scheduling",
      dependsOn: ["render"],
      inputs: { socialClip: "video_asset" },
      outputs: { exportBundle: "json" },
    },
  ],
};

const PORTRAIT_AUDIO_LIPSYNC_EXPORT: WorkflowTemplate = {
  id: "tpl_portrait_audio_lipsync_export",
  slug: "portrait-audio-lipsync-export",
  name: "Portrait + Audio → Lip Sync → Captions → Export",
  description:
    "Drives a still portrait from a voice track, captions the result and packages it for delivery.",
  modes: ["hybrid", "cinematic"],
  inputs: { portrait: "image_asset", voiceTrack: "audio_asset" },
  steps: [
    {
      key: "consent_check",
      kind: "validate",
      label: "Confirm rights to the likeness and the voice",
      // First, and a hard dependency of the lip-sync step, because the brief
      // forbids animating a real person without confirmed authorization. Making
      // it a step rather than a submit-time guard is what puts the confirmation
      // in the run's own record, where a later dispute can find it.
      dependsOn: [],
      inputs: { portrait: "image_asset", voiceTrack: "audio_asset" },
      outputs: { consentRecord: "json" },
    },
    {
      key: "lipsync",
      kind: "generate_lipsync",
      capability: "lip-sync",
      label: "Drive the portrait from the voice track",
      dependsOn: ["consent_check"],
      inputs: {
        portrait: "image_asset",
        voiceTrack: "audio_asset",
        consentRecord: "json",
      },
      outputs: { talkingHead: "video_asset" },
    },
    {
      key: "captions",
      kind: "language",
      label: "Caption the delivery",
      dependsOn: ["lipsync"],
      inputs: { talkingHead: "video_asset" },
      outputs: { captions: "json" },
    },
    {
      key: "compose",
      kind: "compose",
      label: "Assemble the composition",
      dependsOn: ["lipsync", "captions"],
      inputs: { talkingHead: "video_asset", captions: "json" },
      outputs: { composition: "composition" },
    },
    {
      key: "render",
      kind: "render",
      label: "Render the video",
      dependsOn: ["compose"],
      inputs: { composition: "composition" },
      outputs: { video: "video_asset" },
    },
    {
      key: "export",
      kind: "export",
      label: "Package for delivery",
      dependsOn: ["render"],
      inputs: { video: "video_asset" },
      outputs: { exportBundle: "json" },
    },
  ],
};

const IMAGE_ANIMATE_UPSCALE_COMPOSITION: WorkflowTemplate = {
  id: "tpl_image_animate_upscale_composition",
  slug: "image-animate-upscale-composition",
  name: "Image → Animate → Upscale → Remotion Composition",
  description:
    "Turns one still into motion, cleans the result up frame by frame and drops it into a composition.",
  modes: ALL_MODES,
  inputs: { sourceImage: "image_asset", motionPrompt: "text" },
  steps: [
    {
      key: "animate",
      kind: "generate_video",
      capability: "image-to-video",
      label: "Animate the still",
      dependsOn: [],
      inputs: { sourceImage: "image_asset", motionPrompt: "text" },
      outputs: { clip: "video_asset" },
    },
    {
      key: "upscale",
      kind: "upscale",
      capability: "upscale",
      label: "Upscale the animated clip",
      // Declares the image-only `upscale` capability against video in and video
      // out on purpose: no video upscaler is catalogued, so this runs the image
      // upscaler across the clip's frames. When a native video upscaler is
      // catalogued the capability changes and this comment goes with it.
      dependsOn: ["animate"],
      inputs: { clip: "video_asset" },
      outputs: { upscaledClip: "video_asset" },
    },
    {
      key: "soundtrack",
      kind: "generate_audio",
      capability: "music",
      label: "Generate a soundtrack",
      // Reads the motion prompt directly, so it runs in parallel with the
      // animation rather than behind it — the slowest step in this template.
      dependsOn: [],
      inputs: { motionPrompt: "text" },
      outputs: { music: "audio_asset" },
      optional: true,
    },
    {
      key: "compose",
      kind: "compose",
      label: "Assemble the Remotion composition",
      dependsOn: ["upscale", "soundtrack"],
      inputs: { upscaledClip: "video_asset", music: "audio_asset" },
      outputs: { composition: "composition" },
    },
    {
      key: "render",
      kind: "render",
      label: "Render the composition",
      dependsOn: ["compose"],
      inputs: { composition: "composition" },
      outputs: { video: "video_asset" },
    },
  ],
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  PROMPT_IMAGES_VOICE_REEL,
  PROMPT_CLIPS_VOICE_REEL,
  PRODUCT_URL_AD_REEL,
  PODCAST_CLIPS_SOCIAL,
  PORTRAIT_AUDIO_LIPSYNC_EXPORT,
  IMAGE_ANIMATE_UPSCALE_COMPOSITION,
];

export function findTemplate(slug: string): WorkflowTemplate | null {
  return WORKFLOW_TEMPLATES.find((template) => template.slug === slug) ?? null;
}

// =============================================================================
// Graph resolution
// =============================================================================

/** Topologically orders steps, or reports the cycle / unknown dependency. */
export function resolveExecutionOrder(
  template: WorkflowTemplate,
): { ok: true; order: readonly string[] } | { ok: false; reason: string } {
  const byKey = new Map<string, WorkflowStepSpec>();
  for (const step of template.steps) {
    if (byKey.has(step.key)) {
      return { ok: false, reason: `Step "${step.key}" is declared more than once.` };
    }
    byKey.set(step.key, step);
  }

  // Outstanding-dependency count per step, and the reverse edges used to
  // decrement it. Built in one pass so an unknown dependency is reported
  // against the step that named it rather than surfacing later as a false cycle.
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of template.steps) {
    remaining.set(step.key, step.dependsOn.length);
    for (const dependency of step.dependsOn) {
      if (!byKey.has(dependency)) {
        return {
          ok: false,
          reason: `Step "${step.key}" depends on "${dependency}", which is not a step in this workflow.`,
        };
      }
      const existing = dependents.get(dependency);
      if (existing === undefined) dependents.set(dependency, [step.key]);
      else existing.push(step.key);
    }
  }

  // Kahn's algorithm. Ready steps are drained in declaration order so the
  // resolved plan is deterministic — two runs of the same template must
  // materialise the same positions, or a retry would target a different step.
  const ready = template.steps.filter((step) => step.dependsOn.length === 0).map((step) => step.key);
  const order: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift()!;
    order.push(key);
    for (const dependent of dependents.get(key) ?? []) {
      const left = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, left);
      if (left === 0) ready.push(dependent);
    }
  }

  if (order.length !== template.steps.length) {
    // Whatever never reached zero is either in the cycle or downstream of it.
    // Naming them is the difference between a fixable report and "invalid graph".
    const stuck = template.steps
      .filter((step) => (remaining.get(step.key) ?? 0) > 0)
      .map((step) => step.key);
    return {
      ok: false,
      reason: `Dependency cycle: ${stuck.map((key) => `"${key}"`).join(", ")} can never become ready.`,
    };
  }

  return { ok: true, order };
}

/** Validates that every step's declared inputs are satisfiable. */
export function validateTemplate(template: WorkflowTemplate): readonly string[] {
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const step of template.steps) {
    if (seen.has(step.key)) problems.push(`Step key "${step.key}" is used more than once.`);
    seen.add(step.key);
  }

  if (template.steps.length === 0) {
    problems.push("Template declares no steps.");
    return problems;
  }

  const last = template.steps[template.steps.length - 1]!;
  if (!isTerminalStepKind(last.kind)) {
    problems.push(
      `Template ends on "${last.key}" (${last.kind}), which produces files nobody can watch. It must end in a compose, render or export step.`,
    );
  }

  const byKey = new Map(template.steps.map((step) => [step.key, step] as const));

  for (const step of template.steps) {
    for (const dependency of step.dependsOn) {
      if (!byKey.has(dependency)) {
        problems.push(`Step "${step.key}" depends on unknown step "${dependency}".`);
      }
    }

    // A step reads either the workflow's own inputs or the outputs of a step it
    // declares a dependency on. Reading an output from a step it does not depend
    // on is the wiring bug this catches: it works whenever the scheduler happens
    // to have run that step first, and fails the moment it does not.
    for (const [name, type] of Object.entries(step.inputs)) {
      if (template.inputs[name] === type) continue;

      const producer = step.dependsOn
        .map((dependency) => byKey.get(dependency))
        .find((upstream) => upstream !== undefined && upstream.outputs[name] === type);
      if (producer !== undefined) continue;

      const mistyped = step.dependsOn
        .map((dependency) => byKey.get(dependency))
        .find((upstream) => upstream !== undefined && upstream.outputs[name] !== undefined);
      if (mistyped !== undefined) {
        problems.push(
          `Step "${step.key}" wants "${name}" as ${type}, but "${mistyped.key}" produces it as ${mistyped.outputs[name]}.`,
        );
      } else if (template.inputs[name] !== undefined) {
        problems.push(
          `Step "${step.key}" wants "${name}" as ${type}, but the workflow input "${name}" is ${template.inputs[name]}.`,
        );
      } else {
        problems.push(
          `Step "${step.key}" wants "${name}" (${type}), which no workflow input and no step it depends on produces.`,
        );
      }
    }
  }

  const resolved = resolveExecutionOrder(template);
  if (!resolved.ok) problems.push(resolved.reason);

  return problems;
}
