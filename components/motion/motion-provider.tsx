"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { uiSpring } from "./springs";

const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

/**
 * App-wide motion setup. `strict` makes any accidental `motion.*` import throw,
 * so components use the lightweight `m.*` and features load once, lazily.
 * `reducedMotion="user"` turns off transform and layout animation for people
 * who ask their OS for less motion.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={uiSpring}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
