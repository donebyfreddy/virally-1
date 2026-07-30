import { describe, expect, it } from "vitest";
import { assessPassword, isPlausibleEmail, PASSWORD_MIN_LENGTH } from "./password";

describe("assessPassword", () => {
  it("reports an empty password as empty, not weak", () => {
    // The distinction matters: an untouched field must not render as a failure.
    const result = assessPassword("");
    expect(result.strength).toBe("empty");
    expect(result.acceptable).toBe(false);
  });

  it("requires the minimum length", () => {
    expect(assessPassword("a".repeat(PASSWORD_MIN_LENGTH - 1)).acceptable).toBe(
      false,
    );
    expect(assessPassword("a".repeat(PASSWORD_MIN_LENGTH)).acceptable).toBe(true);
  });

  it("accepts a long all-lowercase passphrase", () => {
    // Blocking these pushes users towards shorter, more guessable passwords.
    const result = assessPassword("correct horse battery staple");
    expect(result.acceptable).toBe(true);
  });

  it("rates a long mixed password as strong", () => {
    expect(assessPassword("Reel-Engine-2026!").strength).toBe("strong");
  });

  it("rates a bare minimum-length password as fair, not strong", () => {
    expect(assessPassword("abcdefgh").strength).toBe("fair");
  });

  it("always returns all three requirements with their state", () => {
    const result = assessPassword("Ab1");
    expect(result.requirements).toHaveLength(3);
    expect(result.requirements.map((r) => r.met)).toEqual([false, true, true]);
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isPlausibleEmail("federico@hirint.io")).toBe(true);
    expect(isPlausibleEmail("a.b+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects structurally impossible addresses", () => {
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail("nope")).toBe(false);
    expect(isPlausibleEmail("@example.com")).toBe(false);
    expect(isPlausibleEmail("a@")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a@@b.com")).toBe(false);
    expect(isPlausibleEmail("a b@example.com")).toBe(false);
    expect(isPlausibleEmail("a@.example.com")).toBe(false);
    expect(isPlausibleEmail("a@example.com.")).toBe(false);
  });

  it("tolerates surrounding whitespace, which pasting reliably introduces", () => {
    expect(isPlausibleEmail("  federico@hirint.io  ")).toBe(true);
  });

  it("rejects an address beyond the RFC length limit", () => {
    expect(isPlausibleEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});
