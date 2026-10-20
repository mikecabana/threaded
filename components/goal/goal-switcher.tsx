"use client";

import { useState, useTransition } from "react";
import { Segmented } from "@/components/ui/segmented";
import { setGoalAction } from "@/lib/actions/preferences";
import { GOAL_META, GOALS, type Goal } from "@/lib/goals";
import { GoalIcon } from "./goal-icon";

const OPTIONS = GOALS.map((id) => ({ value: id, label: GOAL_META[id].short, icon: <GoalIcon goal={id} /> }));

/**
 * The active goal. Switching re-themes the app at once (the accent is a
 * registered CSS property, so it morphs) and persists in the background; the
 * server action's refresh then re-renders goal-specific data.
 */
export function GoalSwitcher({ initialGoal, className }: { initialGoal: Goal; className?: string }) {
  const [goal, setGoal] = useState(initialGoal);
  const [, startTransition] = useTransition();

  function choose(next: Goal) {
    setGoal(next);
    document.documentElement.dataset.goal = next;
    startTransition(() => setGoalAction(next));
  }

  return (
    <Segmented
      legend="Growth goal"
      options={OPTIONS}
      value={goal}
      onChange={choose}
      labelsFrom="sm"
      className={className}
    />
  );
}
