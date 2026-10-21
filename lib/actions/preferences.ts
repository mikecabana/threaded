"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { threadsProfiles } from "@/lib/db/schema";
import { GOAL_COOKIE, isGoal } from "@/lib/goals";
import { getViewer } from "@/lib/session/viewer";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Persists the active goal: on the Threads profile for real accounts, and in a
 * cookie the inline preferences script reads so the accent is right on first paint.
 */
export async function setGoalAction(goal: string): Promise<void> {
  if (!isGoal(goal)) throw new Error(`Unknown goal: ${goal}`);
  const viewer = await getViewer();
  if (!viewer) throw new Error("Not signed in.");
  if (viewer.kind === "account") {
    await db().update(threadsProfiles).set({ activeGoal: goal }).where(eq(threadsProfiles.id, viewer.profile.id));
  }
  (await cookies()).set(GOAL_COOKIE, goal, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
