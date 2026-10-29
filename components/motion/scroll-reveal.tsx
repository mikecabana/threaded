"use client";

import type { TargetAndTransition, UseInViewOptions, VariantLabels } from "motion/react";
import { createContext, type ReactNode, useContext } from "react";

// Entrance animations normally play when their element scrolls into view.
// Inside the app shell the page scrolls in its own area on phones, where
// Safari doesn't report elements coming into view, so there they play as soon
// as they mount instead (and never wait on scrolling).

const ScrollReveal = createContext(true);

/** Entrance animations below play on mount rather than on scroll. */
export function PlayOnMount({ children }: { children: ReactNode }) {
  return <ScrollReveal.Provider value={false}>{children}</ScrollReveal.Provider>;
}

/** Whether entrance animations wait for their element to scroll into view. */
export function useScrollReveal(): boolean {
  return useContext(ScrollReveal);
}

type Target = TargetAndTransition | VariantLabels;

/** Motion props that play `target` on scroll into view, or on mount inside `PlayOnMount`. */
export function useReveal() {
  const onScroll = useScrollReveal();
  return (target: Target, viewport: UseInViewOptions = { once: true }) =>
    onScroll ? { whileInView: target, viewport } : { animate: target };
}
