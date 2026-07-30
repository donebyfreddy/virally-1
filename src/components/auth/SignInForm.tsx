"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/primitives/Button";
import { signInWithPassword } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { authCopy, authFields } from "@/content/auth";
import { AuthMessage } from "./AuthMessage";
import { EmailField } from "./EmailField";
import { PasswordField } from "./PasswordField";
import { GoogleSignInButton, AuthDivider } from "./GoogleSignInButton";
import { ResendConfirmation } from "./ResendConfirmation";

export function SignInForm({
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
    signInWithPassword,
    INITIAL_AUTH_STATE,
  );

  const formError = state.status === "error" ? state.error.message : undefined;

  // An unconfirmed address is the one failure the user can resolve from here,
  // so the resend control is offered inline instead of a dead end.
  const needsConfirmation =
    state.status === "error" && state.error.code === "email_not_confirmed";

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

        <EmailField hint={undefined} autoFocus />

        <div className="flex flex-col gap-1">
          <PasswordField
            autoComplete="current-password"
            hint={authFields.password.hintExisting}
          />
          {/* Its own row rather than a label adornment: it is a standalone
              control, so it needs the full 44px target, which a baseline-aligned
              adornment cannot have without breaking the label's line box. */}
          <Link
            href="/auth/forgot-password"
            className={
              "inline-flex min-h-11 w-fit items-center font-utility " +
              "text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-utility)] " +
              "text-[color:var(--color-text-secondary)] underline underline-offset-4 " +
              "transition-colors duration-[var(--dur-instant)] " +
              "hover:text-[color:var(--color-text-primary)] " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
            }
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={pending}
          loadingLabel="Signing in"
          disabled={!authAvailable}
        >
          {authCopy.signIn.submit}
        </Button>
      </form>

      {/* Rendered after the form, not inside it: see ResendConfirmation. */}
      {needsConfirmation && <ResendConfirmation />}
    </div>
  );
}
