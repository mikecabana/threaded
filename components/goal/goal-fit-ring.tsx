"use client";

import { m, useReducedMotion } from "motion/react";
import { useReveal } from "@/components/motion/scroll-reveal";
import { cn } from "@/lib/utils";

/** 0–100 score as a ring in the goal accent; fills when it scrolls into view (or mounts, in the app shell). */
export function GoalFitRing({ value, size = 44, className }: { value: number; size?: number; className?: string }) {
  const reduce = useReducedMotion();
  const reveal = useReveal();
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="img"
      aria-label={`Goal fit ${clamped} out of 100`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--border-strong)" strokeWidth="3" />
        <m.circle
          key={clamped}
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }}
          {...(reduce ? { animate: { pathLength: clamped / 100 } } : reveal({ pathLength: clamped / 100 }))}
          transition={{ type: "spring", stiffness: 60, damping: 16, delay: 0.15 }}
        />
      </svg>
      <span className="font-mono font-semibold text-fg text-xs tabular">{clamped}</span>
    </div>
  );
}
