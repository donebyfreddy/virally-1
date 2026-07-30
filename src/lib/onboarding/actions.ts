"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brandProfiles, brands, organizations } from "@/lib/db/schema";
import { onboardingProgress } from "@/lib/db/schema.fragment";
import { readSession } from "@/lib/auth/session";
import { resolveTenantContext, type TenantContext } from "@/lib/tenant/context";
import { ACCOUNT_TYPES, CONTENT_GOALS, FORMATS } from "@/content/onboarding";

/**
 * Onboarding persistence.
 *
 * Each step saves on submit rather than the whole questionnaire saving at the
 * end. A six-step form that loses everything when the tab closes at step
 * five is worse than five short round-trips, and
 * `onboarding_progress.current_step` is what lets the user resume where they
 * stopped.
 *
 * Every option id is validated against the content module's list. These
 * arrive as form fields, so they are user input: without the check, an
 * arbitrary string would be stored and then rendered back as though the
 * product offered it.
 *
 * Every write below is filtered to `context.organizationId` /
 * `context.workspaceId`, which `resolveTenantContext` has already validated
 * as belonging to the signed-in user — there is no RLS to fall back on
 * anymore, so this filter IS the isolation boundary.
 */

export type OnboardingStepState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: string };

const VALID_ACCOUNT_TYPES = new Set(ACCOUNT_TYPES.map((option) => option.id));
const VALID_GOALS = new Set(CONTENT_GOALS.map((option) => option.id));
const VALID_FORMATS = new Set(FORMATS.map((option) => option.id));

/** Resolves the caller's tenant, or bails out to the routes that can explain why. */
async function requireTenant(): Promise<{ context: TenantContext }> {
  const session = await readSession();
  if (session.status !== "authenticated") redirect("/auth/sign-in");

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  return { context: resolution.context };
}

function only<T extends string>(values: readonly string[], allowed: Set<string>): T[] {
  return values.filter((value) => allowed.has(value)) as T[];
}

async function advance(step: number): Promise<never> {
  revalidatePath("/onboarding");
  redirect(`/onboarding?step=${step}`);
}

export async function saveAccountType(formData: FormData): Promise<void> {
  const { context } = await requireTenant();
  const accountType = String(formData.get("accountType") ?? "");

  if (!VALID_ACCOUNT_TYPES.has(accountType)) {
    // Cannot happen through the UI; a rejected value must not silently become null.
    redirect("/onboarding?step=1&error=account_type");
  }

  await db
    .update(onboardingProgress)
    .set({ accountType: accountType as never, currentStep: 2 })
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    );

  // Also the organisation's own type: it drives whether the UI presents
  // itself as single-brand or multi-brand from here on.
  await db
    .update(organizations)
    .set({ accountType: accountType as never })
    .where(eq(organizations.id, context.organizationId));

  await advance(2);
}

export async function saveBrand(formData: FormData): Promise<void> {
  const { context } = await requireTenant();

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0 || name.length > 120) {
    redirect("/onboarding?step=2&error=name");
  }

  const website = String(formData.get("website") ?? "").trim();
  // The column has a `^https?://` check constraint, so a bare domain would be
  // rejected by the database. Normalising here is friendlier than an error
  // about a scheme most users do not think about.
  const normalisedWebsite =
    website === "" ? null : /^https?:\/\//i.test(website) ? website : `https://${website}`;

  if (!context.brandId) {
    redirect("/onboarding?step=2&error=missing_brand");
  }

  await db
    .update(brands)
    .set({
      name,
      websiteUrl: normalisedWebsite,
      description: String(formData.get("description") ?? "").trim() || null,
      industry: String(formData.get("industry") ?? "").trim() || null,
      primaryLanguage: String(formData.get("language") ?? "en").trim() || "en",
      // The bootstrap brand is a placeholder named after the user; naming it
      // makes it real, and the switcher stops flagging it as needing setup.
      isPlaceholder: false,
    })
    .where(and(eq(brands.id, context.brandId), eq(brands.workspaceId, context.workspaceId)));

  await db
    .update(brandProfiles)
    .set({
      targetAudience: String(formData.get("audience") ?? "").trim() || null,
      tone: String(formData.get("tone") ?? "").trim() || null,
      primaryObjective: String(formData.get("objective") ?? "").trim() || null,
    })
    .where(
      and(eq(brandProfiles.brandId, context.brandId), eq(brandProfiles.workspaceId, context.workspaceId)),
    );

  await db
    .update(onboardingProgress)
    .set({ currentStep: 3 })
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    );

  await advance(3);
}

export async function saveGoals(formData: FormData): Promise<void> {
  const { context } = await requireTenant();
  const goals = only(formData.getAll("goals").map(String), VALID_GOALS);

  await db
    .update(onboardingProgress)
    .set({ contentGoals: goals, currentStep: 4 })
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    );

  await advance(4);
}

export async function saveFormats(formData: FormData): Promise<void> {
  const { context } = await requireTenant();
  const formats = only(formData.getAll("formats").map(String), VALID_FORMATS);

  await db
    .update(onboardingProgress)
    .set({ preferredFormats: formats, currentStep: 5 })
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    );

  await advance(5);
}

export async function skipAccounts(): Promise<void> {
  const { context } = await requireTenant();

  await db
    .update(onboardingProgress)
    .set({ currentStep: 6 })
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    );

  await advance(6);
}

/**
 * Final step. Stores the brief and marks onboarding complete.
 *
 * Deliberately does NOT generate anything. Kicking off a generation run as
 * the last act of onboarding would spend credits on a prompt the user has
 * not reviewed, and the brief's safest-default rule says plans come before
 * renders.
 */
export async function completeOnboarding(formData: FormData): Promise<void> {
  const { context } = await requireTenant();
  const prompt = String(formData.get("prompt") ?? "").trim();

  await db
    .update(onboardingProgress)
    .set({
      firstCampaignPrompt: prompt.length > 0 ? prompt.slice(0, 4000) : null,
      currentStep: 6,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    );

  revalidatePath("/app", "layout");
  redirect("/onboarding/complete");
}

/** Escape hatch from any step. Marks onboarding done without discarding answers. */
export async function skipOnboarding(): Promise<void> {
  const { context } = await requireTenant();

  await db
    .update(onboardingProgress)
    .set({ completedAt: new Date(), skippedAt: new Date() })
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    );

  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function goToStep(step: number): Promise<void> {
  const bounded = Math.min(Math.max(Math.trunc(step), 1), 6);
  redirect(`/onboarding?step=${bounded}`);
}
