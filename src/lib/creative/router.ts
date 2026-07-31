import { MagnificProvider } from "./magnific/provider";
import { MockCreativeProvider } from "./mock";
import type {
  CreativeGenerationProvider,
  GenerationKind,
  ProductionMode,
  SupportsQuery,
} from "./types";
import type { AspectRatio } from "@/types/database";

/**
 * Provider selection.
 *
 * The router exists so that no page, server action or worker ever names a
 * provider. Magnific is the first implementation, not a dependency: replacing
 * it with fal.ai or a direct model provider should be a change to the candidate
 * list below and nothing else.
 *
 * Selection is deliberately explainable rather than clever. Every decision
 * returns the reason it was made, because "why did this run on the mock?" is a
 * question the usage dashboard and support both have to answer, and a routing
 * heuristic nobody can reconstruct after the fact is worse than a simple one.
 */

export type RouteRequest = SupportsQuery & {
  /** Workspace preference, when one is configured. Honoured if it can serve. */
  preferredProviderId?: string | null;
  /**
   * Whether falling back to the mock is acceptable.
   *
   * False for real user generations that reserved credits — silently producing
   * a demo asset for someone who paid is worse than failing. True for previews
   * and for local development.
   */
  allowMockFallback: boolean;
};

export type RouteDecision =
  | {
      ok: true;
      provider: CreativeGenerationProvider;
      /** Why this provider was chosen. Recorded on the run row. */
      reason: string;
      /** True when the chosen provider produces demo output. */
      isMock: boolean;
      /** Providers considered and rejected, with cause. For diagnostics. */
      rejected: readonly { providerId: string; reason: string }[];
    }
  | {
      ok: false;
      /** Shown to the user. Says what is missing and what to do about it. */
      reason: string;
      rejected: readonly { providerId: string; reason: string }[];
    };

export class ProviderRouter {
  private readonly candidates: readonly CreativeGenerationProvider[];
  private readonly mock: CreativeGenerationProvider;

  /**
   * @param candidates Real providers, in preference order. The mock is held
   *   separately rather than appended, because it must never be selected by
   *   ordinary preference — only by explicit fallback.
   */
  constructor(options: {
    candidates?: readonly CreativeGenerationProvider[];
    mock?: CreativeGenerationProvider;
  } = {}) {
    this.candidates = options.candidates ?? [new MagnificProvider()];
    this.mock = options.mock ?? new MockCreativeProvider();
  }

  route(request: RouteRequest): RouteDecision {
    const rejected: { providerId: string; reason: string }[] = [];

    const ordered = this.orderedCandidates(request.preferredProviderId ?? null);

    for (const provider of ordered) {
      if (!provider.isConfigured()) {
        rejected.push({
          providerId: provider.id,
          // Names the variable, so an operator reading this is told what to set
          // rather than only that something is missing.
          reason: `Provider configuration required — ${provider.credentialEnvVar} is not set.`,
        });
        continue;
      }

      const decision = provider.supports(request);
      if (!decision.supported) {
        rejected.push({ providerId: provider.id, reason: decision.reason });
        continue;
      }

      return {
        ok: true,
        provider,
        reason:
          provider.id === request.preferredProviderId
            ? `${provider.label} is the workspace's preferred provider and can serve this request.`
            : `${provider.label} is the first configured provider that supports ${describe(request)}.`,
        isMock: false,
        rejected,
      };
    }

    if (request.allowMockFallback) {
      return {
        ok: true,
        provider: this.mock,
        // Names the cause, so the demo badge in the UI can explain itself rather
        // than appearing without justification.
        reason:
          rejected.length === 0
            ? "No generation provider is configured, so the deterministic mock ran. Output is demo only."
            : `No configured provider could serve this request (${rejected.map((r) => r.providerId).join(", ")}), so the deterministic mock ran. Output is demo only.`,
        isMock: true,
        rejected,
      };
    }

    return {
      ok: false,
      reason:
        rejected.length === 0
          ? "Provider configuration required. Set MAGNIFIC_API_KEY to enable generation."
          : `This request cannot be generated: ${rejected.map((r) => r.reason).join(" ")}`,
      rejected,
    };
  }

  /** The preferred provider first, then the rest in declared order. */
  private orderedCandidates(preferredId: string | null): readonly CreativeGenerationProvider[] {
    if (!preferredId) return this.candidates;
    const preferred = this.candidates.find((provider) => provider.id === preferredId);
    if (!preferred) return this.candidates;
    return [preferred, ...this.candidates.filter((provider) => provider.id !== preferredId)];
  }

  /** Every provider's configuration state, for the settings surface. */
  describeProviders(): readonly { id: string; label: string; configured: boolean }[] {
    return this.candidates.map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.isConfigured(),
    }));
  }
}

function describe(request: RouteRequest): string {
  const bits: string[] = [`${request.mode} ${request.kind}`];
  if (request.ratio) bits.push(`at ${request.ratio}`);
  if (request.durationSeconds !== undefined) bits.push(`for ${request.durationSeconds}s`);
  return bits.join(" ");
}

/**
 * Process-wide router.
 *
 * Providers are stateless, so one instance is enough. Not a module-level
 * constant: constructing a `MagnificProvider` reads no environment at
 * construction time, but keeping this lazy means a test can reset it.
 */
let shared: ProviderRouter | null = null;

export function getProviderRouter(): ProviderRouter {
  if (!shared) shared = new ProviderRouter();
  return shared;
}

/** Test seam. Not called in application code. */
export function __setProviderRouter(router: ProviderRouter | null): void {
  shared = router;
}

/** Convenience for the estimator, which routes by ratio and mode only. */
export function routeFor(
  kind: GenerationKind,
  mode: ProductionMode,
  options: { ratio?: AspectRatio; durationSeconds?: number; allowMockFallback?: boolean } = {},
): RouteDecision {
  return getProviderRouter().route({
    kind,
    mode,
    ratio: options.ratio,
    durationSeconds: options.durationSeconds,
    allowMockFallback: options.allowMockFallback ?? true,
  });
}
