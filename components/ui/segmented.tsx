"use client";

import { LayoutGroup, m } from "motion/react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

const VARIANTS = {
  /** Options inside one pill-shaped track (goal switcher, theme toggle). */
  track: {
    root: "inline-flex rounded-full border border-border bg-surface p-1",
    option: "h-8 px-3 text-sm",
    idle: "text-muted hover:text-fg",
    active: "text-accent-ink",
    pill: "bg-accent",
  },
  /** Separate chips that wrap (landing page goal picker). */
  chips: {
    root: "flex flex-wrap gap-2",
    option: "h-10 border border-border-strong px-4 text-sm",
    idle: "text-muted hover:text-fg",
    active: "border-transparent text-accent-ink",
    pill: "bg-accent",
  },
} as const;

/**
 * Single-choice control built on native radio inputs (so arrow keys, focus and
 * screen readers work for free) with a spring-animated selection pill.
 */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  variant = "track",
  iconOnly = false,
  labelsFrom,
  activeClassName,
  pillClassName,
  className,
}: {
  legend: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: keyof typeof VARIANTS;
  /** Hide labels visually (they stay available to screen readers). */
  iconOnly?: boolean;
  /** Show labels only from this breakpoint up. */
  labelsFrom?: "sm" | "md";
  activeClassName?: string;
  pillClassName?: string;
  className?: string;
}) {
  const name = useId();
  const styles = VARIANTS[variant];
  return (
    <LayoutGroup id={name}>
      <fieldset className={cn(styles.root, className)}>
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <label
              key={option.value}
              title={iconOnly ? option.label : undefined}
              className={cn(
                "relative flex cursor-pointer select-none items-center justify-center gap-1.5 rounded-full font-medium transition-colors",
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-offset-2",
                styles.option,
                iconOnly && "size-8 px-0",
                active ? (activeClassName ?? styles.active) : styles.idle,
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {active && (
                <m.span
                  aria-hidden
                  layoutId="segment-pill"
                  className={cn("absolute inset-0 rounded-full", pillClassName ?? styles.pill)}
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
              {option.icon && <span className="relative flex [&_svg]:size-4">{option.icon}</span>}
              {/* Outer span stacks above the pill; sr-only can't share it because it sets position too. */}
              <span className="relative">
                <span
                  className={cn(
                    iconOnly && "sr-only",
                    labelsFrom === "sm" && "sr-only sm:not-sr-only",
                    labelsFrom === "md" && "sr-only md:not-sr-only",
                  )}
                >
                  {option.label}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </LayoutGroup>
  );
}
