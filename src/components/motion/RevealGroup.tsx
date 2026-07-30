"use client";

import { m, type Variants } from "framer-motion";
import type { ElementType, ReactNode } from "react";
import { duration, ease } from "@/lib/motion/tokens";

/**
 * Staggered entrance for a small group of related elements.
 *
 * Deliberately NOT a site-wide fade-up: the design rules forbid applying the
 * same entrance to every section. Use this only for genuine lists — nav items,
 * ledger rows, control groups — where the stagger communicates enumeration.
 * Narrative sections get their own mechanic instead.
 *
 * Under reduced motion, MotionConfig collapses these to instant, so children
 * appear complete with no opacity ramp.
 */

const groupVariants: Variants = {
  hidden: {},
  shown: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

export const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: ease.cut },
  },
};

type RevealGroupProps = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Fraction of the element that must be visible before triggering. */
  amount?: number;
};

export function RevealGroup({
  children,
  as = "div",
  className,
  amount = 0.3,
}: RevealGroupProps) {
  const Component = m[as as keyof typeof m] as typeof m.div;

  return (
    <Component
      className={className}
      variants={groupVariants}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount }}
    >
      {children}
    </Component>
  );
}

type StaggerItemProps = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
};

export function StaggerItem({
  children,
  as = "div",
  className,
}: StaggerItemProps) {
  const Component = m[as as keyof typeof m] as typeof m.div;

  return (
    <Component className={className} variants={staggerItemVariants}>
      {children}
    </Component>
  );
}
