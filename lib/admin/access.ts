import "server-only";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { getAccountIdentity } from "@/lib/session/identity";

// Who can use /admin: users marked is_staff, or whose Threads user id is in
// ADMIN_THREADS_USER_IDS. Everyone else gets a 404, so the area doesn't
// announce itself. Every admin page and action checks again.

export function staffIdsFromEnv(raw = env.ADMIN_THREADS_USER_IDS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export interface Staff {
  userId: string;
  threadsUserId: string;
}

/** The signed-in staff member, or null. */
export async function currentStaff(): Promise<Staff | null> {
  const identity = await getAccountIdentity();
  if (!identity) return null;
  const [user] = await db()
    .select({ threadsUserId: users.threadsUserId, isStaff: users.isStaff })
    .from(users)
    .where(eq(users.id, identity.userId));
  if (!user || !(user.isStaff || staffIdsFromEnv().has(user.threadsUserId))) return null;
  return { userId: identity.userId, threadsUserId: user.threadsUserId };
}

/** For admin pages and actions: the staff member, or a 404. */
export async function requireStaff(): Promise<Staff> {
  const staff = await currentStaff();
  if (!staff) notFound();
  return staff;
}
