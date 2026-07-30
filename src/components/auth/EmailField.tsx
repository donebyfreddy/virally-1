"use client";

import { Field } from "@/components/primitives/Field";
import { Input } from "@/components/primitives/Input";
import { authFields } from "@/content/auth";

/**
 * Email input.
 *
 * `defaultValue` rather than controlled state: server actions re-render the form
 * on failure, and this is what preserves what the user typed. `autoComplete`
 * and `inputMode` matter more here than anywhere — a mistyped address on sign-up
 * means a confirmation email that never arrives and no way to tell.
 */
export function EmailField({
  error,
  defaultValue,
  hint = authFields.email.hint,
  autoFocus = false,
}: {
  error?: string;
  defaultValue?: string;
  hint?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field label={authFields.email.label} hint={hint} error={error}>
      {({ inputId, describedBy }) => (
        <Input
          id={inputId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          // Autofocus is deliberate and narrow: the email field is the single
          // purpose of these pages, so focusing it saves a tab stop and steals
          // focus from nothing. It is never enabled on a page with other content
          // above it.
          autoFocus={autoFocus}
          placeholder={authFields.email.placeholder}
          defaultValue={defaultValue}
          invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      )}
    </Field>
  );
}
