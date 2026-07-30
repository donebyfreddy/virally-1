"use client";

import { useActionState } from "react";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Field } from "@/components/primitives/Field";
import { resendConfirmation } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { AuthMessage } from "./AuthMessage";

/**
 * Re-sends a signup confirmation email.
 *
 * Always its own `<form>` with its own action state, and always rendered
 * *after* the form it supplements — never inside it. Two reasons: nested forms
 * are invalid HTML, and retargeting the parent form with `formAction` would post
 * the user's password to an action that has no business receiving it.
 */
export function ResendConfirmation({
  label = "Email to resend the confirmation to",
  hint = "Correct a typo here if the address was wrong.",
}: {
  label?: string;
  hint?: string;
}) {
  const [state, formAction, pending] = useActionState(
    resendConfirmation,
    INITIAL_AUTH_STATE,
  );

  if (state.status === "success") {
    return <AuthMessage tone="success" body={state.message} />;
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-[var(--radius-sm)] border border-[var(--color-border-hairline)] bg-[var(--color-surface-1)] p-4"
      noValidate
    >
      <Field
        label={label}
        hint={hint}
        error={state.status === "error" ? state.error.message : undefined}
      >
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
            aria-describedby={describedBy}
            invalid={state.status === "error"}
          />
        )}
      </Field>
      <Button
        type="submit"
        variant="secondary"
        loading={pending}
        loadingLabel="Sending"
        className="w-fit"
      >
        Resend confirmation email
      </Button>
    </form>
  );
}
