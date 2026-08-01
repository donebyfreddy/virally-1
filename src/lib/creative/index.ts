/**
 * Creative generation — public surface.
 *
 * Scope is media only: image, video, audio. Language generation (briefs,
 * concepts, scripts, storyboards) lives behind `LanguageProvider` in
 * src/lib/ai/ and is a different problem — synchronous, cheap, and producing
 * text the user edits rather than binaries the system must download, store,
 * bill for and validate.
 *
 * Note what is NOT re-exported: `magnificApiKey` and `magnificWebhookSecret`.
 * Credentials are reachable only by importing src/lib/creative/env.ts directly,
 * which keeps a secret from arriving at a call site by autocomplete. Callers
 * that need to know whether generation is possible use `describeCreativeEnv()`
 * or `isMagnificConfigured()`.
 */

export type {
  AudioGenerationInput,
  AudioKind,
  CostEstimate,
  CreativeGenerationProvider,
  GenerationFailure,
  GenerationInputBase,
  GenerationKind,
  GenerationQuality,
  GenerationTask,
  GenerationTaskState,
  GenerationTaskStatus,
  ImageGenerationInput,
  ProductionMode,
  ProviderMediaRef,
  SupportDecision,
  SupportsQuery,
  VideoGenerationInput,
} from "./types";

export type { ProviderRunState } from "./types";

export {
  ProviderNotConfiguredError,
  ProviderUnsupportedError,
  TERMINAL_RUN_STATES,
  TERMINAL_TASK_STATES,
  isTerminalRunState,
  isTerminalState,
  originFor,
} from "./types";

export {
  GENERATION_CAPABILITIES,
  CONSENT_GATED_CAPABILITIES,
  capabilitiesForKind,
  checkModelFit,
  isGenerationCapability,
  isRoutable,
  kindForCapability,
  quantiseDuration,
  requiredInputsFor,
  requiresConsent,
  supportsCapability,
} from "./capabilities";
export type {
  GenerationCapability,
  GenerationInputType,
  GenerationModel,
} from "./capabilities";

export {
  findModel,
  findModelForDisplay,
  invalidateCatalogCache,
  listModels,
  loadCatalog,
  seedCatalog,
} from "./catalog";

export {
  CENTS_PER_PRODUCTION_CREDIT,
  DEFAULT_PRODUCTION_MODE,
  PRODUCTION_MODE_DEFAULTS,
  centsToCredits,
  productionModeDefault,
} from "./modes";
export type { ProductionModeDefinition } from "./modes";

export { ProviderRouter, getProviderRouter, routeFor } from "./router";
export type { RouteDecision, RouteRequest } from "./router";

export { MockCreativeProvider, DEMO_OUTPUT_LABEL, DEMO_OUTPUT_EXPLANATION } from "./mock";
export { MagnificProvider } from "./magnific/provider";
export { MuApiProvider } from "./muapi/provider";

export {
  describeCreativeEnv,
  describeProviderEnv,
  isAnyProviderConfigured,
  isMagnificConfigured,
  isMagnificWebhookConfigured,
  isMuApiConfigured,
} from "./env";
export type { CreativeEnvStatus, ProviderEnvStatus } from "./env";

export { tenantScope } from "./scope";
export type { TenantScope } from "./scope";
