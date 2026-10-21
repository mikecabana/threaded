"use server";

import { cookies } from "next/headers";
import { GOAL_COOKIE, isGoal } from "@/lib/goals";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Persists the active goal. The cookie is readable by the inline preferences
 * script so the accent is right on first paint. (Phase 1 also stores it on the
 * Threads profile row.)
 */
export async function setGoalAction(goal: string): Promise<void> {
  if (!isGoal(goal)) throw new Error(`Unknown goal: ${goal}`);
  (await cookies()).set(GOAL_COOKIE, goal, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
