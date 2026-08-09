import { describe, expect, it } from "vitest";
import { classifyGenerationError, userMessageForGenerationError } from "./errors";

describe("generation error mapping", () => {
  it.each([
    ["http_401", "Unauthorized", "INVALID_API_KEY"],
    ["http_402", "Payment required", "INSUFFICIENT_PROVIDER_BALANCE"],
    ["provider_failed", "429 Too Many Requests", "RATE_LIMITED"],
    ["ingest_failed", "Could not download the provider output", "DOWNLOAD_FAILED"],
    ["provider_failed", "The content was rejected by moderation", "CONTENT_REJECTED"],
  ] as const)("maps %s", (code, message, expected) => {
    expect(classifyGenerationError(code, message)).toBe(expected);
  });

  it("does not expose a provider balance as the user's Virally balance", () => {
    expect(
      userMessageForGenerationError(
        "INSUFFICIENT_PROVIDER_BALANCE",
        "fal.ai",
        "raw provider response",
      ),
    ).toBe("fal.ai does not have enough balance to complete this generation.");
  });
});
