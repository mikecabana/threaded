"use client";

import { m, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";
import { useReveal } from "@/components/motion/scroll-reveal";
import { dayLabel, snippet, type TrendPoint } from "@/lib/analysis/insights";
import { formatMetric, type MetricFormat } from "@/lib/format";

const HEIGHT = 220;
const MARGIN = { top: 12, right: 12, bottom: 28, left: 44 };

/** Rounded tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * One metric over time, with a dot on each day the author posted (filled for
 * posts made with Threaded). A crosshair follows the pointer or the arrow
 * keys; the same values are in a table for screen readers.
 */
export function TrendChart({
  points,
  label,
  format = "compact",
  zeroBased = true,
}: {
  points: TrendPoint[];
  /** What's plotted, e.g. "Views". */
  label: string;
  format?: MetricFormat;
  /** Views start at zero; follower counts zoom to their range. */
  zeroBased?: boolean;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const reveal = useReveal();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const values = points.map((p) => p.value);
  const lo = zeroBased ? 0 : Math.min(...values);
  const hi = Math.max(...values, lo + 1);
  const pad = zeroBased ? 0 : Math.max(1, (hi - lo) * 0.1);
  const ticks = niceTicks(lo - pad, hi + pad, 3);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (i: number) => MARGIN.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => MARGIN.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${x(points.length - 1)} ${y(yMin)} L${x(0)} ${y(yMin)} Z` : "";
  const dateTicks = points.length
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (points.length - 1))).filter((v, i, a) => a.indexOf(v) === i)
    : [];
  const anyThreaded = points.some((p) => p.posts.some((post) => post.viaThreaded));

  function pick(event: PointerEvent<HTMLDivElement>) {
    if (points.length === 0 || innerW <= 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - box.left - MARGIN.left) / innerW;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))));
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    setActive((i) => Math.max(0, Math.min(points.length - 1, (i ?? points.length - 1) + delta)));
  }

  const point = active === null ? null : points[active];
  const tipLeft = active === null ? 0 : Math.min(Math.max(x(active), 90), width - 90);

  return (
    <div>
      <div ref={ref} className="relative">
        {width > 0 && (
          // A slider over the days: arrow keys move the crosshair, and the value text reads it out.
          <div
            role="slider"
            aria-label={`${label} by day`}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, points.length - 1)}
            aria-valuenow={active ?? Math.max(0, points.length - 1)}
            aria-valuetext={
              points.length
                ? `${dayLabel(points[active ?? points.length - 1].date)}: ${formatMetric(points[active ?? points.length - 1].value, format)}`
                : "No data"
            }
            tabIndex={0}
            className="touch-pan-y rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setActive(null)}
            onKeyDown={step}
            onBlur={() => setActive(null)}
          >
            <svg width={width} height={HEIGHT} className="block" aria-hidden>
              <defs>
                <linearGradient id={`${id}-wash`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} stroke="var(--border)" />
                  <text
                    x={MARGIN.left - 8}
                    y={y(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-subtle font-mono text-[10px] tabular-nums"
                  >
                    {formatMetric(t, "compact")}
                  </text>
                </g>
              ))}
              {dateTicks.map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={HEIGHT - 8}
                  textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                  className="fill-subtle text-[10px]"
                >
                  {dayLabel(points[i].date)}
                </text>
              ))}
              <path d={area} fill={`url(#${id}-wash)`} />
              <m.path
                d={line}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduce ? false : { pathLength: 0 }}
                {...reveal({ pathLength: 1 })}
                transition={{ duration: 1.2, ease: [0.65, 0, 0.35, 1] }}
              />
              {points.map((p, i) =>
                p.posts.length ? (
                  <g key={p.date}>
                    {/* A ring in the surface color keeps the dot legible where it sits on the line. */}
                    <circle cx={x(i)} cy={y(p.value)} r={6} fill="var(--surface)" />
                    <circle
                      cx={x(i)}
                      cy={y(p.value)}
                      r={3.5}
                      fill={p.posts.some((post) => post.viaThreaded) ? "var(--accent)" : "var(--surface)"}
                      stroke="var(--accent)"
                      strokeWidth={2}
                    />
                  </g>
                ) : null,
              )}
              {point && active !== null && (
                <g pointerEvents="none">
                  <line
                    x1={x(active)}
                    x2={x(active)}
                    y1={MARGIN.top}
                    y2={MARGIN.top + innerH}
                    stroke="var(--border-strong)"
                  />
                  <circle
                    cx={x(active)}
                    cy={y(point.value)}
                    r={5}
                    fill="var(--accent)"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                </g>
              )}
            </svg>
          </div>
        )}
        {point && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-xl border border-border-strong bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: tipLeft }}
            role="status"
          >
            <p className="font-mono font-semibold text-fg text-sm tabular-nums">{formatMetric(point.value, format)}</p>
            <p className="text-subtle">
              {label} · {dayLabel(point.date)}
            </p>
            {point.posts.slice(0, 2).map((post) => (
              <p key={post.id} className="mt-1.5 border-border border-t pt-1.5 text-muted leading-snug">
                {post.viaThreaded && <span className="text-accent">Posted with Threaded · </span>}“
                {snippet(post.text, 70)}”
              </p>
            ))}
          </div>
        )}
        {width === 0 && <div style={{ height: HEIGHT }} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-subtle text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full border-2 border-accent bg-surface" aria-hidden />
          Day you posted
        </span>
        {anyThreaded && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full border-2 border-accent bg-accent" aria-hidden />
            Posted with Threaded
          </span>
        )}
      </div>
      {/* sr-only on a wrapper: a table ignores width: 1px, and would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>{label} by day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">{label}</th>
              <th scope="col">Posts that day</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <td>{dayLabel(p.date)}</td>
                <td>{formatMetric(p.value, format)}</td>
                <td>{p.posts.map((post) => snippet(post.text, 50)).join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
