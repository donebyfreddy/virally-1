/**
 * @vitest-environment node
 *
 * Pure graph checks — no database, no provider. A template that validates here
 * is one the engine can materialise into `workflow_steps` and execute; a wiring
 * mistake that gets past these assertions becomes a run that charges credits,
 * generates footage and then fails on the step that cannot find its input.
 */
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TEMPLATES,
  findTemplate,
  isTerminalStepKind,
  resolveExecutionOrder,
  validateTemplate,
  type WorkflowTemplate,
} from "./templates";

const EXPECTED_SLUGS = [
  "prompt-images-voice-reel",
  "prompt-clips-voice-reel",
  "product-url-ad-reel",
  "podcast-clips-social",
  "portrait-audio-lipsync-export",
  "image-animate-upscale-composition",
] as const;

function template(slug: string): WorkflowTemplate {
  const found = findTemplate(slug);
  expect(found, `template "${slug}" is missing`).not.toBeNull();
  return found!;
}

describe("shipped templates", () => {
  it("ships exactly the six workflows the brief names", () => {
    expect(WORKFLOW_TEMPLATES.map((entry) => entry.slug)).toEqual([...EXPECTED_SLUGS]);
  });

  it("gives every template a unique slug and id", () => {
    expect(new Set(WORKFLOW_TEMPLATES.map((entry) => entry.slug)).size).toBe(
      WORKFLOW_TEMPLATES.length,
    );
    expect(new Set(WORKFLOW_TEMPLATES.map((entry) => entry.id)).size).toBe(
      WORKFLOW_TEMPLATES.length,
    );
  });

  it.each(WORKFLOW_TEMPLATES)("validates clean: $slug", (entry) => {
    expect(validateTemplate(entry)).toEqual([]);
  });

  it.each(WORKFLOW_TEMPLATES)("topologically orders: $slug", (entry) => {
    const resolved = resolveExecutionOrder(entry);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.order).toHaveLength(entry.steps.length);
    expect(new Set(resolved.order).size).toBe(entry.steps.length);
  });

  it.each(WORKFLOW_TEMPLATES)("keeps step keys unique within: $slug", (entry) => {
    expect(new Set(entry.steps.map((step) => step.key)).size).toBe(entry.steps.length);
  });

  it.each(WORKFLOW_TEMPLATES)("points every dependency at a real step: $slug", (entry) => {
    const keys = new Set(entry.steps.map((step) => step.key));
    for (const step of entry.steps) {
      for (const dependency of step.dependsOn) {
        expect(keys, `${entry.slug}/${step.key} → ${dependency}`).toContain(dependency);
      }
    }
  });

  it.each(WORKFLOW_TEMPLATES)("ends in something watchable: $slug", (entry) => {
    // A template that stops at a generation step has produced loose files and
    // no deliverable, which is indistinguishable from success to the engine.
    const last = entry.steps[entry.steps.length - 1]!;
    expect(isTerminalStepKind(last.kind)).toBe(true);
  });

  it.each(WORKFLOW_TEMPLATES)("orders every step after its dependencies: $slug", (entry) => {
    const resolved = resolveExecutionOrder(entry);
    if (!resolved.ok) throw new Error(resolved.reason);
    const position = new Map(resolved.order.map((key, index) => [key, index] as const));
    for (const step of entry.steps) {
      for (const dependency of step.dependsOn) {
        expect(position.get(dependency)!).toBeLessThan(position.get(step.key)!);
      }
    }
  });

  it("wires every declared input to a matching type", () => {
    // The property validateTemplate exists to enforce, asserted directly so a
    // regression that weakens the validator cannot make the suite pass anyway.
    for (const entry of WORKFLOW_TEMPLATES) {
      const byKey = new Map(entry.steps.map((step) => [step.key, step] as const));
      for (const step of entry.steps) {
        for (const [name, type] of Object.entries(step.inputs)) {
          const fromWorkflow = entry.inputs[name] === type;
          const fromUpstream = step.dependsOn.some(
            (dependency) => byKey.get(dependency)?.outputs[name] === type,
          );
          expect(
            fromWorkflow || fromUpstream,
            `${entry.slug}/${step.key} input "${name}" (${type}) is unwired`,
          ).toBe(true);
        }
      }
    }
  });

  it("fans out per shot only where a shot list exists, and per platform only once", () => {
    for (const entry of WORKFLOW_TEMPLATES) {
      const perPlatform = entry.steps.filter((step) => step.fanOut === "per_platform");
      expect(perPlatform.length, entry.slug).toBeLessThanOrEqual(1);
    }
    // Social variants is the only place a step multiplies by platform: every
    // other template renders one deliverable and reformats it downstream.
    expect(
      template("podcast-clips-social").steps.find((step) => step.fanOut === "per_platform")?.key,
    ).toBe("social_variants");
  });
});

