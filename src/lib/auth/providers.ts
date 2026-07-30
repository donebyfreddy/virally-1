import { isGoogleAuthConfigured } from "@/lib/env";

/**
 * Which auth providers this deployment actually has configured.
 *
 * Better Auth builds a working Google authorize URL only when
 * `AUTH_GOOGLE_CLIENT_ID`/`AUTH_GOOGLE_CLIENT_SECRET` are set — unlike
 * Supabase's `signInWithOAuth`, it does not build a URL for a provider with
 * no credentials, so there is no remote settings endpoint to probe here
 * (that was previously needed because Supabase itself decided whether a
 * provider was enabled, independent of our env vars). Availability is now
 * purely a function of our own configuration.
 */
export type ProviderAvailability = {
  google: boolean;
  emailPassword: boolean;
};

export function getProviderAvailability(): ProviderAvailability {
  return {
    google: isGoogleAuthConfigured(),
    emailPassword: true,
  };
}

/** Reason shown next to a disabled Google button. */
export const GOOGLE_DISABLED_REASON =
  "Google sign-in is not configured on this deployment. Set AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET, then reload this page." as const;
