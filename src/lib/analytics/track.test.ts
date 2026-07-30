import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __peekQueue,
  __reset,
  getConsent,
  registerSink,
  setConsent,
  track,
} from "./track";
import { MAX_STRING_LENGTH, isSafePayload, deviceCategory, viewportBucket } from "./events";
import type { AnalyticsEvent } from "./events";

beforeEach(() => __reset());

describe("consent gating", () => {
  it("buffers events until consent is granted", () => {
    const sink = vi.fn();
    registerSink(sink);
    track("page_viewed", "hero", { path: "/" });
    expect(sink).not.toHaveBeenCalled();
    expect(__peekQueue()).toHaveLength(1);
  });

  it("flushes the buffer on grant", () => {
    const sink = vi.fn();
    registerSink(sink);
    track("page_viewed", "hero", { path: "/" });
    setConsent("granted");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(__peekQueue()).toHaveLength(0);
  });

  it("discards buffered events on denial and sends nothing afterwards", () => {
    const sink = vi.fn();
    registerSink(sink);
    track("page_viewed", "hero", { path: "/" });
    setConsent("denied");
    track("hero_primary_cta_clicked", "hero", { ctaPosition: "hero" });
    expect(sink).not.toHaveBeenCalled();
    expect(__peekQueue()).toHaveLength(0);
  });

  it("starts in the pending state", () => {
    expect(getConsent()).toBe("pending");
  });
});

describe("payload safety", () => {
  it("accepts primitives within the length limit", () => {
    expect(isSafePayload({ plan: "studio", assets: 36, ok: true })).toBe(true);
  });

  it("rejects long strings that could carry free text", () => {
    expect(isSafePayload({ note: "x".repeat(MAX_STRING_LENGTH + 1) })).toBe(false);
  });

  it("rejects nested objects and arrays", () => {
    expect(isSafePayload({ nested: { a: 1 } })).toBe(false);
    expect(isSafePayload({ list: [1, 2] })).toBe(false);
  });

  it("drops an unsafe event rather than sending it", () => {
    const sink = vi.fn();
    registerSink(sink);
    setConsent("granted");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Type-valid but runtime-unsafe: the guard is a defence against long
    // strings the type system cannot rule out.
    track("format_selected", "formats", { format: "x".repeat(200) });
    expect(sink).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("event context", () => {
  it("attaches section, device and viewport context to every event", () => {
    let captured: AnalyticsEvent | null = null;
    registerSink((e) => (captured = e));
    setConsent("granted");
    track("format_selected", "formats", { format: "9:16" });

    expect(captured).not.toBeNull();
    const event = captured as unknown as AnalyticsEvent;
    expect(event.context.section).toBe("formats");
    expect(event.context.deviceCategory).toBeDefined();
    expect(event.context.viewportBucket).toBeDefined();
    expect(typeof event.context.reducedMotion).toBe("boolean");
  });

  it("uses a relative timestamp, never a wall clock", () => {
    let captured: AnalyticsEvent | null = null;
    registerSink((e) => (captured = e));
    setConsent("granted");
    track("page_viewed", "hero", { path: "/" });
    const event = captured as unknown as AnalyticsEvent;
    // A navigation-relative value, not epoch milliseconds.
    expect(event.at).toBeLessThan(1_000_000_000);
  });
});

describe("sink isolation", () => {
  it("a throwing sink cannot break the page or other sinks", () => {
    const good = vi.fn();
    registerSink(() => {
      throw new Error("sink exploded");
    });
    registerSink(good);
    setConsent("granted");
    expect(() => track("page_viewed", "hero", { path: "/" })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("unregisters cleanly", () => {
    const sink = vi.fn();
    const off = registerSink(sink);
    off();
    setConsent("granted");
    track("page_viewed", "hero", { path: "/" });
    expect(sink).not.toHaveBeenCalled();
  });
});

describe("bucketing", () => {
  it("maps widths to the four tested viewports", () => {
    expect(viewportBucket(390)).toBe(390);
    expect(viewportBucket(768)).toBe(768);
    expect(viewportBucket(1440)).toBe(1440);
    expect(viewportBucket(2560)).toBe(1920);
  });

  it("maps widths to device categories", () => {
    expect(deviceCategory(390)).toBe("mobile");
    expect(deviceCategory(800)).toBe("tablet");
    expect(deviceCategory(1440)).toBe("desktop");
  });
});
