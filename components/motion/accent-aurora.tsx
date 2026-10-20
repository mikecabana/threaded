"use client";

import { m } from "motion/react";
import { cn } from "@/lib/utils";

const drift = {
  duration: 18,
  repeat: Number.POSITIVE_INFINITY,
  repeatType: "mirror" as const,
  ease: "easeInOut" as const,
};

/**
 * Soft, slowly drifting glow in the current goal's accent color. Decorative;
 * the drift is a transform, so reduced-motion users get a still glow.
 */
export function AccentAurora({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <m.div
        className="absolute -top-1/3 left-1/4 size-[42rem] rounded-full opacity-35 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--accent), transparent)" }}
        animate={{ x: [0, 80, -40], y: [0, 40, 10], scale: [1, 1.12, 0.96] }}
        transition={drift}
      />
      <m.div
        className="absolute -top-1/4 -right-1/4 size-[32rem] rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--accent), transparent)" }}
        animate={{ x: [0, -60, 20], y: [0, 60, -20], scale: [1, 0.9, 1.08] }}
        transition={{ ...drift, duration: 23 }}
      />
    </div>
  );
}
