"use client";

import { m, type Variants } from "motion/react";
import type { ComponentProps } from "react";
import { useReveal } from "./scroll-reveal";
import { revealSpring } from "./springs";

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: revealSpring },
};

type DivProps = Omit<ComponentProps<typeof m.div>, "variants" | "initial" | "whileInView" | "animate" | "viewport">;

const VIEWPORT = { once: true, margin: "0px 0px -8% 0px" } as const;

/** Fades and lifts its content in the first time it scrolls into view (or mounts, in the app shell). */
export function Reveal({ delay = 0, ...props }: DivProps & { delay?: number }) {
  const reveal = useReveal();
  return (
    <m.div
      initial={{ opacity: 0, y: 14 }}
      {...reveal({ opacity: 1, y: 0 }, VIEWPORT)}
      transition={{ ...revealSpring, delay }}
      {...props}
    />
  );
}

/**
 * Staggers its `StaggerItem` children in, one after another. Items added after
 * the reveal has played stay hidden, so key the Stagger by the data it shows.
 */
export function Stagger({ stagger = 0.07, delay = 0, ...props }: DivProps & { stagger?: number; delay?: number }) {
  const reveal = useReveal();
  return (
    <m.div
      initial="hidden"
      {...reveal("show", VIEWPORT)}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
      {...props}
    />
  );
}

export function StaggerItem(props: DivProps) {
  return <m.div variants={itemVariants} {...props} />;
}
