"use client";

import { useActionState } from "react";
import { Button } from "@/components/primitives/Button";
import { updatePassword } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { authCopy, authFields } from "@/content/auth";
import { AuthMessage } from "./AuthMessage";
import { PasswordField } from "./PasswordField";

/**
 * Sets a new password using the session created by a recovery link.
 *
 * Requires a confirmation field. A single-field password reset that accepts a
 * typo silently locks the user out of the account they were just recovering.
 */
export function UpdatePasswordForm({
  authAvailable,
  token,
}: {
  authAvailable: boolean;
  token: string;
}) {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    INITIAL_AUTH_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="token" value={token} />

      {state.status === "error" && !state.field && (
        <AuthMessage tone="error" body={state.error.message} />
      )}

      <PasswordField
        name="password"
        label="New password"
        autoComplete="new-password"
        hint={authFields.password.hintNew}
        error={
          state.status === "error" && state.field === "password"
            ? state.error.message
            : undefined
        }
        showRequirements
      />

      <PasswordField
        name="passwordConfirmation"
        label={authFields.passwordConfirmation.label}
        autoComplete="new-password"
        hint={authFields.passwordConfirmation.hint}
      />

      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={pending}
        loadingLabel="Saving password"
        disabled={!authAvailable}
      >
        {authCopy.updatePassword.submit}
      </Button>
    </form>
  );
}
