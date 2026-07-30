import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppConfig, resolveOrigin } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAppConfig", () => {
  it("reports both missing variables by name when nothing is set", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    const result = resolveAppConfig();
    expect(result.status).toBe("unconfigured");
    if (result.status !== "unconfigured") return;

    const named = result.problems.map((p) => p.variable);
    expect(named).toContain("DATABASE_URL");
    expect(named).toContain("BETTER_AUTH_SECRET");
  });

  it("resolves once both are set", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@host/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secret");

    expect(resolveAppConfig().status).toBe("configured");
  });

  it("treats whitespace-only values as unset", () => {
    vi.stubEnv("DATABASE_URL", "   ");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secret");

    expect(resolveAppConfig().status).toBe("unconfigured");
  });
});

describe("resolveOrigin", () => {
  it("strips trailing slashes so redirect URLs never double up", () => {
    // `${origin}/auth/callback` with a trailing slash produces `//auth/callback`,
    // which the OAuth provider will not match against its allow-list.
    expect(resolveOrigin("https://virally.test/", null)).toBe("https://virally.test");
    expect(resolveOrigin("https://virally.test///", null)).toBe("https://virally.test");
  });

  it("prefers the configured origin over an attacker-influenced request header", () => {
    expect(resolveOrigin("https://virally.test", "https://evil.example")).toBe(
      "https://virally.test",
    );
  });

  it("falls back to the request origin when none is configured", () => {
    expect(resolveOrigin(undefined, "http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
  });

  it("falls back to localhost when there is no origin at all", () => {
    expect(resolveOrigin(undefined, null)).toBe("http://localhost:3000");
    expect(resolveOrigin(undefined, undefined)).toBe("http://localhost:3000");
  });
});
