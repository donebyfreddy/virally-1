"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseSetCookieHeader } from "better-auth/cookies";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth/better-auth";
import { isAppConfigured, resolveSiteOrigin } from "@/lib/env";
import { classifyAuthError, authError, type AuthError } from "./errors";
import { isPlausibleEmail, PASSWORD_MIN_LENGTH } from "./password";
import { PRODUCT_HOME, SIGN_IN_PATH, safeNextPath } from "./routes";
import type { AuthActionState } from "./state";

/** Absolute origin for links Better Auth will email or redirect to. */
async function siteOrigin(): Promise<string> {
  const headerList = await headers();
  return resolveSiteOrigin(headerList.get("origin"));
}

/**
 * Better Auth's server API returns cookies on the `Response` it builds, not
 * through Next's cookie jar. A server action can't return a raw fetch
 * `Response`, so the Set-Cookie headers are parsed and replayed onto Next's
 * cookie store — the documented pattern for calling `auth.api.*` from a
 * server action instead of through the catch-all route handler.
 */
async function applySetCookies(response: Response): Promise<void> {
  const header = response.headers.get("set-cookie");
  if (!header) return;
  const cookieStore = await cookies();
  const parsed = parseSetCookieHeader(header);
  for (const [name, attributes] of parsed) {
    const { value, ...rest } = attributes as { value: string } & Record<string, unknown>;
    cookieStore.set(name, value ?? "", rest as Parameters<typeof cookieStore.set>[2]);
  }
}

function fail(error: AuthError, field?: "email" | "password"): AuthActionState {
  return { status: "error", error, field };
}

function readCredentials(formData: FormData): { email: string; password: string } {
  return {
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };
}

function toAuthError(error: unknown): AuthError {
  if (error instanceof APIError) {
    return classifyAuthError({ code: error.body?.code, message: error.message, status: error.statusCode });
  }
  return authError("unknown");
}

/** Email + password registration. */
export async function signUpWithPassword(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isAppConfigured()) return fail(authError("not_configured"));

  const { email, password } = readCredentials(formData);
  const next = safeNextPath(String(formData.get("next") ?? ""), PRODUCT_HOME);

  if (!isPlausibleEmail(email)) return fail(authError("invalid_email"), "email");
  if (password.length < PASSWORD_MIN_LENGTH) {
    return fail(authError("weak_password"), "password");
  }

  const name = email.split("@")[0] ?? email;

  try {
    const response = await auth.api.signUpEmail({
      body: { email, password, name, callbackURL: next },
      asResponse: true,
    });
    await applySetCookies(response);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      return fail(classifyAuthError({ code: body.code, message: body.message, status: response.status }));
    }
  } catch (error) {
    return fail(toAuthError(error));
  }

  return {
    status: "success",
    message: `Confirm your email to finish. We sent a link to ${email} — it expires in one hour.`,
  };
}

export async function signInWithPassword(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isAppConfigured()) return fail(authError("not_configured"));

  const { email, password } = readCredentials(formData);
  const next = safeNextPath(String(formData.get("next") ?? ""), PRODUCT_HOME);

  if (email === "" || password === "") {
    return fail(authError("invalid_credentials"));
  }

  try {
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    await applySetCookies(response);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      return fail(classifyAuthError({ code: body.code, message: body.message, status: response.status }));
    }
  } catch (error) {
    return fail(toAuthError(error));
  }

  redirect(next);
}

/**
 * Google OAuth.
 *
 * Better Auth builds the authorize URL and, like Supabase's PKCE flow,
 * stores the verifier/state in a cookie only the callback route can read.
 */
export async function signInWithGoogle(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isAppConfigured()) return fail(authError("not_configured"));

  const next = safeNextPath(String(formData.get("next") ?? ""), PRODUCT_HOME);
  const origin = await siteOrigin();

  let redirectUrl: string | undefined;
  try {
    const response = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: `${origin}${next}` },
      asResponse: true,
    });
    await applySetCookies(response);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
      return fail(classifyAuthError({ code: body.code, message: body.message, status: response.status }));
    }
    const body = (await response.json()) as { url?: string };
    redirectUrl = body.url;
  } catch (error) {
    return fail(toAuthError(error));
  }

  if (!redirectUrl) return fail(authError("oauth_failed"));
  redirect(redirectUrl);
}

/**
 * Password reset request.
 *
 * Always reports success. Reporting "no account found" would turn this form
 * into an account-existence oracle.
 */
export async function requestPasswordReset(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isAppConfigured()) return fail(authError("not_configured"));

  const email = String(formData.get("email") ?? "").trim();
  if (!isPlausibleEmail(email)) return fail(authError("invalid_email"), "email");

  const origin = await siteOrigin();

  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${origin}/auth/update-password` },
    });
  } catch (error) {
    const classified = toAuthError(error);
    if (classified.code === "rate_limited") return fail(classified);
  }

  return {
    status: "success",
    message: `If an account exists for ${email}, a reset link is on its way. The link expires in one hour.`,
  };
}

/**
 * Sets a new password from the reset-link token (query param `token`, read by
 * the update-password page and passed through as a hidden field).
 */
export async function updatePassword(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isAppConfigured()) return fail(authError("not_configured"));

  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");
  const token = String(formData.get("token") ?? "");

  if (password.length < PASSWORD_MIN_LENGTH) {
    return fail(authError("weak_password"), "password");
  }
  if (password !== confirmation) {
    return fail({ code: "weak_password", message: "The two passwords do not match." }, "password");
  }
  if (!token) return fail(authError("expired_link"));

  try {
    await auth.api.resetPassword({ body: { newPassword: password, token } });
  } catch (error) {
    return fail(toAuthError(error));
  }

  redirect(SIGN_IN_PATH);
}

/** Re-sends the confirmation email for an unverified address. */
export async function resendConfirmation(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isAppConfigured()) return fail(authError("not_configured"));

  const email = String(formData.get("email") ?? "").trim();
  if (!isPlausibleEmail(email)) return fail(authError("invalid_email"), "email");

  try {
    await auth.api.sendVerificationEmail({ body: { email } });
  } catch (error) {
    const classified = toAuthError(error);
    if (classified.code === "rate_limited") return fail(classified);
  }

  return {
    status: "success",
    message: `A new confirmation link is on its way to ${email}.`,
  };
}

export async function signOut(): Promise<void> {
  if (!isAppConfigured()) redirect(SIGN_IN_PATH);

  try {
    const response = await auth.api.signOut({ headers: await headers(), asResponse: true });
    await applySetCookies(response);
  } catch {
    // Sign-out clears the cookie regardless of whether the server round-trip
    // succeeded; falling through to the redirect is correct either way.
  }
  redirect(SIGN_IN_PATH);
}
