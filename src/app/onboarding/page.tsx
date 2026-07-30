import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/primitives/Button";
import { Field, Textarea } from "@/components/primitives/Field";
import { Input } from "@/components/primitives/Input";
import { AuthMessage } from "@/components/auth/AuthMessage";
import {
  OnboardingChrome,
  OptionTile,
  StepActions,
} from "@/components/onboarding/OnboardingChrome";
import {
  ACCOUNT_TYPES,
  CONTENT_GOALS,
  FORMATS,
  PLATFORMS_TO_CONNECT,
  onboardingCopy,
} from "@/content/onboarding";
import {
  completeOnboarding,
  saveAccountType,
  saveBrand,
  saveFormats,
  saveGoals,
  skipAccounts,
} from "@/lib/onboarding/actions";
import { and, eq } from "drizzle-orm";
import { readSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { onboardingProgress } from "@/lib/db/schema.fragment";
import { resolveTenantContext } from "@/lib/tenant/context";
import { signInPathFor } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Set up your workspace",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Onboarding, as a single route driven by `?step=`.
 *
 * One route rather than six nested ones: the steps share a frame, a tenant lookup
 * and a progress rail, and every step transition is a server action redirect. Six
 * routes would duplicate the guard in each and make "resume where you left off" a
 * cross-route concern.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readSession();
  if (session.status === "unconfigured") redirect("/app");
  if (session.status === "anonymous") redirect(signInPathFor("/onboarding"));

  const resolution = await resolveTenantContext(session.user);
  if (resolution.status !== "ok") redirect("/app");

  const { context } = resolution;
  // Already finished: nothing here to do, and re-running it would reset progress.
  if (context.onboardingComplete) redirect("/app");

  const [progress] = await db
    .select({
      currentStep: onboardingProgress.currentStep,
      accountType: onboardingProgress.accountType,
      contentGoals: onboardingProgress.contentGoals,
      preferredFormats: onboardingProgress.preferredFormats,
      firstCampaignPrompt: onboardingProgress.firstCampaignPrompt,
    })
    .from(onboardingProgress)
    .where(
      and(
        eq(onboardingProgress.organizationId, context.organizationId),
        eq(onboardingProgress.userId, context.user.id),
      ),
    )
    .limit(1);

  const params = await searchParams;
  const requested = Number(Array.isArray(params.step) ? params.step[0] : params.step);
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;

  // Clamp to the real range, and default to whatever the database says the user
  // reached — a hand-typed `?step=99` must not render a blank frame.
  const step = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 6)
    : (progress?.currentStep ?? 1);

  const brand = context.brands.find((candidate) => candidate.id === context.brandId);

  return (
    <>
      {step === 1 && (
        <OnboardingChrome step={1} heading={onboardingCopy.welcome.heading} body={onboardingCopy.welcome.body}>
          {errorCode === "account_type" && (
            <div className="mb-6 max-w-[46rem]">
              <AuthMessage tone="error" body="Choose one option to continue." />
            </div>
          )}
          <form action={saveAccountType}>
            <fieldset>
              <legend className="sr-only">{onboardingCopy.welcome.heading}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:max-w-[52rem]">
                {ACCOUNT_TYPES.map((option) => (
                  <OptionTile
                    key={option.id}
                    type="radio"
                    name="accountType"
                    value={option.id}
                    label={option.label}
                    detail={option.detail}
                    defaultChecked={(progress?.accountType ?? "personal") === option.id}
                  />
                ))}
              </div>
            </fieldset>
            <StepActions submitLabel={onboardingCopy.nav.next} />
          </form>
        </OnboardingChrome>
      )}

      {step === 2 && (
        <OnboardingChrome step={2} heading={onboardingCopy.brand.heading} body={onboardingCopy.brand.body}>
          {errorCode === "name" && (
            <div className="mb-6 max-w-[46rem]">
              <AuthMessage tone="error" body="A brand name is required — everything else is optional." />
            </div>
          )}
          <form action={saveBrand} className="grid max-w-[46rem] gap-6 sm:grid-cols-2">
            <Field label={onboardingCopy.brand.fields.name.label} hint={onboardingCopy.brand.fields.name.hint} className="sm:col-span-2">
              {({ inputId, describedBy }) => (
                <Input
                  id={inputId}
                  name="name"
                  required
                  maxLength={120}
                  aria-describedby={describedBy}
                  // The placeholder brand is named after the user at bootstrap, so
                  // pre-filling it would look like a real answer. Only a brand the
                  // user has already named is offered back.
                  defaultValue={brand && !brand.isPlaceholder ? brand.name : ""}
                />
              )}
            </Field>

            <Field label={onboardingCopy.brand.fields.website.label} hint={onboardingCopy.brand.fields.website.hint}>
              {({ inputId, describedBy }) => (
                <Input id={inputId} name="website" type="url" inputMode="url" placeholder="example.com" aria-describedby={describedBy} />
              )}
            </Field>

            <Field label={onboardingCopy.brand.fields.industry.label} hint={onboardingCopy.brand.fields.industry.hint}>
              {({ inputId, describedBy }) => (
                <Input id={inputId} name="industry" aria-describedby={describedBy} />
              )}
            </Field>

            <Field label={onboardingCopy.brand.fields.description.label} hint={onboardingCopy.brand.fields.description.hint} className="sm:col-span-2">
              {({ inputId, describedBy }) => (
                <Textarea id={inputId} name="description" rows={3} aria-describedby={describedBy} />
              )}
            </Field>

            <Field label={onboardingCopy.brand.fields.language.label} hint={onboardingCopy.brand.fields.language.hint}>
              {({ inputId, describedBy }) => (
                <Input id={inputId} name="language" defaultValue="en" maxLength={12} aria-describedby={describedBy} />
              )}
            </Field>

            <Field label={onboardingCopy.brand.fields.audience.label} hint={onboardingCopy.brand.fields.audience.hint}>
              {({ inputId, describedBy }) => (
                <Input id={inputId} name="audience" aria-describedby={describedBy} />
              )}
            </Field>

            <Field label={onboardingCopy.brand.fields.tone.label} hint={onboardingCopy.brand.fields.tone.hint}>
              {({ inputId, describedBy }) => (
                <Input id={inputId} name="tone" aria-describedby={describedBy} />
              )}
            </Field>

            <Field label={onboardingCopy.brand.fields.objective.label} hint={onboardingCopy.brand.fields.objective.hint}>
              {({ inputId, describedBy }) => (
                <Input id={inputId} name="objective" aria-describedby={describedBy} />
              )}
            </Field>

            <div className="sm:col-span-2">
              <StepActions submitLabel={onboardingCopy.nav.next} />
            </div>
          </form>
        </OnboardingChrome>
      )}

      {step === 3 && (
        <OnboardingChrome step={3} heading={onboardingCopy.goals.heading} body={onboardingCopy.goals.body}>
          <form action={saveGoals}>
            <fieldset>
              <legend className="sr-only">{onboardingCopy.goals.heading}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:max-w-[52rem]">
                {CONTENT_GOALS.map((option) => (
                  <OptionTile
                    key={option.id}
                    type="checkbox"
                    name="goals"
                    value={option.id}
                    label={option.label}
                    detail={option.detail}
                    defaultChecked={progress?.contentGoals?.includes(option.id) ?? false}
                  />
                ))}
              </div>
            </fieldset>
            <StepActions submitLabel={onboardingCopy.nav.next} />
          </form>
        </OnboardingChrome>
      )}

      {step === 4 && (
        <OnboardingChrome step={4} heading={onboardingCopy.formats.heading} body={onboardingCopy.formats.body}>
          <form action={saveFormats}>
            <fieldset>
              <legend className="sr-only">{onboardingCopy.formats.heading}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:max-w-[64rem]">
                {FORMATS.map((option) => (
                  <OptionTile
                    key={option.id}
                    type="checkbox"
                    name="formats"
                    value={option.id}
                    label={option.label}
                    detail={option.detail}
                    defaultChecked={progress?.preferredFormats?.includes(option.id) ?? false}
                  />
                ))}
              </div>
            </fieldset>
            <StepActions submitLabel={onboardingCopy.nav.next} />
          </form>
        </OnboardingChrome>
      )}

      {step === 5 && (
        <OnboardingChrome step={5} heading={onboardingCopy.accounts.heading} body={onboardingCopy.accounts.body}>
          <div className="max-w-[46rem]">
            {/* No platform credentials exist on this deployment, so every connector
                renders as unavailable with the reason stated. A button that looks
                live and fails would be the dishonest option. */}
            <AuthMessage tone="notice" title="NOT CONFIGURED YET" body={onboardingCopy.accounts.unavailable} />

            <ul className="mt-6 flex flex-col gap-3">
              {PLATFORMS_TO_CONNECT.map((platform) => (
                <li
                  key={platform.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)] p-4"
                >
                  <div>
                    <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)]">
                      {platform.label}
                    </p>
                    <p className="text-[length:var(--text-utility-xs)] text-[color:var(--color-text-muted)]">
                      {platform.note}
                    </p>
                  </div>
                  <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-warning)]">
                    Configuration required
                  </span>
                </li>
              ))}
            </ul>

            <form action={skipAccounts}>
              <StepActions submitLabel={onboardingCopy.accounts.skip} />
            </form>
          </div>
        </OnboardingChrome>
      )}

      {step === 6 && (
        <OnboardingChrome step={6} heading={onboardingCopy.firstCampaign.heading} body={onboardingCopy.firstCampaign.body}>
          <form action={completeOnboarding} className="max-w-[46rem]">
            <Field label={onboardingCopy.firstCampaign.label} hint={onboardingCopy.firstCampaign.hint}>
              {({ inputId, describedBy }) => (
                <Textarea
                  id={inputId}
                  name="prompt"
                  rows={5}
                  maxLength={4000}
                  aria-describedby={describedBy}
                  defaultValue={progress?.firstCampaignPrompt ?? ""}
                />
              )}
            </Field>

            {/* Examples are readable, not clickable. Inserting one would submit words
                the user did not write and skew their first campaign. */}
            <div className="mt-6">
              <p className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
                {onboardingCopy.firstCampaign.examplesLabel}
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {onboardingCopy.firstCampaign.examples.map((example) => (
                  <li
                    key={example}
                    className="border-l-2 border-[var(--color-border-hairline)] pl-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]"
                  >
                    {example}
                  </li>
                ))}
              </ul>
            </div>

            <StepActions
              submitLabel={onboardingCopy.nav.finish}
              secondary={
                <Button type="submit" variant="text" name="prompt" value="">
                  Finish without a brief
                </Button>
              }
            />
          </form>
        </OnboardingChrome>
      )}
    </>
  );
}
