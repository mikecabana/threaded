"use client";

import { m, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { softSpring } from "./springs";

/**
 * The Threads connector line, drawn top to bottom. Used between avatars in
 * post previews, between onboarding steps and along timelines.
 */
export function ThreadLine({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <m.span
      aria-hidden
      className={cn("block w-0.5 origin-top rounded-full bg-border-strong", className)}
      initial={{ scaleY: 0 }}
      whileInView={{ scaleY: 1 }}
      viewport={{ once: true }}
      transition={{ ...softSpring, delay }}
    />
  );
}

/** Draws any SVG path in, e.g. the curved thread in the landing hero. */
export function DrawPath({
  d,
  className,
  delay = 0,
  duration = 1.6,
}: {
  d: string;
  className?: string;
  delay?: number;
  duration?: number;
}) {
  // pathLength isn't a transform, so MotionConfig's reducedMotion doesn't cover it.
  const reduce = useReducedMotion();
  return (
    <m.path
      d={d}
      className={className}
      fill="none"
      initial={reduce ? false : { pathLength: 0, opacity: 0 }}
      whileInView={{ pathLength: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ pathLength: { duration, delay, ease: [0.65, 0, 0.35, 1] }, opacity: { duration: 0.2, delay } }}
    />
  );
}
