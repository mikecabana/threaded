"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GoalFitRing } from "@/components/goal/goal-fit-ring";
import { GoalIcon } from "@/components/goal/goal-icon";
import { AccentAurora } from "@/components/motion/accent-aurora";
import { revealSpring } from "@/components/motion/springs";
import { ThreadLine } from "@/components/motion/thread-line";
import { type PostAuthor, PostPreview } from "@/components/threads/post-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { GOAL_META, GOALS, type Goal } from "@/lib/goals";
import type { PostInsights } from "@/lib/threads/types";
import { DemoButton } from "./demo-button";

export interface HeroSample {
  text: string;
  rationale: string;
  goalFit: number;
  format: string;
}

const CHIPS: Record<Goal, string[]> = {
  followers: ["+62 followers this week", "Series → follows", "2.1× reposts"],
  views: ["2.8× your median views", "Best slot: Tue 9 AM", "Quoted 14 times"],
  engagement: ["49 replies", "Questions get 3× replies", "6.3% engagement"],
};

const GOAL_OPTIONS = GOALS.map((id) => ({
  value: id,
  label: GOAL_META[id].label,
  icon: <GoalIcon goal={id} />,
}));

const CHIP_POSITIONS = ["-left-4 top-24 sm:-left-12", "-right-3 top-[44%] sm:-right-10", "left-6 -bottom-5 sm:left-14"];

export function Hero({
  author,
  topPost,
  samples,
}: {
  author: PostAuthor;
  topPost: { text: string; insights: PostInsights };
  samples: Record<Goal, HeroSample>;
}) {
  const reduce = useReducedMotion();
  const [goal, setGoal] = useState<Goal>("engagement");
  const [touched, setTouched] = useState(false);

  // Gently cycle the goals until the visitor picks one (never for reduced motion).
  useEffect(() => {
    if (touched || reduce) return;
    const id = window.setInterval(() => setGoal((g) => GOALS[(GOALS.indexOf(g) + 1) % GOALS.length]), 4200);
    return () => window.clearInterval(id);
  }, [touched, reduce]);

  const sample = samples[goal];

  return (
    <section data-goal={goal} className="relative isolate overflow-hidden">
      <AccentAurora className="-z-10" />
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-16 pb-24 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
        <div>
          <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={revealSpring}>
            <Badge variant="outline" className="mb-6">
              For Threads creators and brands
            </Badge>
            <h1 className="text-balance font-semibold text-4xl leading-[1.05] tracking-tight sm:text-6xl">
              Grow on Threads with posts that sound like{" "}
              <span className="font-display font-normal text-accent italic">you</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted leading-relaxed">
              Threaded reads your posts and insights, learns what your audience rewards, and writes ideas aimed at the
              goal you pick. Post or schedule them without leaving the app.
            </p>
          </m.div>

          <m.div
            className="mt-8"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...revealSpring, delay: 0.1 }}
          >
            <p className="mb-3 text-sm text-subtle">Pick a goal</p>
            <Segmented
              legend="Preview a goal"
              variant="chips"
              options={GOAL_OPTIONS}
              value={goal}
              onChange={(next) => {
                setTouched(true);
                setGoal(next);
              }}
            />
          </m.div>

          <m.div
            className="mt-10 flex flex-wrap items-center gap-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...revealSpring, delay: 0.2 }}
          >
            <DemoButton size="lg" />
            <Button asChild variant="outline" size="lg">
              <Link href="/connect">Connect Threads</Link>
            </Button>
          </m.div>
        </div>

        <m.div
          className="relative mx-auto w-full max-w-md"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...revealSpring, delay: 0.15 }}
        >
          <Card className="p-5">
            <p className="mb-3 font-medium text-subtle text-xs uppercase tracking-wider">Your best post this month</p>
            <PostPreview author={author} text={topPost.text} insights={topPost.insights} meta="4d" clamp={3} />
          </Card>

          <div className="flex h-10 pl-[2.4rem]">
            <ThreadLine className="h-full bg-accent/70" delay={0.6} />
          </div>

          <Card className="relative border-accent/40 p-5 shadow-[0_20px_60px_-20px_color-mix(in_oklch,var(--accent)_45%,transparent)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-medium text-accent text-xs uppercase tracking-wider">
                Threaded suggests · {GOAL_META[goal].label}
              </p>
              <GoalFitRing value={sample.goalFit} size={40} />
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={goal}
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <PostPreview
                  author={author}
                  text={sample.text}
                  meta={<Badge variant="accent">{sample.format}</Badge>}
                />
                <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-muted text-sm">
                  <span className="font-medium text-fg">Why: </span>
                  {sample.rationale}
                </p>
              </m.div>
            </AnimatePresence>
          </Card>

          <AnimatePresence mode="popLayout" initial={false}>
            {CHIPS[goal].map((chip, i) => (
              <m.div
                key={`${goal}-${chip}`}
                aria-hidden
                className={`absolute ${CHIP_POSITIONS[i]} hidden rounded-full border border-border-strong bg-surface/90 px-3 py-1.5 font-medium text-fg text-xs shadow-lg backdrop-blur sm:block`}
                initial={{ opacity: 0, scale: 0.6, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.25 + i * 0.12 }}
              >
                <span className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />
                {chip}
              </m.div>
            ))}
          </AnimatePresence>
        </m.div>
      </div>
    </section>
  );
}
