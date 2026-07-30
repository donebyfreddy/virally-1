import type { Metadata } from "next";
import { AuthShell, AuthAlternate } from "@/components/auth/AuthShell";
import { AuthMessage } from "@/components/auth/AuthMessage";
import { ConfigurationNotice } from "@/components/auth/ConfigurationNotice";
import { UpdatePasswordForm } from "@/components/auth/UpdatePasswordForm";
import { authCopy } from "@/content/auth";
import { authError } from "@/lib/auth/errors";
import { isAppConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Set new password",
};

/**
 * Reached only from a reset-password link, which appends Better Auth's
 * one-time `token` as a query parameter — there is no established session at
 * this point (unlike the old Supabase recovery-link flow), so the token
 * itself is what `updatePassword` verifies.
 */
export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = rawToken ?? "";
  const available = isAppConfigured();

  return (
    <AuthShell
      eyebrow={authCopy.updatePassword.eyebrow}
      heading={authCopy.updatePassword.heading}
      body={authCopy.updatePassword.body}
      footer={
        <AuthAlternate
          prompt={authCopy.updatePassword.alternatePrompt}
          label={authCopy.updatePassword.alternateLabel}
          href={authCopy.updatePassword.alternateHref}
        />
      }
    >
      <div className="flex flex-col gap-8">
        <ConfigurationNotice />
        {available && !token ? (
          <AuthMessage
            tone="error"
            title="LINK NO LONGER VALID"
            body={authError("expired_link").message}
          />
        ) : (
          <UpdatePasswordForm authAvailable={available} token={token} />
        )}
      </div>
    </AuthShell>
  );
}