describe("graph resolution failures", () => {
  const base = template("prompt-images-voice-reel");

  it("names the steps trapped in a cycle rather than hanging or throwing", () => {
    const cyclic: WorkflowTemplate = {
      ...base,
      slug: "cyclic",
      steps: [
        {
          key: "alpha",
          kind: "language",
          label: "Alpha",
          dependsOn: ["beta"],
          inputs: {},
          outputs: { alpha: "text" },
        },
        {
          key: "beta",
          kind: "language",
          label: "Beta",
          dependsOn: ["alpha"],
          inputs: {},
          outputs: { beta: "text" },
        },
        {
          key: "render",
          kind: "render",
          label: "Render",
          dependsOn: ["beta"],
          inputs: {},
          outputs: { reel: "video_asset" },
        },
      ],
    };

    const resolved = resolveExecutionOrder(cyclic);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toContain("alpha");
    expect(resolved.reason).toMatch(/cycle/i);
    // A typed result, not an exception — the builder will call this on every
    // keystroke and must be able to render the reason next to the offending node.
    expect(() => resolveExecutionOrder(cyclic)).not.toThrow();
  });

  it("names the missing step when a dependency does not exist", () => {
    const dangling: WorkflowTemplate = {
      ...base,
      slug: "dangling",
      steps: [
        {
          key: "render",
          kind: "render",
          label: "Render",
          dependsOn: ["ghost_step"],
          inputs: {},
          outputs: { reel: "video_asset" },
        },
      ],
    };

    const resolved = resolveExecutionOrder(dangling);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toContain("ghost_step");
    expect(resolved.reason).toContain("render");

    expect(validateTemplate(dangling).join(" ")).toContain("ghost_step");
  });

  it("reports an input no upstream step produces", () => {
    const unwired: WorkflowTemplate = {
      ...base,
      slug: "unwired",
      inputs: {},
      steps: [
        {
          key: "render",
          kind: "render",
          label: "Render",
          dependsOn: [],
          inputs: { composition: "composition" },
          outputs: { reel: "video_asset" },
        },
      ],
    };

    const problems = validateTemplate(unwired);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toContain("composition");
  });

  it("reports a type mismatch against the step that actually produces the value", () => {
    const mistyped: WorkflowTemplate = {
      ...base,
      slug: "mistyped",
      inputs: { prompt: "text" },
      steps: [
        {
          key: "script",
          kind: "language",
          label: "Script",
          dependsOn: [],
          inputs: { prompt: "text" },
          outputs: { script: "text" },
        },
        {
          key: "compose",
          kind: "compose",
          label: "Compose",
          dependsOn: ["script"],
          // Wants the script as a video asset. Silently coercing this is how a
          // composition ends up with a caption track where its footage should be.
          inputs: { script: "video_asset" },
          outputs: { composition: "composition" },
        },
      ],
    };

    const problems = validateTemplate(mistyped).join(" ");
    expect(problems).toContain("script");
    expect(problems).toContain("video_asset");
  });

  it("rejects a template that stops before anything is watchable", () => {
    const truncated: WorkflowTemplate = {
      ...base,
      slug: "truncated",
      steps: base.steps.slice(0, 1),
    };
    expect(validateTemplate(truncated).join(" ")).toMatch(/compose, render or export/);
  });
});

describe("lookup", () => {
  it("returns null for an unknown slug rather than a default template", () => {
    // A fallback here would start the wrong workflow and charge for it.
    expect(findTemplate("no-such-workflow")).toBeNull();
    expect(findTemplate("")).toBeNull();
  });

  it("finds every shipped slug", () => {
    for (const slug of EXPECTED_SLUGS) {
      expect(findTemplate(slug)?.slug).toBe(slug);
    }
  });
});

describe("consent gate", () => {
  it("declares the lip-sync capability so the submit-time gate can see it", () => {
    // The brief forbids animating a real likeness without confirmed rights.
    // That gate keys on the capability, so a lip-sync step that omits it is
    // indistinguishable from an ordinary video step and runs ungated.
    const lipSync = template("portrait-audio-lipsync-export");
    const step = lipSync.steps.find((entry) => entry.kind === "generate_lipsync");
    expect(step?.capability).toBe("lip-sync");
    expect(step?.dependsOn).toContain("consent_check");
  });

  it("puts the consent check before anything can be generated", () => {
    const lipSync = template("portrait-audio-lipsync-export");
    const resolved = resolveExecutionOrder(lipSync);
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(resolved.order[0]).toBe("consent_check");
  });
});
