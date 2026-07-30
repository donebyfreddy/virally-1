"use client";

import { useEffect, useRef } from "react";
import { TYPING_END, TYPING_START } from "./heroTimeline";
import { cn } from "@/lib/cn";

/**
 * Types the demo brief by reading the shared clock every frame and writing to
 * the DOM directly — no React state, so ~90 characters cost zero renders.
 *
 * The full text is always present for assistive technology; only the visible
 * layer animates. A screen reader hears the complete brief immediately rather
 * than a stream of partial words.
 */
export function PromptTypewriter({
  text,
  elapsedRef,
  isPlaying,
  staticFinalState,
  className,
}: {
  text: string;
  elapsedRef: React.RefObject<number>;
  isPlaying: boolean;
  staticFinalState: boolean;
  className?: string;
}) {
  const visibleRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = visibleRef.current;
    if (!node) return;

    if (staticFinalState) {
      node.textContent = text;
      if (caretRef.current) caretRef.current.style.opacity = "0";
      return;
    }

    let frame = 0;
    const span = TYPING_END - TYPING_START;

    const tick = () => {
      const elapsed = elapsedRef.current;
      const progress = Math.min(
        1,
        Math.max(0, (elapsed - TYPING_START) / span),
      );
      const chars = Math.round(progress * text.length);
      const next = text.slice(0, chars);
      if (node.textContent !== next) node.textContent = next;

      if (caretRef.current) {
        // Caret shows only while there is still text to type.
        caretRef.current.style.opacity = progress > 0 && progress < 1 ? "1" : "0";
      }

      frame = requestAnimationFrame(tick);
    };

    // Run one tick even while paused, so pausing leaves the correct partial
    // text on screen rather than whatever the last frame happened to be.
    tick();
    if (!isPlaying) {
      cancelAnimationFrame(frame);
      return;
    }
    return () => cancelAnimationFrame(frame);
  }, [text, elapsedRef, isPlaying, staticFinalState]);

  return (
    <p className={cn("whitespace-pre-wrap", className)}>
      <span ref={visibleRef} aria-hidden="true">
        {staticFinalState ? text : ""}
      </span>
      <span
        ref={caretRef}
        aria-hidden="true"
        className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-[var(--color-action)]"
        style={{ opacity: 0 }}
      />
      {/* The complete brief, always available to assistive technology. */}
      <span className="sr-only">{text}</span>
    </p>
  );
}
