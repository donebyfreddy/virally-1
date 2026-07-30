import { describe, expect, it } from "vitest";
import {
  assertNoPlaceholders,
  mayAnimate,
  needsDisclosure,
  type Provenance,
} from "./provenance";
import { volumeMetrics } from "./proof";
import { evidenceBlocks } from "./evidence";

const verified: Provenance = {
  status: "verified",
  source: "Internal telemetry",
  sourceUrl: "https://example.com/report",
  asOf: "2026-07-01",
};

describe("provenance rules", () => {
  it("only lets verified figures animate", () => {
    expect(mayAnimate(verified)).toBe(true);
    expect(mayAnimate({ status: "illustrative" })).toBe(false);
    expect(mayAnimate({ status: "internal-demo" })).toBe(false);
    expect(mayAnimate({ status: "placeholder", required: "[X]" })).toBe(false);
  });

  it("requires a disclosure for illustrative and placeholder data", () => {
    expect(needsDisclosure({ status: "illustrative" })).toBe(true);
    expect(needsDisclosure({ status: "placeholder", required: "[X]" })).toBe(true);
    expect(needsDisclosure(verified)).toBe(false);
    expect(needsDisclosure({ status: "internal-demo" })).toBe(false);
  });
});

describe("placeholder build guard", () => {
  const items = [
    { id: "ok", provenance: verified },
    { id: "bad", provenance: { status: "placeholder", required: "[REAL METRIC]" } as const },
  ];

  it("permits placeholders outside production", () => {
    expect(() => assertNoPlaceholders(items, "test")).not.toThrow();
  });

  it("names the offenders when running in production", () => {
    const previous = process.env.NODE_ENV;
    // @ts-expect-error NODE_ENV is readonly in the Next type augmentation.
    process.env.NODE_ENV = "production";
    try {
      expect(() => assertNoPlaceholders(items, "test")).toThrow(/bad/);
    } finally {
      // @ts-expect-error see above.
      process.env.NODE_ENV = previous;
    }
  });
});

describe("shipped content honesty", () => {
  it("never animates an unverified proof metric", () => {
    for (const metric of volumeMetrics) {
      if (metric.provenance.status !== "verified") {
        expect(mayAnimate(metric.provenance)).toBe(false);
      }
    }
  });

  it("gives every verified claim a source, URL and date", () => {
    for (const metric of volumeMetrics) {
      if (metric.provenance.status === "verified") {
        expect(metric.provenance.source.length).toBeGreaterThan(0);
        expect(metric.provenance.sourceUrl).toMatch(/^https?:\/\//);
        expect(metric.provenance.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("keeps evidence blocks attributed", () => {
    for (const block of evidenceBlocks) {
      expect(block.provenance.status).toBeDefined();
    }
  });
});
