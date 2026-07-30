import { describe, expect, it } from "vitest";
import {
  authError,
  classifyAuthError,
  classifyOAuthCallbackError,
} from "./errors";

describe("classifyAuthError", () => {
  it("classifies by stable code", () => {
    expect(classifyAuthError({ code: "invalid_email_or_password" }).code).toBe(
      "invalid_credentials",
    );
    expect(classifyAuthError({ code: "email_not_verified" }).code).toBe(
      "email_not_confirmed",
    );
    expect(classifyAuthError({ code: "password_too_short" }).code).toBe("weak_password");
    expect(classifyAuthError({ code: "too_many_requests" }).code).toBe("rate_limited");
  });

  it("falls back to message matching when no code is present", () => {
    expect(
      classifyAuthError({ message: "Invalid credentials" }).code,
    ).toBe("invalid_credentials");
    expect(classifyAuthError({ message: "Email not verified" }).code).toBe(
      "email_not_confirmed",
    );
    expect(
      classifyAuthError({ message: "Password should be at least 8 characters" })
        .code,
    ).toBe("weak_password");
  });

  it("treats HTTP 429 as rate limiting even with no code", () => {
    expect(classifyAuthError({ status: 429, message: "slow down" }).code).toBe(
      "rate_limited",
    );
  });

  it("classifies expired and invalid tokens", () => {
    expect(classifyAuthError({ code: "invalid_token" }).code).toBe("expired_link");
    expect(classifyAuthError({ code: "token_expired" }).code).toBe(
      "expired_link",
    );
  });

  it("classifies a disabled provider so the message names the fix", () => {
    const result = classifyAuthError({ code: "provider_disabled" });
    expect(result.code).toBe("provider_not_enabled");
    expect(result.message).toMatch(/AUTH_GOOGLE_CLIENT_ID/);
  });

  it("returns unknown rather than throwing on null or an unrecognised error", () => {
    expect(classifyAuthError(null).code).toBe("unknown");
    expect(classifyAuthError({}).code).toBe("unknown");
    expect(classifyAuthError({ message: "teapot" }).code).toBe("unknown");
  });

  it("never returns an empty message", () => {
    // The UI renders this string directly; an empty one would show a bordered
    // box with nothing in it.
    for (const error of [null, {}, { code: "invalid_credentials" }]) {
      expect(classifyAuthError(error).message.length).toBeGreaterThan(10);
    }
  });
});

describe("classifyOAuthCallbackError", () => {
  it("treats access_denied as a cancellation, not a failure", () => {
    // The user pressed cancel. Reporting that as an error is both wrong and
    // alarming.
    const result = classifyOAuthCallbackError("access_denied", "The user denied");
    expect(result.code).toBe("oauth_cancelled");
    expect(result.message).toMatch(/cancelled/i);
    expect(result.message).toMatch(/no account was created/i);
  });

  it("classifies a provider error description", () => {
    expect(
      classifyOAuthCallbackError("server_error", "provider is not enabled").code,
    ).toBe("provider_not_enabled");
  });

  it("returns unknown when there is no error at all", () => {
    expect(classifyOAuthCallbackError(null, null).code).toBe("unknown");
  });
});

describe("authError", () => {
  it("produces a message for every code it is given", () => {
    expect(authError("not_configured").message).toMatch(/database/i);
    expect(authError("expired_link").message).toMatch(/expired/i);
  });

  it("never leaks the raw provider wording into user copy", () => {
    // Regression guard: an earlier draft passed `error.message` straight through.
    const result = classifyAuthError({
      message: "APIError: Invalid credentials at /sign-in/email",
    });
    expect(result.message).not.toMatch(/APIError/);
    expect(result.message).not.toMatch(/sign-in\/email/);
  });
});
