import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  generationModelVersions,
  generationModels,
  generationProviders,
  planEntitlements,
  productionModes,
  providerRateLimits,
  subscriptionPlans,
  topUpPackages,
} from "@/lib/db/schema";
import { kindForCapability, type GenerationModel } from "./capabilities";
import { modelToRow } from "./catalog";
import { MAGNIFIC_MODELS_NORMALISED } from "./magnific/catalog";
import { MUAPI_MODELS } from "./muapi/catalog";
import { PRODUCTION_MODE_DEFAULTS } from "./modes";
import { PLAN_DEFAULTS, TOP_UP_DEFAULTS } from "./plans";
import { CREATIVE_ENV } from "./env";

/**
 * Seeds the configuration tables from the in-code defaults.
 *
 * Idempotent and non-destructive: every write is an upsert that updates only
 * the columns describing WHAT a thing is (label, endpoint, entitlement value),
 * never the columns an operator may have deliberately changed. Specifically,
 * `enabled` and `available` are set on insert and left alone on conflict — an
 * operator who disabled a model during an incident must not have it silently
 * re-enabled by the next deploy's seed run.
 *
 * Prices ARE updated on conflict. They are business defaults that ship with the
 * code; an operator overriding one should do it in `cost_configuration`, which
 * this never touches.
 */

export type SeedReport = {
  providers: number;
  rateLimits: number;
  models: number;
  modelVersions: number;
  productionModes: number;
  plans: number;
  entitlements: number;
  topUps: number;
};

/**
 * The output kind a model produces.
 *
 * Taken from the model's FIRST capability rather than from a stored field,
 * because every capability maps to exactly one kind and a model whose
 * capabilities disagreed about their output kind would be a catalogue error
 * worth failing on rather than papering over.
 */
function kindFor(model: GenerationModel) {
  const first = model.capabilities[0];
  if (!first) {
    throw new Error(`Catalogue model ${model.id} declares no capability.`);
  }
  return kindForCapability(first);
}

