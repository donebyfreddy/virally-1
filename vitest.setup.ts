import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom has no matchMedia. Default to "no reduced-motion preference" so
// components under test exercise their animated path unless a test overrides.
if (!window.matchMedia) {
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
