"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A boolean preference persisted in localStorage.
 *
 * `useSyncExternalStore` rather than `useState` + a mount effect. localStorage is an
 * external store, and this is the primitive React provides for reading one: it
 * handles the server/client snapshot split itself, so there is no hydration
 * mismatch and no `setState` inside an effect (which React 19 flags as a cascading
 * render, correctly — the effect pattern renders twice on every mount).
 *
 * The `storage` event keeps two tabs in agreement. It only fires in *other* tabs, so
 * local writes notify listeners explicitly.
 */

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function useLocalFlag(
  key: string,
  fallback = false,
): readonly [boolean, (next: boolean) => void] {
  const getSnapshot = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === "true";
    } catch {
      // Private browsing and some embedded webviews throw on access. A viewport
      // preference is not worth failing a render over.
      return fallback;
    }
  }, [key, fallback]);

  // The server has no localStorage, so it always renders the fallback. This is what
  // makes the first client render match the server's HTML.
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Ignored for the same reason as above; the in-memory notify still runs so
        // the UI responds even when persistence is unavailable.
      }
      notify();
    },
    [key],
  );

  return [value, set] as const;
}
