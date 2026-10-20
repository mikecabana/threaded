"use client";

import { useInView, useMotionValueEvent, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useRef } from "react";
import { formatMetric, type MetricFormat } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CountUpProps {
  value: number;
  format?: MetricFormat;
  from?: number;
  className?: string;
}

/**
 * Springs a number up to `value` when it scrolls into view, and between values
 * when it changes. Screen readers get the final value only.
 */
export function CountUp({ value, format = "number", from = 0, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const spring = useSpring(from, { stiffness: 70, damping: 20, restDelta: 0.001 });

  useEffect(() => {
    if (!inView) return;
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [inView, reduce, spring, value]);

  useMotionValueEvent(spring, "change", (latest) => {
    if (ref.current) ref.current.textContent = formatMetric(latest, format);
  });

  return (
    <span className={cn("tabular", className)}>
      <span ref={ref} aria-hidden>
        {formatMetric(from, format)}
      </span>
      <span className="sr-only">{formatMetric(value, format)}</span>
    </span>
  );
}
