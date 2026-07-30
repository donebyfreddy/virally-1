"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Single-active-video manager.
 *
 * Exactly one `<video>` may play across the whole page. Without a central
 * owner, an output wall of nine cards decodes nine streams simultaneously and
 * the page stops being smooth on anything but a desktop.
 *
 * Not yet consumed: the output wall has no real footage, so it mounts no video
 * elements. This is the wiring those cards will use, kept alongside the
 * lazy-attachment hook so the policy exists before the media does.
 */

let activeId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function setActive(id: string | null) {
  if (activeId === id) return;
  activeId = id;
  listeners.forEach((listener) => listener(activeId));
}

export function useActiveVideo(id: string) {
  const [active, setActiveState] = useState(() => activeId === id);

  useEffect(() => {
    const listener = (next: string | null) => setActiveState(next === id);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (activeId === id) setActive(null);
    };
  }, [id]);

  return {
    active,
    claim: () => setActive(id),
    release: () => {
      if (activeId === id) setActive(null);
    },
  };
}

/**
 * Attaches `<source>` only once the element approaches the viewport, and pauses
 * whenever it leaves or the tab is hidden. Returns whether sources should be
 * mounted.
 */
export function useLazyVideoSource(
  ref: React.RefObject<HTMLElement | null>,
  rootMargin = "200px",
): boolean {
  const [shouldAttach, setShouldAttach] = useState(false);
  const attachedRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || attachedRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          attachedRef.current = true;
          setShouldAttach(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return shouldAttach;
}
