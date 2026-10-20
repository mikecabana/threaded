"use client";

import { useEffect } from "react";
import type { Goal } from "@/lib/goals";

/**
 * Keeps <html data-goal> in step with the viewer's saved goal after client
 * navigations (the inline script only runs on full page loads).
 */
export function GoalSync({ goal }: { goal: Goal }) {
  useEffect(() => {
    document.documentElement.dataset.goal = goal;
  }, [goal]);
  return null;
}
