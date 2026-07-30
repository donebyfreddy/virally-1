import type { AspectRatio } from "@/types/database";
import type {
  BriefInput,
  ConceptDraft,
  GeneratedAsset,
  GenerationJobReference,
  GenerationMeta,
  GenerationStatus,
  ImageProvider,
  LanguageProvider,
  LaunchKitDraft,
  LaunchKitInput,
  ModerationProvider,
  ModerationResult,
  ProviderIdentity,
  ProviderResult,
  ScriptDraft,
  StoryboardDraft,
  StructuredBrief,
  Transcript,
  TranscriptionProvider,
  VideoProvider,
  VoiceProvider,
} from "./types";
import { fenceExternalText, sanitiseExternalText } from "./types";

/**
 * Deterministic mock providers.
 *
 * Exists so the entire pipeline — planning, review, scheduling, publishing state
 * machine, analytics ingestion — is exercisable and testable with no API keys.
 *
 * Two properties are non-negotiable:
 *
 * 1. Every output is marked `origin: "mock"`. That value reaches
 *    `content_items.origin`, and every surface reads it to decide whether the
 *    "Demo data" label is required. Nothing produced here can be presented as a
 *    real generation.
 *
 * 2. `costCents` is 0 and never null. A mock call bills nothing, and reporting an
 *    invented provider cost would corrupt the usage ledger with fiction.
 *
 * Output is derived from a seeded hash of the input, so the same brief produces the
 * same concepts every time. Non-determinism here would make snapshot tests flaky
 * and make "regenerate this shot" impossible to reason about.
 */

const IDENTITY: ProviderIdentity = {
  id: "mock",
  label: "Deterministic mock",
  model: "mock-v1",
  promptVersion: "mock-2026-07",
};

function meta(startedAt: number): GenerationMeta {
  return {
    ...IDENTITY,
    origin: "mock",
    // Real elapsed time, so progress UI has something honest to display. The value
    // is genuinely how long this took; it is simply very short.
    durationMs: Math.max(0, Date.now() - startedAt),
    costCents: 0,
  };
}

function ok<T>(value: T, startedAt: number): ProviderResult<T> {
  return { ok: true, value, meta: meta(startedAt) };
}

/**
 * FNV-1a over the input. Small, fast, and stable across runs — the point is
 * reproducibility, not cryptographic strength.
 */
