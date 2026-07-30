"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/primitives/Button";
import { signUpWithPassword } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { authCopy, authFields, passwordSecurityNote } from "@/content/auth";
import { AuthMessage } from "./AuthMessage";
import { EmailField } from "./EmailField";
import { PasswordField } from "./PasswordField";
import { GoogleSignInButton, AuthDivider } from "./GoogleSignInButton";
import { ResendConfirmation } from "./ResendConfirmation";

/**
 * Email + password registration.
 *
 * `useActionState` keeps the submitted values in the DOM across a failed
 * submission and gives `pending` for free, so there is no separate loading
 * boolean that can fall out of sync with the request.
 */
export function SignUpForm({
  next,
  authAvailable,
  googleAvailable,
  googleUnavailableReason,
}: {
  next: string;
  authAvailable: boolean;
  googleAvailable: boolean;
  googleUnavailableReason?: string;
}) {
  const [state, formAction, pending] = useActionState(
    signUpWithPassword,
    INITIAL_AUTH_STATE,
  );

  const fieldError = (field: "email" | "password") =>
    state.status === "error" && state.field === field
      ? state.error.message
      : undefined;

  // A form-level error is one with no specific field to attach to. Rendering it
  // in both places would announce the same sentence twice.
  const formError =
    state.status === "error" && !state.field ? state.error.message : undefined;

  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-6">
        <AuthMessage tone="success" title="CHECK YOUR INBOX" body={state.message} />
        <ResendConfirmation />
        <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
          Already confirmed it?{" "}
          <Link
            href={authCopy.signUp.alternateHref}
            className="inline-flex min-h-11 items-center text-[color:var(--color-action)] underline underline-offset-4"
          >
            {authCopy.signUp.alternateLabel}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <GoogleSignInButton
        next={next}
        available={authAvailable && googleAvailable}
        unavailableReason={googleUnavailableReason}
      />

      <AuthDivider />

      <form action={formAction} className="flex flex-col gap-6" noValidate>
        <input type="hidden" name="next" value={next} />

        {formError && <AuthMessage tone="error" body={formError} />}

        <EmailField error={fieldError("email")} autoFocus />

        <PasswordField
          autoComplete="new-password"
          hint={authFields.password.hintNew}
          error={fieldError("password")}
          showRequirements
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={pending}
          loadingLabel="Creating account"
          disabled={!authAvailable}
        >
          {authCopy.signUp.submit}
        </Button>
      </form>

      {/* The compliance boundary, stated on the surface where a user is most
          likely to assume otherwise. */}
      <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
        {passwordSecurityNote}
      </p>
    </div>
  );
}
