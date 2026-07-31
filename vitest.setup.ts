import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// This setup file runs for EVERY test file, including those that opt into the
// node environment with `@vitest-environment node` — server-only modules
// (src/lib/creative/**) must be tested without a `window`, because reading a
// provider credential with one present is exactly the bug their guard detects.
// So the DOM shim below is conditional rather than assumed.
//
// jsdom has no matchMedia. Default to "no reduced-motion preference" so
// components under test exercise their animated path unless a test overrides.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