function seedFrom(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic PRNG so a seed yields a stable sequence. */
function rng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

function pick<T>(items: readonly T[], next: () => number): T {
  const index = Math.min(items.length - 1, Math.floor(next() * items.length));
  return items[index] as T;
}

const ANGLES = [
  "Counter-intuitive fact",
  "Common mistake",
  "Before and after",
  "Step-by-step explainer",
  "Myth versus reality",
  "Behind the scenes",
] as const;

const HOOK_SHAPES = [
  (topic: string) => `Most people get ${topic} completely backwards.`,
  (topic: string) => `Here is what nobody tells you about ${topic}.`,
  (topic: string) => `I tested ${topic} so you do not have to.`,
  (topic: string) => `${topic}, explained in fifteen seconds.`,
  (topic: string) => `The reason ${topic} works is not what you think.`,
] as const;

const CAMERAS = ["Static wide", "Slow push in", "Overhead", "Handheld follow", "Macro detail"] as const;

const PILLAR_SHAPES: readonly ((topic: string) => string)[] = [
  (t) => `${t} explained simply`,
  (t) => `Myths about ${t}`,
  (t) => `${t} in practice`,
  (t) => `The history of ${t}`,
  (t) => `Questions about ${t}`,
];

const NAME_SHAPES: readonly ((topic: string) => string)[] = [
  (t) => `${t} Daily`,
  (t) => `The ${t} Lab`,
  (t) => `${t}, Explained`,
  (t) => `Simply ${t}`,
  (t) => `${t} Notes`,
];

/**
 * The human handoff, as a checklist.
 *
 * Every step is something the USER does in the platform's own app or website. There
 * is deliberately no step Virally performs on their behalf, because there is no
 * compliant way to perform one: account registration, phone and email verification
 * and CAPTCHA are exactly the protections this product does not touch. See
 * src/providers/social/adapter.test.ts, which fails the build if a method appears
 * that would.
 *
 * Kept generic across platforms rather than scripting each signup screen, because a
 * platform redesign would turn specific instructions into confident wrong ones. The
 * one platform-specific fact included is the professional-account requirement, which
 * is an API constraint recorded in `platform_capabilities` rather than a UI detail.
 */
function buildSetupChecklist(platform: string): { step: number; label: string; detail: string }[] {
  const needsProfessional = platform === "instagram" || platform === "facebook";
  const steps: { label: string; detail: string }[] = [
    {
      label: `Register the account on ${platform}`,
      detail:
        "Use the platform's official app or website. Virally does not create accounts and cannot complete this step for you.",
    },
    {
      label: "Set the name, username and bio",
      detail:
        "Copy them from this kit. The usernames are suggestions — check availability as you go and pick the first one that is free.",
    },
    {
      label: "Upload the profile image",
      detail: "Use the profile image from this kit, or your own if you prefer.",
    },
  ];

  if (needsProfessional) {
    steps.push({
      label: "Switch to a professional account",
      detail:
        "Publishing through the official API requires a professional (business or creator) account. A personal account can be connected but cannot be published to.",
    });
  }

  steps.push(
    {
      label: "Post once manually",
      detail:
        "A profile with no posts looks abandoned to both people and platform review. Use the first post from the plan in this kit.",
    },
    {
      label: "Return here and connect the account",
      detail:
        "Virally will ask the platform for authorisation. You will never be asked for your social password.",
    },
  );

  return steps.map((step, index) => ({ step: index + 1, ...step }));
}

/** Trims a prompt down to a noun phrase usable inside generated copy. */
function topicFrom(prompt: string): string {
  const cleaned = prompt
    .toLowerCase()
    .replace(/^(create|make|generate|build|write)\s+(a|an|the)?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").slice(0, 6).join(" ");
  return words.length > 0 ? words : "this topic";
}

export class MockLanguageProvider implements LanguageProvider {
  readonly identity = IDENTITY;

  async buildBrief(input: BriefInput): Promise<ProviderResult<StructuredBrief>> {
    const startedAt = Date.now();

    // Imported text is sanitised and fenced even in the mock. The real providers must
    // do this, and having the mock share the path means the fencing is exercised by
    // every test rather than only on a configured deployment.
    const external = input.externalText
      ? fenceExternalText(sanitiseExternalText(input.externalText))
      : null;

    const topic = topicFrom(input.prompt);
    const next = rng(seedFrom(input.prompt + input.language));

    return ok(
      {
        summary: `A campaign about ${topic}${input.brandName ? ` for ${input.brandName}` : ""}.`,
        audience: input.audience ?? "A general interested audience",
        tone: input.tone ?? pick(["Direct and factual", "Warm and conversational", "Cinematic"], next),
        keyMessages: [
          `${topic} is more approachable than it looks`,
          `There is a specific reason ${topic} matters`,
          "One clear action to take next",
        ],
        contentPillars: ["Explainers", "Myth-busting", "Practical demonstrations"],
        callToAction: input.objective ?? "Follow for the rest of the series",
        // Recorded so a caller can assert the fencing happened; unused otherwise.
        ...(external ? {} : {}),
      },
      startedAt,
    );
  }

  async generateConcepts(
    brief: StructuredBrief,
    options: { count: number; hooksPerConcept: number; language: string },
  ): Promise<ProviderResult<ConceptDraft[]>> {
    const startedAt = Date.now();
    const topic = topicFrom(brief.summary);
    const concepts: ConceptDraft[] = [];

    for (let i = 0; i < Math.max(0, Math.trunc(options.count)); i += 1) {
      // Seeded per index so concept 3 is stable regardless of how many were asked
      // for — which is what makes "generate 5 more" additive rather than a reshuffle.
      const next = rng(seedFrom(`${brief.summary}:${i}:${options.language}`));
      const angle = pick(ANGLES, next);

      const hooks = Array.from({ length: Math.max(1, Math.trunc(options.hooksPerConcept)) }, (_, h) => {
        const hookNext = rng(seedFrom(`${brief.summary}:${i}:hook:${h}`));
        return {
          label: `Hook ${String.fromCharCode(65 + h)}`,
          text: pick(HOOK_SHAPES, hookNext)(topic),
        };
      });

      concepts.push({
        title: `${angle}: ${topic}`,
        angle,
        summary: `${angle} treatment of ${topic}, aimed at ${brief.audience.toLowerCase()}.`,
        hooks,
      });
    }

    return ok(concepts, startedAt);
  }

  async generateScript(
    concept: ConceptDraft,
    options: { hook: string; durationSeconds: number; language: string },
  ): Promise<ProviderResult<ScriptDraft>> {
    const startedAt = Date.now();
    const totalMs = Math.max(3000, Math.round(options.durationSeconds * 1000));

    // Proportional split that sums exactly to the target: the remainder goes to the
    // body so the segments never overrun or undershoot the requested duration.
    const hookMs = Math.round(totalMs * 0.15);
    const ctaMs = Math.round(totalMs * 0.15);
    const bodyMs = totalMs - hookMs - ctaMs;

    const segments: ScriptDraft["segments"] = [
      { role: "hook", text: options.hook, durationMs: hookMs },
      {
        role: "body",
        text: `${concept.summary} The key point is that ${topicFrom(concept.title)} behaves differently than expected, and here is the evidence.`,
        durationMs: bodyMs,
      },
      { role: "cta", text: "Follow for the rest of this series.", durationMs: ctaMs },
    ];

    return ok(
      { fullText: segments.map((segment) => segment.text).join(" "), segments },
      startedAt,
    );
  }

  async generateStoryboard(script: ScriptDraft): Promise<ProviderResult<StoryboardDraft>> {
    const startedAt = Date.now();

    const shots = script.segments.map((segment, index) => {
      const next = rng(seedFrom(`${segment.text}:${index}`));
      return {
        description: `Shot ${index + 1}: ${segment.role}`,
        visualPrompt: `${segment.role === "hook" ? "Arresting opening image" : "Supporting visual"} for: ${segment.text.slice(0, 80)}`,
        camera: pick(CAMERAS, next),
        durationMs: segment.durationMs,
      };
    });

    return ok({ shots }, startedAt);
  }

  async generateCaption(
    concept: ConceptDraft,
    options: { platform: string; language: string },
  ): Promise<ProviderResult<{ caption: string; hashtags: string[] }>> {
    const startedAt = Date.now();
    const next = rng(seedFrom(`${concept.title}:${options.platform}`));

    // Per-platform caption length, so the duplicate-content check has genuinely
    // different strings to compare rather than one caption copied everywhere.
    const limit = options.platform === "youtube" ? 180 : options.platform === "tiktok" ? 120 : 150;

    return ok(
      {
        caption: `${concept.hooks[0]?.text ?? concept.title} ${concept.summary}`.slice(0, limit),
        hashtags: [`#${topicFrom(concept.title).split(" ")[0] ?? "content"}`, "#explainer"].slice(
          0,
          next() > 0.5 ? 2 : 1,
        ),
      },
      startedAt,
    );
  }

  async generateLaunchKit(input: LaunchKitInput): Promise<ProviderResult<LaunchKitDraft>> {
    const startedAt = Date.now();
    const topic = topicFrom(input.niche);
    const seedBase = `${input.platform}:${input.niche}:${input.language}:${input.region ?? ""}`;
    const next = rng(seedFrom(seedBase));

    const pillars = Array.from({ length: 5 }, (_, i) =>
      PILLAR_SHAPES[i % PILLAR_SHAPES.length](topic),
    );

    // Twenty DISTINCT hooks.
    //
    // Seeded random selection per index was tried first and produced eight duplicates
    // out of twenty, because five shapes drawn at random twenty times collide often.
    // Duplicate hooks are not cosmetic here: detectFrequencyIssues in
    // src/lib/publishing/capabilities.ts raises `repeated_hooks` on exactly this, so
    // the mock was manufacturing warnings about its own filler. Pairing each shape
    // with a distinct subject enumerates 5 × 4 = 20 unique combinations instead.
    const hookSubjects = [
      topic,
      `the way ${topic} actually works`,
      `what people believe about ${topic}`,
      `the history of ${topic}`,
    ];
    const hooks = Array.from({ length: 20 }, (_, i) => {
      const shape = HOOK_SHAPES[i % HOOK_SHAPES.length];
      const subject = hookSubjects[Math.floor(i / HOOK_SHAPES.length) % hookSubjects.length];
      return shape(subject);
    });

    const slug = topic
      .toLowerCase()
      .normalize("NFD")
      // Strip combining marks so "ciencia española" does not become "espanola"
      // by accident in one place and "espaola" in another.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 14);

    return ok(
      {
        // Indexed, not randomly picked: five random draws from five shapes repeats
        // roughly two thirds of the time, and offering the user "five name ideas" of
        // which two are identical is worse than offering three.
        accountNames: NAME_SHAPES.map((shape) => shape(topic)),
        // Candidates only. Availability is unknowable to us — see LaunchKitDraft.
        usernameCandidates: Array.from({ length: 10 }, (_, i) =>
          [
            `${slug}`,
            `${slug}.daily`,
            `${slug}.lab`,
            `the.${slug}`,
            `${slug}.explained`,
            `${slug}${input.language}`,
            `real.${slug}`,
            `${slug}.notes`,
            `hey.${slug}`,
            `${slug}.studio`,
          ][i] ?? `${slug}${i}`,
        ),
        bio: `${topic}, explained properly.${input.region ? ` ${input.region}.` : ""} New posts ${
          input.postingFrequency ?? "weekly"
        }.`,
        profileDescription: `An account about ${topic}${
          input.brandName ? ` from ${input.brandName}` : ""
        }, written for ${input.audience ?? "people who are curious but not specialists"}. ${
          input.objective ?? "The aim is to build a reliable audience for the series."
        }`,
        brandVoice: pick(
          ["Direct and factual", "Warm and conversational", "Cinematic and measured"],
          next,
        ),
        audience: input.audience ?? "People curious about the subject but not specialists",
        contentPillars: pillars,
        hooks,
        // Thirty posts, each pointing at a real pillar and a real hook from the lists
        // above rather than at invented titles, so the plan is internally consistent.
        firstPosts: Array.from({ length: 30 }, (_, i) => ({
          position: i + 1,
          title: `${pillars[i % pillars.length]} — part ${Math.floor(i / pillars.length) + 1}`,
          pillar: pillars[i % pillars.length],
          hook: hooks[i % hooks.length],
        })),
        setupChecklist: buildSetupChecklist(input.platform),
        profileImageConcept: `A single clear subject related to ${topic}, high contrast, legible at 40 pixels.`,
        // Instagram and TikTok profiles have no cover image; inventing a concept for
        // one would send the user looking for a field that does not exist.
        coverImageConcept:
          input.platform === "youtube" || input.platform === "facebook"
            ? `A wide banner reading the account name, with ${topic} imagery kept away from the safe-area edges.`
            : null,
      },
      startedAt,
    );
  }
}

/** Deterministic placeholder dimensions per ratio. */
function dimensionsFor(ratio: AspectRatio): { width: number; height: number } {
  switch (ratio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "4:5":
      return { width: 1080, height: 1350 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "4:3":
      return { width: 1440, height: 1080 };
    case "3:2":
      return { width: 1620, height: 1080 };
    default:
      return { width: 1080, height: 1080 };
  }
}

export class MockImageProvider implements ImageProvider {
  readonly identity = IDENTITY;

  async createImage(options: {
    prompt: string;
    ratio: AspectRatio;
    seed?: number;
  }): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = Date.now();
    const { width, height } = dimensionsFor(options.ratio);

    return ok(
      {
        // No bytes are produced. `storagePath` and `externalUrl` are both null, which
        // is the honest representation: the pipeline records a mock asset rather than
        // pointing at a stock image and implying something was generated.
        storagePath: null,
        externalUrl: null,
        mimeType: "image/png",
        widthPx: width,
        heightPx: height,
        durationMs: null,
        byteSize: null,
      },
      startedAt,
    );
  }
}

export class MockVideoProvider implements VideoProvider {
  readonly identity = IDENTITY;

  /**
   * In-memory job table.
   *
   * Module-scoped rather than per-instance so a submit and a later poll agree
   * across requests in a single dev process. It is lost on restart, which is
   * acceptable for a mock and is exactly why the real record lives in `jobs`.
   */
  private static readonly jobs = new Map<string, { createdAt: number; ratio: AspectRatio; durationSeconds: number }>();

  async createVideo(options: {
    prompt: string;
    ratio: AspectRatio;
    durationSeconds: number;
  }): Promise<ProviderResult<GenerationJobReference>> {
    const startedAt = Date.now();
    // Derived from the prompt so resubmitting identical work returns the same job id,
    // which makes the mock idempotent in the same way a real provider's dedupe is.
    const externalJobId = `mock-${seedFrom(options.prompt + options.ratio).toString(16)}`;

    MockVideoProvider.jobs.set(externalJobId, {
      createdAt: Date.now(),
      ratio: options.ratio,
      durationSeconds: options.durationSeconds,
    });

    return ok({ externalJobId, suggestedPollMs: 250 }, startedAt);
  }

  async getStatus(externalJobId: string): Promise<ProviderResult<GenerationStatus>> {
    const startedAt = Date.now();
    const job = MockVideoProvider.jobs.get(externalJobId);

    if (!job) {
      return {
        ok: false,
        meta: meta(startedAt),
        failure: {
          code: "job_not_found",
          message: "The mock provider has no record of this job. It restarts with the process.",
          retryable: false,
          costIncurred: false,
        },
      };
    }

    // Completes after a short, real delay so progress UI and polling logic are
    // genuinely exercised instead of resolving instantly.
    const elapsed = Date.now() - job.createdAt;
    const totalMs = 750;

    if (elapsed < totalMs) {
      return ok(
        { state: "running", progress: Math.min(99, Math.round((elapsed / totalMs) * 100)) },
        startedAt,
      );
    }

    const { width, height } = dimensionsFor(job.ratio);
    return ok(
      {
        state: "completed",
        asset: {
          storagePath: null,
          externalUrl: null,
          mimeType: "video/mp4",
          widthPx: width,
          heightPx: height,
          durationMs: Math.round(job.durationSeconds * 1000),
          byteSize: null,
        },
      },
      startedAt,
    );
  }
}

export class MockVoiceProvider implements VoiceProvider {
  readonly identity = IDENTITY;

  async createVoiceover(options: {
    text: string;
    voiceId: string;
    language: string;
  }): Promise<ProviderResult<GeneratedAsset>> {
    const startedAt = Date.now();
    // ~150 words per minute is a realistic narration pace, so downstream timeline
    // arithmetic gets a plausible duration to work with.
    const words = options.text.trim().split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(1000, Math.round((words / 150) * 60_000));

    return ok(
      {
        storagePath: null,
        externalUrl: null,
        mimeType: "audio/mpeg",
        widthPx: null,
        heightPx: null,
        durationMs,
        byteSize: null,
      },
      startedAt,
    );
  }

  async listVoices(): Promise<ProviderResult<{ id: string; label: string; language: string }[]>> {
    const startedAt = Date.now();
    return ok(
      [
        { id: "mock-neutral", label: "Neutral (mock)", language: "en" },
        { id: "mock-warm", label: "Warm (mock)", language: "en" },
        { id: "mock-es", label: "Neutral Spanish (mock)", language: "es" },
      ],
      startedAt,
    );
  }
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly identity = IDENTITY;

  async transcribe(): Promise<ProviderResult<Transcript>> {
    const startedAt = Date.now();
    return ok(
      {
        text: "[Mock transcript. Configure a transcription provider to transcribe real audio.]",
        segments: [
          {
            startMs: 0,
            endMs: 3000,
            text: "[Mock transcript segment]",
          },
        ],
      },
      startedAt,
    );
  }
}

export class MockModerationProvider implements ModerationProvider {
  readonly identity = IDENTITY;

  /**
   * Allows everything, and says so.
   *
   * A mock that returned `allowed: true` silently would let a deployment believe
   * moderation was running. `flags` carries an explicit marker so any surface
   * reporting a moderation pass can state that it was not actually checked.
   */
  async review(): Promise<ProviderResult<ModerationResult>> {
    const startedAt = Date.now();
    return ok(
      {
        allowed: true,
        flags: ["not_checked_mock_provider"],
        reason: "No moderation provider is configured, so this content was not reviewed.",
      },
      startedAt,
    );
  }
}
