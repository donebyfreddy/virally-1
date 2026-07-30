import type { Metadata } from "next";
import { AuthShell, AuthAlternate } from "@/components/auth/AuthShell";
import { ConfigurationNotice } from "@/components/auth/ConfigurationNotice";
import { SignInForm } from "@/components/auth/SignInForm";
import { authCopy } from "@/content/auth";
import { isAppConfigured } from "@/lib/env";
import { GOOGLE_DISABLED_REASON, getProviderAvailability } from "@/lib/auth/providers";
import { PRODUCT_HOME, safeNextPath } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNextPath(rawNext, PRODUCT_HOME);
  const available = isAppConfigured();
  const providers = getProviderAvailability();

  return (
    <AuthShell
      eyebrow={authCopy.signIn.eyebrow}
      heading={authCopy.signIn.heading}
      body={authCopy.signIn.body}
      footer={
        <AuthAlternate
          prompt={authCopy.signIn.alternatePrompt}
          label={authCopy.signIn.alternateLabel}
          href={authCopy.signIn.alternateHref}
        />
      }
    >
      <div className="flex flex-col gap-8">
        <ConfigurationNotice />
        <SignInForm
          next={next}
          authAvailable={available}
          googleAvailable={providers.google}
          googleUnavailableReason={providers.google ? undefined : GOOGLE_DISABLED_REASON}
        />
      </div>
    </AuthShell>
  );
}
