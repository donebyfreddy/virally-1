import { describe, expect, it } from "vitest";
import { formatDuration, formatMetric, formatTimecode, padIndex } from "./format";

describe("formatMetric", () => {
  it("groups counts with separators", () => {
    expect(formatMetric(1284, "count")).toBe("1,284");
    expect(formatMetric(0, "count")).toBe("0");
  });

  it("rounds mid-animation fractional values so frames never show decimals", () => {
    expect(formatMetric(1283.6, "count")).toBe("1,284");
    expect(formatMetric(0.4, "count")).toBe("0");
  });

  it("compacts large figures", () => {
    expect(formatMetric(1_200_000, "compact")).toBe("1.2M");
    expect(formatMetric(4300, "compact")).toBe("4.3K");
  });

  it("formats percentages", () => {
    expect(formatMetric(41.2, "percent")).toBe("41%");
  });

  it("formats durations", () => {
    expect(formatMetric(28, "duration")).toBe("0:28");
  });
});

describe("formatDuration", () => {
  it("pads seconds", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("clamps negatives to zero rather than rendering a minus sign", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("formatTimecode", () => {
  it("renders HH:MM:SS", () => {
    expect(formatTimecode(252)).toBe("00:04:12");
    expect(formatTimecode(3661)).toBe("01:01:01");
  });
});

describe("padIndex", () => {
  it("pads single digits for act numbering", () => {
    expect(padIndex(3)).toBe("03");
    expect(padIndex(12)).toBe("12");
  });
});
