"use client";

import { useActionState, type CSSProperties } from "react";
import { Button } from "@/components/primitives/Button";
import { signInWithGoogle } from "@/lib/auth/actions";
import { INITIAL_AUTH_STATE } from "@/lib/auth/state";
import { googleButton } from "@/content/auth";
import { AuthMessage } from "./AuthMessage";

/**
 * Google OAuth entry point.
 *
 * A form posting to a server action rather than a client-side
 * `signInWithOAuth` call: the PKCE code verifier must be written to an httpOnly
 * cookie, which client JavaScript cannot do. Doing this on the server also means
 * the flow works before hydration.
 *
 * `disabled` when Google OAuth is unconfigured — a button that cannot work
 * must not look like it can.
 */
export function GoogleSignInButton({
  next,
  available,
  unavailableReason,
}: {
  next: string;
  available: boolean;
  /**
   * Why the button is disabled. Required whenever `available` is false: a greyed-out
   * control with no explanation is a dead end, and this one has an actionable fix.
   */
  unavailableReason?: string;
}) {
  const [state, formAction, pending] = useActionState(
    signInWithGoogle,
    INITIAL_AUTH_STATE,
  );

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <input type="hidden" name="next" value={next} />
        <Button
          type="submit"
          variant="secondary"
          size="lg"
          className="w-full"
          loading={pending}
          loadingLabel="Redirecting to Google"
          disabled={!available}
          iconLeading={<GoogleGlyph />}
        >
          {googleButton.label}
        </Button>
      </form>

      <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-muted)]">
        {available ? googleButton.scopeNote : unavailableReason ?? googleButton.scopeNote}
      </p>

      {state.status === "error" && <AuthMessage tone="error" body={state.error.message} />}
    </div>
  );
}

/**
 * Google's mark, inlined.
 *
 * `lucide-react` carries no brand marks, and Google's identity guidelines
 * require the four-colour G reproduced unmodified — so these four values are
 * not ours to tokenise. They are scoped to this one element as local custom
 * properties precisely so they cannot be reused as product colour, which would
 * break the two-accent taxonomy.
 */
const GOOGLE_BRAND_COLOURS = {
  "--google-blue": "rgb(66 133 244)",
  "--google-green": "rgb(52 168 83)",
  "--google-yellow": "rgb(251 188 5)",
  "--google-red": "rgb(234 67 53)",
} as CSSProperties;

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      className="size-4 shrink-0"
      style={GOOGLE_BRAND_COLOURS}
    >
      <path
        fill="var(--google-blue)"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
      />
      <path
        fill="var(--google-green)"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86a5.36 5.36 0 0 1-5.03-3.71H1.05v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="var(--google-yellow)"
        d="M3.97 10.71a5.4 5.4 0 0 1 0-3.42V4.95H1.05a9 9 0 0 0 0 8.1l2.92-2.34Z"
      />
      <path
        fill="var(--google-red)"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.98 8.98 0 0 0 1.05 4.95l2.92 2.34A5.36 5.36 0 0 1 9 3.58Z"
      />
    </svg>
  );
}

/** Zero-radius rule with a centred label. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-4" aria-hidden="true">
      <span className="h-px flex-1 bg-[var(--color-border-hairline)]" />
      <span className="font-utility text-[length:var(--text-utility-xs)] uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--color-text-muted)]">
        {googleButton.divider}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border-hairline)]" />
    </div>
  );
}
