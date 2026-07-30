import type { Metadata } from "next";
import { AuthShell, AuthAlternate } from "@/components/auth/AuthShell";
import { ConfigurationNotice } from "@/components/auth/ConfigurationNotice";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { authCopy } from "@/content/auth";
import { isAppConfigured } from "@/lib/env";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow={authCopy.forgotPassword.eyebrow}
      heading={authCopy.forgotPassword.heading}
      body={authCopy.forgotPassword.body}
      footer={
        <AuthAlternate
          prompt={authCopy.forgotPassword.alternatePrompt}
          label={authCopy.forgotPassword.alternateLabel}
          href={authCopy.forgotPassword.alternateHref}
        />
      }
    >
      <div className="flex flex-col gap-8">
        <ConfigurationNotice />
        <ForgotPasswordForm authAvailable={isAppConfigured()} />
      </div>
    </AuthShell>
  );
}
