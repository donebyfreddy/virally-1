/**
 * Credential access for creative generation providers.
 *
 * This is the ONLY module in the codebase permitted to read a provider secret.
 * Every rule below exists because the failure it prevents is unrecoverable:
 *
 * 1. `readSecret` throws in a browser context. A client component that imports
 *    this module fails loudly at the import boundary rather than silently
 *    receiving `undefined` and degrading to mock — which would look like a
 *    configuration problem instead of the security bug it actually is.
 *
 * 2. Nothing here returns a secret to a caller outside this directory. The
 *    exported surface is `isConfigured` / `describe` — booleans and prose. The
 *    value itself is handed only to the HTTP client inside
 *    src/lib/creative/magnific/, so a secret cannot reach a server action's
 *    return value (which Next serialises straight to the client) by accident.
 *
 * 3. No value is ever interpolated into an error message, a log line, or a
 *    thrown Error. `describe()` names the VARIABLE, never its contents.
 *
 * A missing credential is a supported state, not a crash: the app must boot
 * and the whole campaign flow must stay usable against the mock provider.
 */

/** Env vars this module owns. Adding one here is the only way to add a secret. */
export const CREATIVE_ENV = {
  magnificApiKey: "MAGNIFIC_API_KEY",
  magnificWebhookSecret: "MAGNIFIC_WEBHOOK_SECRET",
  /** The primary real generation provider. Issue from https://fal.ai/dashboard/keys. */
  falApiKey: "FAL_API_KEY",
} as const;

export type CreativeEnvVar = (typeof CREATIVE_ENV)[keyof typeof CREATIVE_ENV];

/**
 * Reads a secret, or undefined when absent or blank.
 *
 * Blank is treated as absent on purpose. `MAGNIFIC_API_KEY=` in a .env file is
 * how every deployment starts, and a zero-length string sent as a bearer
 * credential produces a 401 that reads like a revoked key rather than an unset
 * one — a materially worse debugging experience for the same underlying state.
 */
