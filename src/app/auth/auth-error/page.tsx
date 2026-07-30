import type { Metadata } from "next";
import { AuthShell, AuthAlternate } from "@/components/auth/AuthShell";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { authError, type AuthErrorCode } from "@/lib/auth/errors";
import { authErrorPage, authCopy } from "@/content/auth";

export const metadata: Metadata = {
  title: "Sign-in interrupted",
};

/**
 * Where a failed OAuth or email-link exchange lands.
 *
 * The route handlers pass only a *code*, never a provider message. Reflecting
 * a provider-supplied string into the page would be an injection vector, and
 * the codes map to copy we control and have written for a user rather than a
 * developer.
 */
const KNOWN_CODES: readonly AuthErrorCode[] = [
  "oauth_cancelled",
  "oauth_failed",
  "provider_not_enabled",
  "expired_link",
  "rate_limited",
  "not_configured",
  "session_missing",
  "unknown",
];

function parseReason(value: string | undefined): AuthErrorCode {
  return KNOWN_CODES.includes(value as AuthErrorCode)
    ? (value as AuthErrorCode)
    : "unknown";
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const error = authError(parseReason(raw));

  // Cancelling is a choice, not a fault — it must not be framed as an error.
  const cancelled = error.code === "oauth_cancelled";

  return (
    <AuthShell
      eyebrow={authErrorPage.eyebrow}
      heading={cancelled ? "Sign-in was cancelled." : authErrorPage.heading}
      body="Nothing was created or changed. You can try again below."
      footer={
        <AuthAlternate
          prompt={authCopy.signIn.alternatePrompt}
          label={authCopy.signIn.alternateLabel}
          href={authCopy.signIn.alternateHref}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <AuthMessage
          tone={cancelled ? "notice" : "error"}
          title={cancelled ? "CANCELLED" : "WHAT HAPPENED"}
          body={error.message}
        />
        <AuthAlternate
          prompt="Ready to retry?"
          label={authErrorPage.retryLabel}
          href={authErrorPage.retryHref}
        />
      </div>
    </AuthShell>
  );
}
