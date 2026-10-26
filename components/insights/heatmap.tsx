"use client";

import { m } from "motion/react";
import { useState } from "react";
import type { HeatCell } from "@/lib/analysis/insights";
import { hourLabel, weekdayName } from "@/lib/analysis/time";
import { cn } from "@/lib/utils";

/** Monday first, the way most people read a week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Four steps of the accent, weakest to strongest; empty cells stay neutral. */
const STEPS = [22, 42, 66, 100];

const shade = (step: number) => `color-mix(in oklch, var(--accent) ${STEPS[step]}%, var(--surface-2))`;

/** Each cell's step, by its rank among the cells that have posts. */
function stepsFor(cells: HeatCell[]): Map<string, number> {
  const ranked = [...cells].sort((a, b) => a.score - b.score);
  return new Map(
    ranked.map((c, i) => [
      `${c.weekday}:${c.hour}`,
      ranked.length === 1 ? STEPS.length - 1 : Math.round((i / (ranked.length - 1)) * (STEPS.length - 1)),
    ]),
  );
}

function verdict(score: number): string {
  if (score > 0.3) return "above your usual";
  if (score < -0.3) return "below your usual";
  return "about your usual";
}

/**
 * When the author posts (weekday × hour, in their timezone) and how those
 * posts did for the goal, darker meaning better. `cascade` animates the
 * cells in diagonally, for the DNA reveal.
 */
export function Heatmap({
  cells,
  goalLabel,
  cascade = false,
}: {
  cells: HeatCell[];
  goalLabel: string;
  cascade?: boolean;
}) {
  const steps = stepsFor(cells);
  const byKey = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c]));
  const [active, setActive] = useState<HeatCell | null>(null);

  return (
    <div>
      <div className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px]">
        <span />
        {HOURS.map((h) => (
          <span key={h} className="text-center text-[9px] text-subtle leading-4">
            {h % 6 === 0 ? hourLabel(h).replace(" ", "").toLowerCase() : ""}
          </span>
        ))}
        {WEEK.map((weekday, row) => (
          <div key={weekday} className="contents">
            <span className="self-center text-[10px] text-subtle">{weekdayName(weekday)}</span>
            {HOURS.map((hour) => {
              const cell = byKey.get(`${weekday}:${hour}`);
              const step = cell ? steps.get(`${weekday}:${hour}`) : undefined;
              const label = cell
                ? `${weekdayName(weekday)} ${hourLabel(hour)}: ${cell.posts} ${cell.posts === 1 ? "post" : "posts"}, ${verdict(cell.score)}`
                : undefined;
              return (
                <m.span
                  key={hour}
                  role={cell ? "img" : undefined}
                  aria-label={label}
                  tabIndex={cell ? 0 : undefined}
                  className={cn(
                    "aspect-square rounded-[3px] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-fg",
                    cell && "cursor-default hover:scale-125",
                  )}
                  style={{ background: step === undefined ? "var(--surface-2)" : shade(step) }}
                  initial={cascade ? { opacity: 0, scale: 0.4 } : false}
                  whileInView={cascade ? { opacity: 1, scale: 1 } : undefined}
                  viewport={{ once: true }}
                  transition={{ type: "spring", stiffness: 260, damping: 22, delay: (row + hour) * 0.018 }}
                  onPointerEnter={() => cell && setActive(cell)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => cell && setActive(cell)}
                  onBlur={() => setActive(null)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-subtle text-xs">
        <p aria-live="polite" className="min-h-4">
          {active
            ? `${weekdayName(active.weekday)} ${hourLabel(active.hour)} · ${active.posts} ${active.posts === 1 ? "post" : "posts"} · ${verdict(active.score)}`
            : "Hover a square for its posts."}
        </p>
        <span className="inline-flex items-center gap-1.5">
          Weaker
          {STEPS.map((strength, i) => (
            <span key={strength} className="size-2.5 rounded-[3px]" style={{ background: shade(i) }} aria-hidden />
          ))}
          Stronger for {goalLabel}
        </span>
      </div>
    </div>
  );
}