export async function seedCreativeConfiguration(): Promise<SeedReport> {
  const report: SeedReport = {
    providers: 0,
    rateLimits: 0,
    models: 0,
    modelVersions: 0,
    productionModes: 0,
    plans: 0,
    entitlements: 0,
    topUps: 0,
  };

  await db.transaction(async (tx) => {
    // --- Providers --------------------------------------------------------
    //
    // Rate limits are Virally's own outbound pacing, not claims about either
    // vendor's published limit — neither publishes a number, so inventing one
    // here would be fabrication dressed as configuration.
    const providers = await tx
      .insert(generationProviders)
      .values([
        {
          id: "magnific",
          label: "Magnific",
          credentialEnvVar: CREATIVE_ENV.magnificApiKey,
          rateLimitPerMinute: 60,
          docsUrl: "https://docs.magnific.com",
        },
        {
          id: "muapi",
          label: "MuAPI",
          credentialEnvVar: CREATIVE_ENV.muapiApiKey,
          rateLimitPerMinute: 60,
          docsUrl: "https://muapi.ai/docs",
        },
        {
          /**
           * The mock is a provider row, not just a code path.
           *
           * `provider_runs.provider_id` carries a foreign key to this table, so
           * without this row a mock generation cannot be persisted at all — the
           * insert fails on the constraint and the credential-free development
           * path, which the brief requires to work, dies at the first submit.
           *
           * Its credential variable is deliberately empty: there is nothing to
           * set, and naming a variable here would send an operator looking for
           * one that does not exist.
           */
          id: "mock",
          label: "Deterministic mock",
          credentialEnvVar: "",
          // Not throttled. It makes no external call and costs nothing, so a
          // limit would only slow down local development.
          rateLimitPerMinute: 6_000,
          docsUrl: null,
        },
      ])
      .onConflictDoUpdate({
        target: generationProviders.id,
        set: {
          label: excluded(generationProviders.label),
          credentialEnvVar: excluded(generationProviders.credentialEnvVar),
          docsUrl: excluded(generationProviders.docsUrl),
          updatedAt: new Date(),
        },
      })
      .returning({ id: generationProviders.id });
    report.providers = providers.length;

    // --- Rate limits ------------------------------------------------------
    //
    // Per capability rather than one figure per provider, because vendors meter
    // video far more tightly than images: a ceiling low enough to keep video
    // inside quota needlessly throttles image generation, and one high enough
    // for images gets video 429ed.
    const limits = await tx
      .insert(providerRateLimits)
      .values(
        ["magnific", "muapi"].flatMap((providerId) => [
          {
            providerId,
            capability: null,
            requestsPerMinute: 60,
            maxConcurrent: 8,
            maxConcurrentPerWorkspace: 3,
          },
          {
            providerId,
            capability: "text-to-video",
            requestsPerMinute: 10,
            maxConcurrent: 4,
            maxConcurrentPerWorkspace: 2,
          },
          {
            providerId,
            capability: "image-to-video",
            requestsPerMinute: 10,
            maxConcurrent: 4,
            maxConcurrentPerWorkspace: 2,
          },
          {
            providerId,
            capability: "lip-sync",
            requestsPerMinute: 6,
            maxConcurrent: 2,
            maxConcurrentPerWorkspace: 1,
          },
        ]),
      )
      // Two partial unique indexes cover this table, and `onConflictDoNothing`
      // without a target honours both. An operator's tuned limit is never
      // overwritten by a deploy — unlike a price, a rate limit is something they
      // changed because of something they observed in production.
      .onConflictDoNothing()
      .returning({ id: providerRateLimits.id });
    report.rateLimits = limits.length;

    // --- Models -----------------------------------------------------------
    //
    // Seeded from the normalized catalogues so the table and the shipped arrays
    // describe models identically. `modelToRow` is the single mapping both this
    // and the runtime fallback go through, which is what keeps a seeded row and
    // a fallback row from differing in a field nobody thought to check.
    const catalogue = [...MAGNIFIC_MODELS_NORMALISED, ...MUAPI_MODELS];
    const models = await tx
      .insert(generationModels)
      .values(catalogue.map((model) => modelToRow(model, kindFor(model))))
      .onConflictDoUpdate({
        target: generationModels.id,
        set: {
          // `enabled` and `deprecated_at` are deliberately absent: an operator
          // who disabled a model during an incident must not have it re-enabled
          // by a deploy, and a model the provider retired must stay retired.
          label: excluded(generationModels.label),
          description: excluded(generationModels.description),
          externalModelId: excluded(generationModels.externalModelId),
          endpointPath: excluded(generationModels.endpointPath),
          capabilities: excluded(generationModels.capabilities),
          inputTypes: excluded(generationModels.inputTypes),
          maxReferenceImages: excluded(generationModels.maxReferenceImages),
          allowedDurations: excluded(generationModels.allowedDurations),
          supportedRatios: excluded(generationModels.supportedRatios),
          supportedResolutions: excluded(generationModels.supportedResolutions),
          supportsNegativePrompt: excluded(generationModels.supportsNegativePrompt),
          supportsSeed: excluded(generationModels.supportsSeed),
          supportsAudio: excluded(generationModels.supportsAudio),
          estimatedCentsPerUnit: excluded(generationModels.estimatedCentsPerUnit),
          modes: excluded(generationModels.modes),
          metadata: excluded(generationModels.metadata),
          updatedAt: new Date(),
        },
      })
      .returning({ id: generationModels.id });
    report.models = models.length;

    // --- Model versions ---------------------------------------------------
    //
    // A snapshot per CHANGE, not per seed run. Written inside the same
    // transaction as the model upsert, because a snapshot that does not match
    // the row it claims to describe is worse than no snapshot at all.
    //
    // Change-detected rather than unconditional: seeding runs on every deploy,
    // and an unconditional insert would bury the two or three real repricings a
    // year under hundreds of identical rows — which would make the table
    // useless for the one question it exists to answer.
    const existing = await tx
      .select({
        modelId: generationModelVersions.modelId,
        version: generationModelVersions.version,
        cents: generationModelVersions.estimatedCentsPerUnit,
        externalModelId: generationModelVersions.externalModelId,
      })
      .from(generationModelVersions);

    const latest = new Map<string, { version: number; cents: number | null; external: string }>();
    for (const row of existing) {
      const current = latest.get(row.modelId);
      if (!current || row.version > current.version) {
        latest.set(row.modelId, {
          version: row.version,
          cents: row.cents,
          external: row.externalModelId,
        });
      }
    }

    const newVersions = catalogue
      .map((model) => {
        const cents = model.estimatedCentsPerUnit ?? null;
        const previous = latest.get(model.id);
        if (
          previous &&
          previous.cents === cents &&
          previous.external === model.externalModelId
        ) {
          return null;
        }
        return {
          modelId: model.id,
          version: (previous?.version ?? 0) + 1,
          snapshot: modelToRow(model, kindFor(model)) as Record<string, unknown>,
          estimatedCentsPerUnit: cents,
          externalModelId: model.externalModelId,
          changeReason: previous ? ("repriced" as const) : ("seeded" as const),
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    if (newVersions.length > 0) {
      await tx.insert(generationModelVersions).values(newVersions).onConflictDoNothing();
    }
    report.modelVersions = newVersions.length;

    // --- Production modes -------------------------------------------------
    const modes = await tx
      .insert(productionModes)
      .values(
        PRODUCTION_MODE_DEFAULTS.map((definition) => ({
          id: definition.id,
          label: definition.label,
          description: definition.description,
          position: definition.position,
          productionCredits: definition.productionCredits,
          targetCostCentsLow: definition.targetCostCentsLow,
          targetCostCentsHigh: definition.targetCostCentsHigh,
          aiVideoClipsMin: definition.aiVideoClipsMin,
          aiVideoClipsMax: definition.aiVideoClipsMax,
          generatedImagesTypical: definition.generatedImagesTypical,
          regenerationAllowance: definition.regenerationAllowance,
        })),
      )
      .onConflictDoUpdate({
        target: productionModes.id,
        set: {
          label: excluded(productionModes.label),
          description: excluded(productionModes.description),
          position: excluded(productionModes.position),
          productionCredits: excluded(productionModes.productionCredits),
          targetCostCentsLow: excluded(productionModes.targetCostCentsLow),
          targetCostCentsHigh: excluded(productionModes.targetCostCentsHigh),
          aiVideoClipsMin: excluded(productionModes.aiVideoClipsMin),
          aiVideoClipsMax: excluded(productionModes.aiVideoClipsMax),
          generatedImagesTypical: excluded(productionModes.generatedImagesTypical),
          regenerationAllowance: excluded(productionModes.regenerationAllowance),
          updatedAt: new Date(),
        },
      })
      .returning({ id: productionModes.id });
    report.productionModes = modes.length;

    // --- Plans and entitlements -------------------------------------------
    const plans = await tx
      .insert(subscriptionPlans)
      .values(
        PLAN_DEFAULTS.map((plan) => ({
          code: plan.code,
          label: plan.label,
          description: plan.description,
          position: plan.position,
          priceCents: plan.priceCents,
          includedCredits: plan.includedCredits,
          emphasised: plan.emphasised,
          requiresContact: plan.requiresContact,
        })),
      )
      .onConflictDoUpdate({
        target: subscriptionPlans.code,
        set: {
          label: excluded(subscriptionPlans.label),
          description: excluded(subscriptionPlans.description),
          position: excluded(subscriptionPlans.position),
          priceCents: excluded(subscriptionPlans.priceCents),
          includedCredits: excluded(subscriptionPlans.includedCredits),
          emphasised: excluded(subscriptionPlans.emphasised),
          requiresContact: excluded(subscriptionPlans.requiresContact),
          updatedAt: new Date(),
        },
      })
      .returning({ code: subscriptionPlans.code });
    report.plans = plans.length;

    const entitlementRows = PLAN_DEFAULTS.flatMap((plan) =>
      plan.entitlements.map((entitlement) => ({
        planCode: plan.code,
        key: entitlement.key,
        limitValue: entitlement.limitValue,
        enabled: entitlement.enabled,
      })),
    );
    const entitlements = await tx
      .insert(planEntitlements)
      .values(entitlementRows)
      .onConflictDoUpdate({
        target: [planEntitlements.planCode, planEntitlements.key],
        set: {
          limitValue: excluded(planEntitlements.limitValue),
          enabled: excluded(planEntitlements.enabled),
        },
      })
      .returning({ id: planEntitlements.id });
    report.entitlements = entitlements.length;

    // --- Top-ups ----------------------------------------------------------
    const topUps = await tx
      .insert(topUpPackages)
      .values(
        TOP_UP_DEFAULTS.map((topUp) => ({
          code: topUp.code,
          label: topUp.label,
          credits: topUp.credits,
          priceCents: topUp.priceCents,
          position: topUp.position,
        })),
      )
      .onConflictDoUpdate({
        target: topUpPackages.code,
        set: {
          label: excluded(topUpPackages.label),
          credits: excluded(topUpPackages.credits),
          priceCents: excluded(topUpPackages.priceCents),
          position: excluded(topUpPackages.position),
          updatedAt: new Date(),
        },
      })
      .returning({ code: topUpPackages.code });
    report.topUps = topUps.length;
  });

  return report;
}

/**
 * References the row Postgres was about to insert, inside an ON CONFLICT DO
 * UPDATE.
 *
 * Written as `excluded."column"` rather than repeating the literal, so a value
 * cannot be updated to something different from what the insert carried — the
 * two would drift the moment one list is edited and the other is not.
 */
function excluded(column: AnyPgColumn) {
  return sql.raw(`excluded."${column.name}"`);
}
