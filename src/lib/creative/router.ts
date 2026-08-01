import type { GenerationCapability, GenerationModel } from "./capabilities";
import { listModels as listCatalogModels } from "./catalog";
import { MagnificProvider } from "./magnific/provider";
import { MockCreativeProvider } from "./mock";
import { MuApiProvider } from "./muapi/provider";
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
 * provider. Magnific was the first implementation; MuAPI is the second, and
 * neither is a dependency — replacing either should be a change to the
 * candidate list and nothing else.
 *
 * Selection is deliberately explainable rather than clever. Every decision
 * returns the reason it was made, because "why did this run on the mock?" and
 * "why did this cost twice what the other one did?" are questions the usage
 * dashboard and support both have to answer, and a routing heuristic nobody can
 * reconstruct after the fact is worse than a simple one.
 *
 * There are two entry points and the difference between them matters:
 *
 * `route()` is synchronous and answers from what the providers know about
 * themselves. It cannot consult the catalogue table, so it cannot know that an
 * operator disabled a model an hour ago. Kept because the estimator and several
 * existing call sites are synchronous.
 *
 * `routeAsync()` reads the Neon catalogue first and hands each provider only
 * the models it may currently use, then picks on price. This is the one new
 * code should call — it is the only one that honours a model being switched
 * off, repriced or deprecated without a deploy, which is the whole reason the
 * catalogue is a table.
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
      /**
       * The specific model selected, when the decision was made against the
       * catalogue. Null from the synchronous path, which does not consult it.
       */
      model?: GenerationModel | null;
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
    this.candidates = options.candidates ?? [new MagnificProvider(), new MuApiProvider()];
    this.mock = options.mock ?? new MockCreativeProvider();
  }

  /** Every provider, including the mock. Used to resolve a run's provider back. */
  allProviders(): readonly CreativeGenerationProvider[] {
    return [...this.candidates, this.mock];
  }

  /**
   * Resolves a provider by id.
   *
   * Exists because a run persists the id of the provider that submitted it, and
   * polling that run must reach the same provider — not whatever the router
   * would pick today. Re-routing to answer this question was the previous
   * behaviour and it silently broke the moment a second provider existed: a
   * MuAPI run would be polled against Magnific's client.
   */
  providerById(providerId: string, modelId?: string | null): CreativeGenerationProvider | null {
    const found = this.allProviders().find((provider) => provider.id === providerId) ?? null;
    if (!found || !modelId) return found;

    // A pinned model needs its own adapter instance, because model selection is
    // constructor state on both real adapters. Returning the shared instance
    // would let it re-select — and the quote the user accepted, the credits
    // reserved and the model actually run would then be three different things.
    if (providerId === "magnific") return new MagnificProvider({ modelId });
    if (providerId === "muapi") return new MuApiProvider({ modelId });
    // The mock ignores model selection entirely, and any future provider is
    // returned unpinned rather than silently dropped.
    return found;
  }

  route(request: RouteRequest): RouteDecision {
    const rejected: { providerId: string; reason: string }[] = [];

    const ordered = this.orderedCandidates(request.preferredProviderId ?? null);

    for (const provider of ordered) {
      const skip = this.reasonToSkip(provider, request);
      if (skip) {
        rejected.push({ providerId: provider.id, reason: skip });
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
        model: null,
      };
    }

    return this.fallback(request, rejected);
  }

  /**
   * Catalogue-aware selection.
   *
   * Picks the cheapest routable model that fits, across every configured
   * provider, rather than the first provider that says yes. Cost is the tie
   * break rather than declaration order because with two real providers the
   * declaration order is arbitrary, and letting an arbitrary order decide which
   * of two capable models a user is charged for is not defensible to that user.
   *
   * Production mode is honoured before price: a workspace on Cinematic that
   * asked for premium output is not quietly served the cheapest model, because
   * the mode is what they paid for. Mode filtering happens in the catalogue
   * query, so "cheapest" always means "cheapest within the tier they bought".
   */
  async routeAsync(request: RouteRequest): Promise<RouteDecision> {
    const rejected: { providerId: string; reason: string }[] = [];
    const capability = request.capability;

    const available = await listCatalogModels({
      capability,
      mode: request.mode,
    });

    type Candidate = { provider: CreativeGenerationProvider; model: GenerationModel };
    const viable: Candidate[] = [];

    for (const provider of this.orderedCandidates(request.preferredProviderId ?? null)) {
      const skip = this.reasonToSkip(provider, request);
      if (skip) {
        rejected.push({ providerId: provider.id, reason: skip });
        continue;
      }

      const models = available.filter((model) => model.providerId === provider.id);
      if (models.length === 0) {
        rejected.push({
          providerId: provider.id,
          reason: capability
            ? `${provider.label} has no enabled, priced ${capability} model for ${request.mode} production.`
            : `${provider.label} has no enabled, priced model for ${request.mode} production.`,
        });
        continue;
      }

      // Cheapest within this provider. `estimatedCentsPerUnit` is guaranteed
      // present: the catalogue loader only returns priced models.
      const cheapest = [...models].sort(
        (a, b) => (a.estimatedCentsPerUnit ?? 0) - (b.estimatedCentsPerUnit ?? 0),
      )[0];
      if (cheapest) viable.push({ provider, model: cheapest });
    }

    if (viable.length === 0) return this.fallback(request, rejected);

    // A workspace preference outranks price. Someone who pinned a provider did
    // so for a reason the router cannot see — an existing contract, a quality
    // judgement — and overriding it to save two cents would be presumptuous.
    const preferred = request.preferredProviderId
      ? viable.find((candidate) => candidate.provider.id === request.preferredProviderId)
      : undefined;

    const chosen =
      preferred ??
      [...viable].sort(
        (a, b) => (a.model.estimatedCentsPerUnit ?? 0) - (b.model.estimatedCentsPerUnit ?? 0),
      )[0];

    if (!chosen) return this.fallback(request, rejected);

    for (const candidate of viable) {
      if (candidate !== chosen) {
        rejected.push({
          providerId: candidate.provider.id,
          reason: `${candidate.model.name} could serve this at ${candidate.model.estimatedCentsPerUnit}c, which is not the best available.`,
        });
      }
    }

    return {
      ok: true,
      provider: chosen.provider,
      model: chosen.model,
      reason: preferred
        ? `${chosen.provider.label} is the workspace's preferred provider; ${chosen.model.name} is its cheapest ${request.mode} model that fits.`
        : `${chosen.model.name} on ${chosen.provider.label} is the cheapest enabled model that supports ${describe(request)}.`,
      isMock: false,
      rejected,
    };
  }

  /**
   * The reason a provider cannot serve a request, or null if it can.
   *
   * Shared by both entry points so the two can never disagree about why a
   * provider was skipped — a divergence there would make the synchronous
   * estimate and the asynchronous submission quote different providers for the
   * same request, and the user would be charged against the wrong estimate.
   */
  private reasonToSkip(
    provider: CreativeGenerationProvider,
    request: RouteRequest,
  ): string | null {
    if (!provider.isConfigured()) {
      // Names the variable, so an operator reading this is told what to set
      // rather than only that something is missing.
      return `Provider configuration required — ${provider.credentialEnvVar} is not set.`;
    }
    const decision = provider.supports(request);
    return decision.supported ? null : decision.reason;
  }

  private fallback(
    request: RouteRequest,
    rejected: readonly { providerId: string; reason: string }[],
  ): RouteDecision {
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
        model: null,
      };
    }

    return {
      ok: false,
      reason:
        rejected.length === 0
          ? `Provider configuration required. Set ${this.candidates.map((p) => p.credentialEnvVar).join(" or ")} to enable generation.`
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

  /**
   * Models a workspace can currently choose from, across every provider.
   *
   * The model picker reads this. Unconfigured providers are excluded rather
   * than shown greyed out: a model the user cannot run is not a choice, and
   * offering it produces a failure at submit time instead of at selection time.
   */
  async availableModels(
    capability?: GenerationCapability,
    mode?: ProductionMode,
  ): Promise<readonly GenerationModel[]> {
    const configured = new Set(
      this.candidates.filter((provider) => provider.isConfigured()).map((provider) => provider.id),
    );
    const models = await listCatalogModels({ capability, mode });
    return models.filter((model) => configured.has(model.providerId));
  }
}

function describe(request: RouteRequest): string {
  const bits: string[] = [request.capability ?? `${request.mode} ${request.kind}`];
  if (request.capability) bits.push(`in ${request.mode} mode`);
  if (request.ratio) bits.push(`at ${request.ratio}`);
  if (request.durationSeconds !== undefined) bits.push(`for ${request.durationSeconds}s`);
  return bits.join(" ");
}

/**
 * Process-wide router.
 *
 * Providers are stateless, so one instance is enough. Not a module-level
 * constant: constructing the adapters reads no environment at construction
 * time, but keeping this lazy means a test can reset it.
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
  options: {
    ratio?: AspectRatio;
    durationSeconds?: number;
    capability?: GenerationCapability;
    allowMockFallback?: boolean;
  } = {},
): RouteDecision {
  return getProviderRouter().route({
    kind,
    mode,
    ratio: options.ratio,
    durationSeconds: options.durationSeconds,
    capability: options.capability,
    allowMockFallback: options.allowMockFallback ?? true,
  });
}
