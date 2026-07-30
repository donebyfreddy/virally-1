/**
 * Better Auth error translation.
 *
 * Raw Better Auth `APIError`s are developer-facing (codes like
 * "INVALID_EMAIL_OR_PASSWORD") and sometimes leak whether an address is
 * registered. This maps them to copy a user can act on, and decides
 * deliberately what to disclose.
 */

/** Stable identifiers so tests and telemetry never depend on prose. */
export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "already_registered"
  | "weak_password"
  | "invalid_email"
  | "rate_limited"
  | "same_password"
  | "expired_link"
  | "oauth_cancelled"
  | "oauth_failed"
  | "provider_not_enabled"
  | "session_missing"
  | "not_configured"
  | "unknown";

export type AuthError = {
  code: AuthErrorCode;
  /** Shown to the user. Written as a sentence with a next step where possible. */
  message: string;
};

/**
 * The shape Better Auth's `APIError` actually carries. Typed structurally
 * rather than importing it from the SDK so this module stays testable with
 * plain objects.
 */
type BetterAuthErrorLike = {
  message?: string;
  code?: string;
  status?: number;
};

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials:
    "That email and password combination is not correct. Check both, or reset your password.",
  email_not_confirmed:
    "This account exists but the email address has not been confirmed yet. Check your inbox, or request a new confirmation email below.",
  already_registered:
    "An account already exists for this email address. Sign in instead, or reset the password if you have forgotten it.",
  weak_password:
    "That password does not meet the minimum requirements. Use at least 8 characters.",
  invalid_email: "That does not look like a valid email address.",
  rate_limited:
    "Too many attempts. Wait a minute before trying again — this limit protects the account.",
  same_password:
    "The new password is the same as the current one. Choose a different password.",
  expired_link:
    "This link has expired or has already been used. Request a new one to continue.",
  oauth_cancelled:
    "Google sign-in was cancelled, so no account was created or accessed. You can try again or use email instead.",
  oauth_failed:
    "Google sign-in could not be completed. Try again, or sign in with an email address and password.",
  provider_not_enabled:
    "Google sign-in is not configured on this deployment yet. Set AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET, then try again.",
  session_missing:
    "Your session has expired. Sign in again to continue where you left off.",
  not_configured:
    "This deployment is not connected to a database yet, so accounts cannot be created. See the configuration notice below.",
  unknown:
    "Something failed while talking to the authentication service. Nothing was changed. Try again in a moment.",
};

export function authError(code: AuthErrorCode): AuthError {
  return { code, message: MESSAGES[code] };
}

/**
 * Classifies a Better Auth error.
 *
 * Matches on `code` first because Better Auth returns stable
 * SCREAMING_SNAKE_CASE codes; the message substrings are a fallback for
 * provider errors that arrive as plain strings.
 */
export function classifyAuthError(error: BetterAuthErrorLike | null): AuthError {
  if (!error) return authError("unknown");

  const code = error.code?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";

  const has = (needle: string) => code.includes(needle) || message.includes(needle);

  if (has("invalid_email_or_password") || has("invalid credentials")) {
    return authError("invalid_credentials");
  }
  if (has("email_not_verified") || has("email not verified")) {
    return authError("email_not_confirmed");
  }
  if (
    has("user_already_exists") ||
    has("email_already_exists") ||
    has("already registered") ||
    has("already exists")
  ) {
    return authError("already_registered");
  }
  if (has("password_too_short") || has("password_too_long") || has("password should be")) {
    return authError("weak_password");
  }
  if (has("same_password")) return authError("same_password");
  if (has("invalid_email") || has("invalid email")) {
    return authError("invalid_email");
  }
  if (error.status === 429 || has("too_many_requests") || has("rate limit")) {
    return authError("rate_limited");
  }
  if (
    has("invalid_token") ||
    has("token_expired") ||
    has("expired") ||
    has("invalid or expired")
  ) {
    return authError("expired_link");
  }
  if (has("provider_disabled") || has("provider is not enabled") || has("not_configured")) {
    return authError("provider_not_enabled");
  }
  if (has("session_not_found") || has("session expired") || has("no session")) {
    return authError("session_missing");
  }

  return authError("unknown");
}

/**
 * Classifies the `error` query parameters an OAuth provider appends when it
 * bounces back. `access_denied` is the user pressing cancel, which is not a
 * failure and must not be reported as one.
 */
export function classifyOAuthCallbackError(
  error: string | null,
  description: string | null,
): AuthError {
  if (!error) return authError("unknown");
  if (error === "access_denied") return authError("oauth_cancelled");
  return classifyAuthError({ code: error, message: description ?? error });
}
