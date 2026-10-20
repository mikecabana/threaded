"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_PERSONAS, isDemoPersonaId } from "@/lib/demo/personas";
import { GOAL_COOKIE } from "@/lib/goals";
import { DEMO_COOKIE } from "@/lib/session/cookies";

const cookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 7,
};

/** Starts (or switches) a demo session. Form field `persona` picks the account. */
export async function startDemoAction(formData: FormData): Promise<void> {
  const requested = formData.get("persona");
  const personaId = isDemoPersonaId(requested) ? requested : "creator";
  const store = await cookies();
  store.set(DEMO_COOKIE, personaId, { ...cookieOptions, httpOnly: true });
  // Each persona opens on the goal it's best at; the user can switch from there.
  store.set(GOAL_COOKIE, DEMO_PERSONAS[personaId].defaultGoal, cookieOptions);
  redirect("/home");
}

export async function exitDemoAction(): Promise<void> {
  (await cookies()).delete(DEMO_COOKIE);
  redirect("/");
}
