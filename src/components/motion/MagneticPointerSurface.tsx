"use client";

import { m, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useReducedMotionPreference } from "@/lib/motion/useReducedMotionPreference";

type MagneticPointerSurfaceProps = {
  children: ReactNode;
  className?: string;
  /** Maximum displacement in px. Design rule caps this at 8. */
  strength?: number;
};

/**
 * Damped pointer parallax, capped at 8px.
 *
 * This is the ONLY place in the codebase that uses `useSpring` — springy
 * physics elsewhere would make a professional tool read as a toy.
 *
 * Disabled entirely for touch (no hover), reduced motion, and coarse pointers.
 * Writes to motion values only, so tracking the pointer costs zero re-renders.
 */
export function MagneticPointerSurface({
  children,
  className,
  strength = 8,
}: MagneticPointerSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotionPreference();
  const enabledRef = useRef(false);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  const springX = useSpring(pointerX, { stiffness: 220, damping: 28, mass: 0.6 });
  const springY = useSpring(pointerY, { stiffness: 220, damping: 28, mass: 0.6 });

  const cap = Math.min(strength, 8);
  const x = useTransform(springX, [-0.5, 0.5], [-cap, cap]);
  const y = useTransform(springY, [-0.5, 0.5], [-cap, cap]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    enabledRef.current = fine.matches && !prefersReduced;

    if (!enabledRef.current) {
      pointerX.set(0);
      pointerY.set(0);
    }

    const onChange = () => {
      enabledRef.current = fine.matches && !prefersReduced;
      if (!enabledRef.current) {
        pointerX.set(0);
        pointerY.set(0);
      }
    };
    fine.addEventListener("change", onChange);
    return () => fine.removeEventListener("change", onChange);
  }, [prefersReduced, pointerX, pointerY]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabledRef.current || event.pointerType !== "mouse") return;
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
      pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
    },
    [pointerX, pointerY],
  );

  const handlePointerLeave = useCallback(() => {
    pointerX.set(0);
    pointerY.set(0);
  }, [pointerX, pointerY]);

  return (
    <m.div
      ref={ref}
      className={className}
      style={{ x, y }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </m.div>
  );
}
