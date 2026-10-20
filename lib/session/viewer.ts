import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { loadProfileDataset, type ProfileDataset } from "@/lib/data/dataset";
import { db } from "@/lib/db";
import { memberships, threadsProfiles, threadsTokens, wallets, workspaces } from "@/lib/db/schema";
import { generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS, type DemoPersona, isDemoPersonaId } from "@/lib/demo/personas";
import { env } from "@/lib/env";
import { GOAL_COOKIE, type Goal, isGoal } from "@/lib/goals";
import { DEMO_COOKIE, SESSION_COOKIE } from "./cookies";
import { readSessionUserId } from "./session";

export interface ViewerProfile {
  id: string;
  username: string;
  name: string;
  isVerified: boolean;
  profilePictureUrl: string | null;
  avatarHue: number;
}

interface ViewerBase {
  profile: ViewerProfile;
  goal: Goal;
  credits: number;
  timezone: string;
  data: ProfileDataset;
  now: Date;
}

export interface DemoViewer extends ViewerBase {
  kind: "demo";
  persona: DemoPersona;
}

export interface AccountViewer extends ViewerBase {
  kind: "account";
  userId: string;
  workspaceId: string;
  billingMode: "credits" | "byok";
  /** False after the user revokes access in Threads; they need to reconnect. */
  connected: boolean;
  lastSyncedAt: Date | null;
}

/** Whoever is using the app: a demo visitor or a signed-in Threads account. */
export type Viewer = DemoViewer | AccountViewer;

/** Stable hue per username for initials avatars. */
export function hueFor(username: string): number {
  let h = 0;
  for (const char of username) h = (h * 31 + char.charCodeAt(0)) % 360;
  return h;
}

/** Reads the request's cookies, so call it inside a <Suspense> boundary. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const store = await cookies();
  const sessionToken = store.get(SESSION_COOKIE)?.value;
  const personaId = store.get(DEMO_COOKIE)?.value;
  const goalCookie = store.get(GOAL_COOKIE)?.value;
  if (!sessionToken && !isDemoPersonaId(personaId)) return null;

  // Viewer data is relative to "now", which session prefetches can't know,
  // so wait for the real request before reading the clock.
  await connection();
  const now = new Date();

  if (sessionToken && env.DATABASE_URL) {
    const account = await loadAccountViewer(sessionToken, now);
    if (account) return account;
  }
  if (!isDemoPersonaId(personaId)) return null;

  const persona = DEMO_PERSONAS[personaId];
  return {
    kind: "demo",
    persona,
    profile: { ...persona.profile, avatarHue: persona.avatarHue },
    goal: isGoal(goalCookie) ? goalCookie : persona.defaultGoal,
    credits: persona.credits,
    timezone: persona.timezone,
    data: generateDemoDataset(persona, now),
    now,
  };
});

async function loadAccountViewer(sessionToken: string, now: Date): Promise<AccountViewer | null> {
  const userId = await readSessionUserId(sessionToken);
  if (!userId) return null;

  const [row] = await db()
    .select({
      workspaceId: workspaces.id,
      billingMode: workspaces.billingMode,
      balance: wallets.balance,
      profile: threadsProfiles,
      tokenExpiresAt: threadsTokens.expiresAt,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .innerJoin(threadsProfiles, eq(threadsProfiles.workspaceId, workspaces.id))
    .leftJoin(wallets, eq(wallets.workspaceId, workspaces.id))
    .leftJoin(threadsTokens, eq(threadsTokens.profileId, threadsProfiles.id))
    .where(eq(memberships.userId, userId))
    .orderBy(threadsProfiles.createdAt)
    .limit(1);
  if (!row) return null;

  const { profile } = row;
  const threadsProfile = {
    id: profile.id,
    username: profile.username,
    name: profile.name ?? profile.username,
    biography: profile.biography ?? "",
    profilePictureUrl: profile.profilePictureUrl,
    isVerified: profile.isVerified,
  };
  return {
    kind: "account",
    userId,
    workspaceId: row.workspaceId,
    billingMode: row.billingMode,
    connected: row.tokenExpiresAt !== null && row.tokenExpiresAt > now,
    lastSyncedAt: profile.lastSyncedAt,
    profile: { ...threadsProfile, avatarHue: hueFor(profile.username) },
    goal: profile.activeGoal,
    credits: Number(row.balance ?? 0),
    timezone: profile.timezone,
    data: await loadProfileDataset(threadsProfile, now),
    now,
  };
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/");
  return viewer;
}