function readSecret(name: CreativeEnvVar): string | undefined {
  if (typeof window !== "undefined") {
    // Deliberately does not name the variable in the message. This error can
    // surface in a browser console, and the variable name is a hint about what
    // to go looking for.
    throw new Error(
      "A provider credential was read in a browser context. src/lib/creative/env.ts is server-only and must not be imported from a client component.",
    );
  }
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * The Magnific API key, for the HTTP client only.
 *
 * Not exported from src/lib/creative/index.ts. Call sites outside
 * src/lib/creative/magnific/ should use `isMagnificConfigured()` instead — they
 * need to know *whether* generation is possible, never the credential itself.
 */
export function magnificApiKey(): string | undefined {
  return readSecret(CREATIVE_ENV.magnificApiKey);
}

/** The webhook signing secret, for signature verification only. */
export function magnificWebhookSecret(): string | undefined {
  return readSecret(CREATIVE_ENV.magnificWebhookSecret);
}

export function isMagnificConfigured(): boolean {
  return magnificApiKey() !== undefined;
}

/**
 * Whether inbound webhooks can be verified.
 *
 * Separate from `isMagnificConfigured` because the two credentials are issued
 * as distinct values and are routinely deployed apart: a key set without its
 * webhook secret is a normal, working configuration that simply polls.
 */
export function isMagnificWebhookConfigured(): boolean {
  return magnificWebhookSecret() !== undefined;
}

/**
 * The fal.ai key, for the HTTP client in src/lib/creative/fal/ only.
 *
 * Not exported from src/lib/creative/index.ts, for the same reason
 * `magnificApiKey` is not: call sites need to know *whether* generation is
 * possible, never the credential.
 */
export function falApiKey(): string | undefined {
  return readSecret(CREATIVE_ENV.falApiKey);
}

export function isFalConfigured(): boolean {
  return falApiKey() !== undefined;
}

/**
 * Per-provider configuration state.
 *
 * Validated separately per provider, and deliberately not aggregated into a
 * single boolean: a deployment with fal but not Magnific is a normal, fully
 * working configuration, and one overall "generation available" flag would
 * force the settings UI to either overstate or understate what is actually
 * possible.
 */
export type ProviderEnvStatus = {
  providerId: string;
  label: string;
  /** The variable an operator must set. Safe to render and to log. */
  credentialEnvVar: string;
  configured: boolean;
  /** Prose for the settings surface. Names variables, never values. */
  detail: string;
};

function magnificDetail(): string {
  if (!isMagnificConfigured()) {
    return `Provider configuration required. Set ${CREATIVE_ENV.magnificApiKey} to enable Magnific.`;
  }
  if (!isMagnificWebhookConfigured()) {
    return `Configured for generation. ${CREATIVE_ENV.magnificWebhookSecret} is not set, so completions are detected by polling instead of webhooks.`;
  }
  return "Configured for generation and verified webhook completion.";
}

export function describeProviderEnv(): readonly ProviderEnvStatus[] {
  return [
    {
      providerId: "fal",
      label: "fal.ai",
      credentialEnvVar: CREATIVE_ENV.falApiKey,
      configured: isFalConfigured(),
      detail: isFalConfigured()
        ? // Stated plainly rather than left implicit: this adapter does not
          // verify fal's webhook signature scheme, so completions are detected
          // by polling only — there is no inbound callback wired up at all,
          // unlike Magnific's or the removed MuAPI adapter's webhook routes.
          "Configured for generation. Completions are detected by polling."
        : `Provider configuration required. Set ${CREATIVE_ENV.falApiKey} to enable fal.ai.`,
    },
    {
      providerId: "magnific",
      label: "Magnific",
      credentialEnvVar: CREATIVE_ENV.magnificApiKey,
      configured: isMagnificConfigured(),
      detail: magnificDetail(),
    },
  ];
}

/** Whether any real provider can generate. False means the mock is all there is. */
export function isAnyProviderConfigured(): boolean {
  return describeProviderEnv().some((provider) => provider.configured);
}

export type CreativeEnvStatus = {
  /** Real generation is possible. */
  generation: boolean;
  /** Inbound completion webhooks can be authenticated. */
  webhooks: boolean;
  /**
   * Operator-facing explanation. Names variables, never values, and is safe to
   * render in the dashboard or write to a log.
   */
  detail: string;
};

/**
 * Configuration state for the settings and usage surfaces.
 *
 * The brief requires unconfigured features to report "Provider configuration
 * required" rather than failing. This is the string they read.
 *
 * fal is checked first because it is the primary provider: a deployment with
 * only fal configured is the common case this reports on, and Magnific is
 * checked only when fal is absent, not merged with it — the two are unrelated
 * credentials, and a deployment could have either, both, or neither.
 */
export function describeCreativeEnv(): CreativeEnvStatus {
  if (isFalConfigured()) {
    return {
      generation: true,
      // fal's webhook signature is not verified by this adapter; polling is
      // the only completion path, so there is nothing to report as verified.
      webhooks: false,
      detail: "fal.ai is configured for generation. Completions are detected by polling.",
    };
  }

  const magnificGeneration = isMagnificConfigured();
  const webhooks = isMagnificWebhookConfigured();

  if (!magnificGeneration) {
    return {
      generation: false,
      webhooks: false,
      detail: `Provider configuration required. Set ${CREATIVE_ENV.falApiKey} to enable real generation. Until then, generation runs against the deterministic mock and every output is labelled as demo. Campaign planning, editing and scheduling are unaffected.`,
    };
  }

  if (!webhooks) {
    return {
      generation: true,
      webhooks: false,
      detail: `${CREATIVE_ENV.magnificApiKey} is set. ${CREATIVE_ENV.magnificWebhookSecret} is not, so completions are detected by polling instead of webhooks — generations still finish, they are just noticed a little later. Inbound webhooks are rejected until the secret is set, because an unverified webhook is an unauthenticated write path.`,
    };
  }

  return {
    generation: true,
    webhooks: true,
    detail: "Magnific is configured for generation and verified webhook completion.",
  };
}
