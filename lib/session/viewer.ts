import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { type DemoDataset, generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS, type DemoPersona, isDemoPersonaId } from "@/lib/demo/personas";
import { GOAL_COOKIE, type Goal, isGoal } from "@/lib/goals";
import { DEMO_COOKIE } from "./cookies";

/**
 * Whoever is using the app. Phase 0 only has demo viewers; Phase 1 adds
 * `kind: "account"` backed by the sessions table and synced Threads data.
 */
export interface Viewer {
  kind: "demo";
  persona: DemoPersona;
  goal: Goal;
  credits: number;
  timezone: string;
  data: DemoDataset;
  now: Date;
}

/** Reads the request's cookies, so call it inside a <Suspense> boundary. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const store = await cookies();
  const personaId = store.get(DEMO_COOKIE)?.value;
  if (!isDemoPersonaId(personaId)) return null;

  const persona = DEMO_PERSONAS[personaId];
  const goalCookie = store.get(GOAL_COOKIE)?.value;
  // The viewer's data is relative to "now", which session prefetches can't
  // know, so wait for the real request before reading the clock.
  await connection();
  const now = new Date();
  return {
    kind: "demo",
    persona,
    goal: isGoal(goalCookie) ? goalCookie : persona.defaultGoal,
    credits: persona.credits,
    timezone: persona.timezone,
    data: generateDemoDataset(persona, now),
    now,
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/");
  return viewer;
}
