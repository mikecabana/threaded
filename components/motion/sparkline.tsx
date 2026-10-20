"use client";

import { m, useReducedMotion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

const W = 100;
const H = 32;

function toPoints(values: number[]): [number, number][] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  // 2px of headroom top and bottom so the stroke never clips.
  return values.map((v, i) => [i * step, H - 2 - ((v - min) / span) * (H - 4)]);
}

/** Smooth path through the points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M0 ${points[0][1]} L${W} ${points[0][1]}`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const id = useId();
  const reduce = useReducedMotion();
  const line = smoothPath(toPoints(values));
  const area = line ? `${line} L${W} ${H} L0 ${H} Z` : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-10 w-full overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <m.path
        d={area}
        fill={`url(#${id}-fill)`}
        initial={reduce ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.5 }}
      />
      <m.path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.75}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        initial={reduce ? false : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
      />
    </svg>
  );
}
