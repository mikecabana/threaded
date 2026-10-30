"use client";

import { Check, LoaderCircle } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import type { ProgressStep } from "@/lib/ai/progress";

/**
 * A batch's steps, one per line: a spinner on the one running, a check and
 * what it did on the ones finished (lib/ai/progress.ts). A thin line joins
 * the icons, so it reads as a timeline.
 */
export function ProgressTimeline({ steps }: { steps: ProgressStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label="Progress" className="mb-4 space-y-2 text-sm">
      <AnimatePresence initial={false}>
        {steps.map((step, index) => (
          <m.li
            key={step.id}
            layout="position"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative flex items-start gap-2 ${
              index < steps.length - 1
                ? "before:absolute before:top-5 before:-bottom-2 before:left-[7.5px] before:w-px before:bg-border-strong"
                : ""
            }`}
          >
            {step.state === "active" ? (
              <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-muted" aria-hidden />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            )}
            <span className={step.state === "active" ? "text-muted" : "text-subtle"}>{step.text}</span>
          </m.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
