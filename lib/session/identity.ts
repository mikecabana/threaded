import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { memberships, threadsProfiles } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { SESSION_COOKIE } from "./cookies";
import { readSessionUserId } from "./session";

export interface AccountIdentity {
  userId: string;
  workspaceId: string;
  profileId: string;
}

/**
 * Who's signed in, without loading their data: for Route Handlers and
 * Server Actions that only need ids. Null for demo visitors and signed-out users.
 */
export async function getAccountIdentity(): Promise<AccountIdentity | null> {
  if (!env.DATABASE_URL) return null;
  const userId = await readSessionUserId((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const [row] = await db()
    .select({ workspaceId: memberships.workspaceId, profileId: threadsProfiles.id })
    .from(memberships)
    .innerJoin(threadsProfiles, eq(threadsProfiles.workspaceId, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(threadsProfiles.createdAt)
    .limit(1);
  return row ? { userId, ...row } : null;
}
