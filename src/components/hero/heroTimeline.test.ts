import { describe, expect, it } from "vitest";
import {
  HERO_BEATS,
  HERO_LOOP_DURATION,
  TYPING_END,
  TYPING_START,
  hasReached,
} from "./heroTimeline";

describe("hero timeline", () => {
  it("keeps the loop inside the 12–16 second target", () => {
    expect(HERO_LOOP_DURATION).toBeGreaterThanOrEqual(12);
    expect(HERO_LOOP_DURATION).toBeLessThanOrEqual(16);
  });

  it("orders beats strictly ascending", () => {
    for (let i = 1; i < HERO_BEATS.length; i += 1) {
      expect(HERO_BEATS[i].at).toBeGreaterThan(HERO_BEATS[i - 1].at);
    }
  });

  it("fits every beat inside the loop", () => {
    const last = HERO_BEATS[HERO_BEATS.length - 1];
    expect(last.at).toBeLessThan(HERO_LOOP_DURATION);
  });

  it("holds before restarting so the final state is readable", () => {
    const hold = HERO_BEATS.find((b) => b.id === "hold");
    expect(hold).toBeDefined();
    expect(HERO_LOOP_DURATION - hold!.at).toBeGreaterThanOrEqual(1.5);
  });

  it("finishes typing before the brief is parsed", () => {
    const parsed = HERO_BEATS.find((b) => b.id === "parsed")!;
    expect(TYPING_END).toBeLessThanOrEqual(parsed.at);
    expect(TYPING_START).toBeLessThan(TYPING_END);
  });

  it("treats beats as cumulative", () => {
    expect(hasReached("rendered", "concepts")).toBe(true);
    expect(hasReached("rendered", "rendered")).toBe(true);
    expect(hasReached("concepts", "rendered")).toBe(false);
    expect(hasReached("idle", "typing")).toBe(false);
  });

  it("reaches every beat from the final state", () => {
    for (const beat of HERO_BEATS) {
      expect(hasReached("hold", beat.id)).toBe(true);
    }
  });
});
