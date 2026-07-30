"use client";

import { useActionState } from "react";
import { Button } from "@/components/primitives/Button";
import { requestPasswordReset } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { authCopy } from "@/content/auth";
import { AuthMessage } from "./AuthMessage";
import { EmailField } from "./EmailField";

/**
 * Password reset request.
 *
 * The success message is intentionally conditional in wording — "if an account
 * exists" — because the action cannot report whether it does without turning
 * this form into an account-existence oracle.
 */
export function ForgotPasswordForm({
  authAvailable,
}: {
  authAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    INITIAL_AUTH_STATE,
  );

  if (state.status === "success") {
    return <AuthMessage tone="success" title="LINK SENT" body={state.message} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.status === "error" && !state.field && (
        <AuthMessage tone="error" body={state.error.message} />
      )}

      <EmailField
        error={state.status === "error" && state.field === "email" ? state.error.message : undefined}
        hint="The address on the account. We do not disclose whether an account exists."
        autoFocus
      />

      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={pending}
        loadingLabel="Sending link"
        disabled={!authAvailable}
      >
        {authCopy.forgotPassword.submit}
      </Button>
    </form>
  );
}
