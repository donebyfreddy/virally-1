import {
  MockImageProvider,
  MockLanguageProvider,
  MockModerationProvider,
  MockTranscriptionProvider,
  MockVideoProvider,
  MockVoiceProvider,
} from "./mock";
import type {
  ImageProvider,
  LanguageProvider,
  ModerationProvider,
  TranscriptionProvider,
  VideoProvider,
  VoiceProvider,
} from "./types";

/**
 * Provider resolution and capability detection.
 *
 * The rule: a missing key degrades ONE capability to the mock. It never crashes, and
 * it never silently pretends the real provider ran — `capabilityStatus()` is what
 * the UI reads to label output as demo, and the resolved provider's `origin` is what
 * lands in the database.
 *
 * Real adapters are not implemented here. Wiring Anthropic or fal against keys that
 * do not exist would be untested code claiming to work; the interfaces and this
 * registry are the seam they slot into, and `capabilityStatus` reports them as
 * unconfigured until they do.
 */

export type Capability =
  | "language"
  | "image"
  | "video"
  | "voice"
  | "transcription"
  | "moderation";

export type CapabilityState =
  /** A real provider is configured and will be used. */
  | { state: "configured"; providerId: string; label: string }
  /** No key present; the deterministic mock runs and output is labelled demo. */
  | { state: "mock"; reason: string; requiredEnv: readonly string[] }
  /** A key is present but the adapter is not implemented yet. */
  | { state: "adapter_missing"; reason: string };

/**
 * Which environment variables would enable each capability.
 *
 * Read via `process.env` on the server only. These are not NEXT_PUBLIC_, so a client
 * component importing this module would see them all as undefined — hence the
 * server-only accessor below rather than a top-level constant.
 */
const CAPABILITY_ENV: Readonly<Record<Capability, readonly string[]>> = {
  language: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  image: ["FAL_KEY", "REPLICATE_API_TOKEN", "OPENAI_API_KEY"],
  video: ["FAL_KEY", "REPLICATE_API_TOKEN"],
  voice: ["ELEVENLABS_API_KEY"],
  transcription: ["OPENAI_API_KEY", "ELEVENLABS_API_KEY"],
  moderation: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
};

function readKey(name: string): string | undefined {
  if (typeof window !== "undefined") {
    throw new Error(
      "AI provider keys were read in a browser context. The registry is server-only.",
    );
  }
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** Names of the configured keys for a capability, without exposing their values. */
function configuredEnvFor(capability: Capability): readonly string[] {
  return CAPABILITY_ENV[capability].filter((name) => readKey(name) !== undefined);
}

export function capabilityStatus(capability: Capability): CapabilityState {
  const configured = configuredEnvFor(capability);

  if (configured.length === 0) {
    return {
      state: "mock",
      reason:
        "No provider key is configured, so a deterministic mock runs instead. Output is labelled as demo data and is not a real generation.",
      requiredEnv: CAPABILITY_ENV[capability],
    };
  }

  // A key exists but no adapter consumes it yet. Reported distinctly from "mock"
  // because the fix is different: the user has done their part, the code has not.
  return {
    state: "adapter_missing",
    reason: `${configured.join(" and ")} ${configured.length > 1 ? "are" : "is"} set, but the provider adapter for ${capability} is not implemented yet. The mock runs until it is, and output stays labelled as demo data.`,
  };
}

export function allCapabilityStatuses(): Readonly<Record<Capability, CapabilityState>> {
  return {
    language: capabilityStatus("language"),
    image: capabilityStatus("image"),
    video: capabilityStatus("video"),
    voice: capabilityStatus("voice"),
    transcription: capabilityStatus("transcription"),
    moderation: capabilityStatus("moderation"),
  };
}

/**
 * True when every generation on this deployment is a mock.
 *
 * Drives the global "Demo data" labelling. Deliberately pessimistic: it reports
 * mock-only unless a capability is genuinely `configured`, so an adapter that is
 * half-wired cannot cause real-looking output to go unlabelled.
 */
export function isMockOnly(): boolean {
  return Object.values(allCapabilityStatuses()).every((status) => status.state !== "configured");
}

// Providers are stateless, so one instance each is enough.
const mockLanguage = new MockLanguageProvider();
const mockImage = new MockImageProvider();
const mockVideo = new MockVideoProvider();
const mockVoice = new MockVoiceProvider();
const mockTranscription = new MockTranscriptionProvider();
const mockModeration = new MockModerationProvider();

export function getLanguageProvider(): LanguageProvider {
  return mockLanguage;
}
export function getImageProvider(): ImageProvider {
  return mockImage;
}
export function getVideoProvider(): VideoProvider {
  return mockVideo;
}
export function getVoiceProvider(): VoiceProvider {
  return mockVoice;
}
export function getTranscriptionProvider(): TranscriptionProvider {
  return mockTranscription;
}
export function getModerationProvider(): ModerationProvider {
  return mockModeration;
}

/** Copy for the UI banner shown wherever mock output is displayed. */
export const DEMO_LABEL = "Demo data" as const;

export const DEMO_EXPLANATION =
  "Generated by a deterministic mock because no AI provider key is configured. It is not a real generation and does not reflect what a configured provider would produce." as const;
