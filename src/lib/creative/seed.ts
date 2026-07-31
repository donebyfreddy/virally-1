import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  generationModels,
  generationProviders,
  planEntitlements,
  productionModes,
  subscriptionPlans,
  topUpPackages,
} from "@/lib/db/schema";
import { MAGNIFIC_MODELS } from "./magnific/catalog";
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
  models: number;
  productionModes: number;
  plans: number;
  entitlements: number;
  topUps: number;
};

export async function seedCreativeConfiguration(): Promise<SeedReport> {
  const report: SeedReport = {
    providers: 0,
    models: 0,
    productionModes: 0,
    plans: 0,
    entitlements: 0,
    topUps: 0,
  };

  await db.transaction(async (tx) => {
    // --- Providers --------------------------------------------------------
    const providers = await tx
      .insert(generationProviders)
      .values([
        {
          id: "magnific",
          label: "Magnific",
          credentialEnvVar: CREATIVE_ENV.magnificApiKey,
          // Virally's own outbound pacing, not a claim about Magnific's
          // published limit — which is documented as existing but not as a
          // number, so inventing one here would be fabrication.
          rateLimitPerMinute: 60,
          docsUrl: "https://docs.magnific.com",
        },
      ])
      .onConflictDoUpdate({
        target: generationProviders.id,
        set: {
          label: "Magnific",
          credentialEnvVar: CREATIVE_ENV.magnificApiKey,
          docsUrl: "https://docs.magnific.com",
          updatedAt: new Date(),
        },
      })
      .returning({ id: generationProviders.id });
    report.providers = providers.length;

    // --- Models -----------------------------------------------------------
    const models = await tx
      .insert(generationModels)
      .values(
        MAGNIFIC_MODELS.map((model) => ({
          id: model.id,
          providerId: "magnific",
          label: model.label,
          kind: model.kind,
          endpointPath: model.path,
          allowedDurations: [...model.allowedDurations],
          supportedRatios: supportedRatiosFor(model.kind),
          estimatedCentsPerUnit: model.estimatedCentsPerUnit,
          costBasis: "configured_table" as const,
          modes: [...model.modes],
        })),
      )
      .onConflictDoUpdate({
        target: generationModels.id,
        set: {
          // `enabled` is deliberately absent: an operator who disabled a model
          // during an incident must not have it re-enabled by a deploy.
          label: excluded(generationModels.label),
          endpointPath: excluded(generationModels.endpointPath),
          allowedDurations: excluded(generationModels.allowedDurations),
          supportedRatios: excluded(generationModels.supportedRatios),
          estimatedCentsPerUnit: excluded(generationModels.estimatedCentsPerUnit),
          modes: excluded(generationModels.modes),
          updatedAt: new Date(),
        },
      })
      .returning({ id: generationModels.id });
    report.models = models.length;

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

/** Aspect ratios each kind supports, in Virally's vocabulary. */
function supportedRatiosFor(kind: "image" | "video" | "audio"): string[] {
  if (kind === "video") return ["9:16", "1:1", "16:9"];
  if (kind === "image") return ["9:16", "4:5", "1:1", "16:9", "4:3", "3:2"];
  return [];
}
