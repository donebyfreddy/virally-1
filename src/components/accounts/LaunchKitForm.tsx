"use client";

import { useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Field, Textarea } from "@/components/primitives/Field";
import { Input } from "@/components/primitives/Input";
import { SegmentedControl } from "@/components/primitives/SegmentedControl";
import { PLATFORM_LABELS, launchPage } from "@/content/accounts";
import { prepareLaunchKit } from "@/lib/accounts/actions";
import type { Platform } from "@/types/database";

const PLATFORMS = Object.keys(PLATFORM_LABELS) as Platform[];

/**
 * LAUNCH KIT FORM.
 *
 * Client component for one reason only: the platform choice is a SegmentedControl,
 * which owns roving-tabindex keyboard state. Everything else is uncontrolled and the
 * submission is a server action, so there is no client-side validation mirror to
 * drift from the server's.
 *
 * `loading` is driven by a plain submit flag rather than useFormStatus so the button
 * stays focusable while the action runs — Button renders `aria-disabled` and guards
 * the click instead of setting `disabled`, which would drop focus mid-submit.
 *
 * Every field carries a real label and a persistent hint. No instruction lives only
 * in a placeholder.
 */
export function LaunchKitForm({
  brands,
  defaultBrandId,
  defaultLanguage,
}: {
  brands: readonly { id: string; name: string }[];
  defaultBrandId: string | null;
  defaultLanguage: string;
}) {
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form action={prepareLaunchKit} onSubmit={() => setSubmitting(true)} className="mt-8">
      {/* The control is the source of truth for the visible choice; this carries it
          in the form body so the server does not depend on the control's internals. */}
      <input type="hidden" name="platform" value={platform} />

      <fieldset className="border-0 p-0">
        <legend className="font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)] text-[color:var(--color-text-secondary)]">
          {launchPage.fields.platform.label}
        </legend>
        <p
          id="platform-hint"
          className="mt-2 text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]"
        >
          {launchPage.fields.platform.hint}
        </p>
        <div className="mt-3">
          <SegmentedControl
            label={launchPage.fields.platform.label}
            value={platform}
            onChange={setPlatform}
            segments={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
          />
        </div>
      </fieldset>

      <div className="mt-8 flex flex-col gap-6">
        <Field label={launchPage.fields.niche.label} hint={launchPage.fields.niche.hint}>
          {({ inputId, describedBy }) => (
            <Textarea
              id={inputId}
              name="niche"
              rows={3}
              required
              maxLength={200}
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Field label={launchPage.fields.displayLabel.label} hint={launchPage.fields.displayLabel.hint}>
            {({ inputId, describedBy }) => (
              <Input id={inputId} name="displayLabel" maxLength={120} aria-describedby={describedBy} />
            )}
          </Field>

          <Field label={launchPage.fields.language.label} hint={launchPage.fields.language.hint}>
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                name="language"
                defaultValue={defaultLanguage}
                maxLength={20}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={launchPage.fields.region.label} hint={launchPage.fields.region.hint}>
            {({ inputId, describedBy }) => (
              <Input id={inputId} name="region" maxLength={80} aria-describedby={describedBy} />
            )}
          </Field>

          <Field
            label={launchPage.fields.postingFrequency.label}
            hint={launchPage.fields.postingFrequency.hint}
          >
            {({ inputId, describedBy }) => (
              <Input
                id={inputId}
                name="postingFrequency"
                maxLength={80}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label={launchPage.fields.audience.label} hint={launchPage.fields.audience.hint}>
            {({ inputId, describedBy }) => (
              <Input id={inputId} name="audience" maxLength={400} aria-describedby={describedBy} />
            )}
          </Field>

          <Field label={launchPage.fields.objective.label} hint={launchPage.fields.objective.hint}>
            {({ inputId, describedBy }) => (
              <Input id={inputId} name="objective" maxLength={400} aria-describedby={describedBy} />
            )}
          </Field>

          <Field
            label={launchPage.fields.contentStyle.label}
            hint={launchPage.fields.contentStyle.hint}
          >
            {({ inputId, describedBy }) => (
              <Input id={inputId} name="contentStyle" maxLength={200} aria-describedby={describedBy} />
            )}
          </Field>

          {brands.length > 0 ? (
            <Field label="Brand" hint="Which brand this account belongs to.">
              {({ inputId, describedBy }) => (
                <select
                  id={inputId}
                  name="brandId"
                  defaultValue={defaultBrandId ?? ""}
                  aria-describedby={describedBy}
                  className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 text-[length:var(--text-body-s)] text-[color:var(--color-text-primary)] hover:border-[var(--color-border-strong)]"
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" size="lg" loading={submitting} loadingLabel={launchPage.submitting}>
          {launchPage.submit}
        </Button>
      </div>
    </form>
  );
}
