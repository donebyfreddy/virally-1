import type { Metadata } from "next";
import { AuthShell, AuthAlternate } from "@/components/auth/AuthShell";
import { ConfigurationNotice } from "@/components/auth/ConfigurationNotice";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { authCopy } from "@/content/auth";
import { isAppConfigured } from "@/lib/env";
import { GOOGLE_DISABLED_REASON, getProviderAvailability } from "@/lib/auth/providers";
import { PRODUCT_HOME, safeNextPath } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: "Create account",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  // Validated here as well as in the action. The value round-trips through a
  // hidden input, so it must be safe on the way out and on the way back.
  const next = safeNextPath(rawNext, PRODUCT_HOME);
  const available = isAppConfigured();
  const providers = getProviderAvailability();

  return (
    <AuthShell
      eyebrow={authCopy.signUp.eyebrow}
      heading={authCopy.signUp.heading}
      body={authCopy.signUp.body}
      showLegal
      footer={
        <AuthAlternate
          prompt={authCopy.signUp.alternatePrompt}
          label={authCopy.signUp.alternateLabel}
          href={authCopy.signUp.alternateHref}
        />
      }
    >
      <div className="flex flex-col gap-8">
        <ConfigurationNotice />
        <SignUpForm
          next={next}
          authAvailable={available}
          googleAvailable={providers.google}
          googleUnavailableReason={providers.google ? undefined : GOOGLE_DISABLED_REASON}
        />
      </div>
    </AuthShell>
  );
}
