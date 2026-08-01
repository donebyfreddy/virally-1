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
  /**
   * Upstream tooling calls this `MUAPI_KEY`; Virally does not.
   *
   * Named for consistency with `MAGNIFIC_API_KEY` because these variables are
   * read side by side in every deployment checklist, and a set where one member
   * breaks the pattern is the one an operator mistypes.
   */
  muapiApiKey: "MUAPI_API_KEY",
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
 * The MuAPI key, for the HTTP client in src/lib/creative/muapi/ only.
 *
 * Not exported from src/lib/creative/index.ts, for the same reason
 * `magnificApiKey` is not: call sites need to know *whether* generation is
 * possible, never the credential.
 */
export function muapiApiKey(): string | undefined {
  return readSecret(CREATIVE_ENV.muapiApiKey);
}

export function isMuApiConfigured(): boolean {
  return muapiApiKey() !== undefined;
}

/**
 * Per-provider configuration state.
 *
 * Validated separately per provider, and deliberately not aggregated into a
 * single boolean: a deployment with Magnific but not MuAPI is a normal, fully
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
      providerId: "magnific",
      label: "Magnific",
      credentialEnvVar: CREATIVE_ENV.magnificApiKey,
      configured: isMagnificConfigured(),
      detail: magnificDetail(),
    },
    {
      providerId: "muapi",
      label: "MuAPI",
      credentialEnvVar: CREATIVE_ENV.muapiApiKey,
      configured: isMuApiConfigured(),
      detail: isMuApiConfigured()
        ? // Stated plainly because it is a real operational difference from
          // Magnific, not a limitation of the adapter: MuAPI publishes no
          // webhook signature scheme, so an inbound webhook cannot be
          // authenticated and is therefore never trusted as a state transition.
          "Configured for generation. MuAPI publishes no webhook signature scheme, so completions are detected by polling; an inbound webhook only schedules an earlier poll."
        : `Provider configuration required. Set ${CREATIVE_ENV.muapiApiKey} to enable MuAPI.`,
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
 */
export function describeCreativeEnv(): CreativeEnvStatus {
  const generation = isMagnificConfigured();
  const webhooks = isMagnificWebhookConfigured();

  if (!generation) {
    return {
      generation: false,
      webhooks: false,
      detail: `Provider configuration required. ${CREATIVE_ENV.magnificApiKey} is not set, so generation runs against the deterministic mock and every output is labelled as demo. Campaign planning, editing and scheduling are unaffected.`,
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
