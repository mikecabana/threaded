import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailLog, memberships, threadsProfiles, users } from "@/lib/db/schema";
import { deliver } from "./send";
import type { EmailContent } from "./templates";

// Alerts go to everyone in the workspace with a confirmed address, once per
// (kind, ref): the email log's unique key is claimed before sending, so the
// same failure seen twice (a retried step, a second webhook) emails once.
// Best effort: a failure is logged and never breaks what triggered it.

export type AlertKind = "post_failed" | "recharge_declined" | "plan_lapsed" | "reconnect_soon";

/** Claims (user, kind, ref) in the email log; false when it was already claimed. */
async function claim(userId: string, kind: string, ref: string): Promise<string | null> {
  const [row] = await db()
    .insert(emailLog)
    .values({ userId, kind, ref })
    .onConflictDoNothing()
    .returning({ id: emailLog.id });
  return row?.id ?? null;
}

/** Sends one email to one user, once per (kind, ref). Returns whether it went out (or was logged). */
export async function emailUserOnce(
  user: { id: string; email: string },
  kind: string,
  ref: string,
  content: EmailContent,
): Promise<boolean> {
  const logId = await claim(user.id, kind, ref);
  if (!logId) return false;
  const delivery = await deliver(user.email, content, { kind, idempotencyKey: logId });
  if (delivery.status === "failed") {
    console.error(`Email "${kind}" failed: ${delivery.error}`);
    // Free the claim, so the next time the event is seen it's tried again.
    await db().delete(emailLog).where(eq(emailLog.id, logId));
    return false;
  }
  await db()
    .update(emailLog)
    .set({ status: delivery.status, providerId: delivery.status === "sent" ? delivery.id : null })
    .where(eq(emailLog.id, logId));
  return true;
}

/** Workspace members with a confirmed address. */
async function recipients(workspaceId: string) {
  const rows = await db()
    .select({ id: users.id, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), isNotNull(users.emailVerifiedAt), isNotNull(users.email)));
  return rows.flatMap((r) => (r.email ? [{ id: r.id, email: r.email }] : []));
}

/** Emails the workspace's members about an event, once each. Never throws; returns how many went out. */
export async function alertWorkspace(
  workspaceId: string,
  kind: AlertKind,
  ref: string,
  content: () => EmailContent,
): Promise<number> {
  try {
    let sent = 0;
    for (const user of await recipients(workspaceId)) {
      if (await emailUserOnce(user, kind, ref, content())) sent++;
    }
    return sent;
  } catch (error) {
    console.error(`Alert "${kind}" failed for workspace ${workspaceId}`, error);
    return 0;
  }
}

/** The same, for the workspace a Threads profile belongs to. */
export async function alertProfile(
  profileId: string,
  kind: AlertKind,
  ref: string,
  content: () => EmailContent,
): Promise<number> {
  try {
    const [profile] = await db()
      .select({ workspaceId: threadsProfiles.workspaceId })
      .from(threadsProfiles)
      .where(eq(threadsProfiles.id, profileId));
    return profile ? alertWorkspace(profile.workspaceId, kind, ref, content) : 0;
  } catch (error) {
    console.error(`Alert "${kind}" failed for profile ${profileId}`, error);
    return 0;
  }
}
