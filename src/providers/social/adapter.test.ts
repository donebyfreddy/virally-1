import { describe, expect, it } from "vitest";
import {
  AdapterNotImplementedError,
  PLATFORM_REQUIREMENTS,
  UnimplementedAdapter,
  availabilityLabel,
  getAdapter,
} from "./adapter";
import type { Platform } from "@/types/database";

const PLATFORMS: Platform[] = ["instagram", "facebook", "tiktok", "youtube"];

describe("adapter availability", () => {
  it("reports configuration required when credentials are absent", () => {
    // No platform credentials exist on this deployment, which is the state under test.
    for (const platform of PLATFORMS) {
      const availability = getAdapter(platform).availability();
      expect(availability.state).toBe("configuration_required");
      if (availability.state !== "configuration_required") continue;
      expect(availability.missingEnv.length).toBeGreaterThan(0);
    }
  });

  it("names the exact missing variables", () => {
    const availability = getAdapter("tiktok").availability();
    if (availability.state !== "configuration_required") throw new Error("expected config required");
    expect(availability.missingEnv).toContain("TIKTOK_CLIENT_KEY");
    expect(availability.missingEnv).toContain("TIKTOK_CLIENT_SECRET");
  });

  it("distinguishes a missing adapter from missing credentials", () => {
    // The fix differs: one is the user's to make, the other is ours. Collapsing them
    // into one state would send the user hunting for a key they already set.
    const adapter = new UnimplementedAdapter("instagram", [], "note");
    expect(adapter.availability().state).toBe("adapter_not_implemented");
  });

  it("maps every state to the label the brief specifies", () => {
    expect(availabilityLabel({ state: "available" })).toBe("Available");
    expect(availabilityLabel({ state: "configuration_required", missingEnv: [] })).toBe(
      "Configuration required",
    );
    expect(availabilityLabel({ state: "awaiting_platform_approval", detail: "" })).toBe(
      "Awaiting platform approval",
    );
    expect(availabilityLabel({ state: "adapter_not_implemented", detail: "" })).toBe(
      "Not implemented yet",
    );
  });
});

describe("unimplemented operations fail loudly", () => {
  // A stub returning [] from fetchMetrics is indistinguishable from "no data yet",
  // which is precisely the quiet fiction that must not ship.
  const adapter = getAdapter("instagram");

  it("throws rather than returning an empty metric array", async () => {
    await expect(adapter.fetchMetrics({ accessToken: "x", externalPostId: "y" })).rejects.toThrow(
      AdapterNotImplementedError,
    );
  });

  it("throws rather than returning a fake post reference", async () => {
    await expect(
      adapter.publish({
        accessToken: "x",
        media: { mediaId: "m" },
        payload: {
          caption: null,
          firstComment: null,
          mediaUrl: "https://example.test/a.mp4",
          mimeType: "video/mp4",
          durationSeconds: 15,
          options: {},
        },
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(AdapterNotImplementedError);
  });

  it("throws on every operation, with the operation named", async () => {
    const attempts: [string, Promise<unknown>][] = [
      ["getAuthorizationUrl", adapter.getAuthorizationUrl({ redirectUri: "r", scopes: [] })],
      ["handleCallback", adapter.handleCallback({ code: "c", state: "s", codeVerifier: null, redirectUri: "r" })],
      ["refreshConnection", adapter.refreshConnection({ refreshToken: "r" })],
      ["getCapabilities", adapter.getCapabilities({ accountKind: "business", grantedScopes: [] })],
      ["uploadMedia", adapter.uploadMedia({ accessToken: "a", payload: {
        caption: null, firstComment: null, mediaUrl: "u", mimeType: "video/mp4", durationSeconds: null, options: {},
      } })],
      ["getPublishStatus", adapter.getPublishStatus({ accessToken: "a", externalPostId: "p" })],
      ["disconnect", adapter.disconnect({ accessToken: "a" })],
    ];

    for (const [operation, promise] of attempts) {
      await expect(promise, operation).rejects.toThrow(new RegExp(operation));
    }
  });

  it("states that nothing was changed", async () => {
    // The user needs to know a failed publish did not half-post.
    try {
      await adapter.disconnect({ accessToken: "a" });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as Error).message).toMatch(/nothing was changed/i);
    }
  });
});

describe("platform requirements are stated honestly", () => {
  it("documents the approval gate for every platform", () => {
    // Hiding app review until the first failed publish misleads the user.
    for (const platform of PLATFORMS) {
      const requirement = PLATFORM_REQUIREMENTS[platform];
      expect(requirement.env.length).toBeGreaterThan(0);
      expect(requirement.approval.length).toBeGreaterThan(30);
    }
  });

  it("names the specific review or quota constraint", () => {
    expect(PLATFORM_REQUIREMENTS.instagram.approval).toMatch(/professional account/i);
    expect(PLATFORM_REQUIREMENTS.instagram.approval).toMatch(/app review/i);
    expect(PLATFORM_REQUIREMENTS.tiktok.approval).toMatch(/audited/i);
    expect(PLATFORM_REQUIREMENTS.youtube.approval).toMatch(/quota/i);
    expect(PLATFORM_REQUIREMENTS.facebook.approval).toMatch(/pages_manage_posts/);
  });
});

describe("compliance boundary", () => {
  it("exposes no method for creating accounts or bypassing verification", () => {
    // Guards the interface surface itself. If someone adds one of these, this fails.
    const adapter = getAdapter("instagram") as unknown as Record<string, unknown>;
    const forbidden = [
      "createAccount",
      "registerAccount",
      "signUp",
      "solveCaptcha",
      "bypassCaptcha",
      "verifyPhone",
      "bypassVerification",
      "rotateProxy",
      "setProxy",
      "spoofDevice",
      "buyFollowers",
      "sendDirectMessage",
      "massMessage",
      "loginWithPassword",
      "setPassword",
    ];
    for (const method of forbidden) {
      expect(adapter[method], method).toBeUndefined();
    }
  });

  it("accepts no password anywhere in its call signatures", () => {
    // Structural check on the source: the adapter authorises via OAuth only.
    const source = UnimplementedAdapter.toString();
    expect(source).not.toMatch(/password/i);
  });
});
