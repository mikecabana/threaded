import type { Transition } from "motion/react";

/** Default for UI interactions: quick, no visible overshoot. */
export const uiSpring: Transition = { type: "spring", stiffness: 400, damping: 32 };

/** For reveals and the few choreographed moments: slower, a little bounce. */
export const revealSpring: Transition = { type: "spring", stiffness: 120, damping: 20 };

/** Gentle spring for numbers and paths. */
export const softSpring: Transition = { type: "spring", stiffness: 60, damping: 18 };
