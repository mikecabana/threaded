import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threadsProfiles, threadsTokens } from "@/lib/db/schema";
import { alertProfile } from "@/lib/email/alerts";
import { emailOrigin } from "@/lib/email/send";
import { reconnectSoonEmail } from "@/lib/email/templates";
import { clientForProfile } from "./client";

// Threads' permission grants last 90 days. Refreshing the token extends them
// for public profiles, but private profiles have to approve the app again
// (docs/PLAN.md §2). Threads doesn't say which kind a profile is, so from day
// 60 of a grant the daily sync asks Threads when access ends (debug_token) and
// emails a reminder in the last week.

const DAY_MS = 86_400_000;
/** No grant can lapse before 90 days; start checking with a margin. */
const CHECK_AFTER_DAYS = 60;
/** Re-check weekly while the end is far off. */
const RECHECK_DAYS = 7;
/** Remind this close to the end. */
export const REMIND_DAYS = 7;

export async function checkDataAccess(profileId: string, now = new Date()): Promise<"skipped" | "ok" | "reminded"> {
  try {
    const [row] = await db()
      .select({
        grantedAt: threadsTokens.grantedAt,
        expiresAt: threadsTokens.dataAccessExpiresAt,
        checkedAt: threadsTokens.accessCheckedAt,
        username: threadsProfiles.username,
        timezone: threadsProfiles.timezone,
      })
      .from(threadsTokens)
      .innerJoin(threadsProfiles, eq(threadsProfiles.id, threadsTokens.profileId))
      .where(eq(threadsTokens.profileId, profileId));
    if (!row || now.getTime() - row.grantedAt.getTime() < CHECK_AFTER_DAYS * DAY_MS) return "skipped";

    let expiresAt = row.expiresAt;
    const farOff = expiresAt && expiresAt.getTime() - now.getTime() > 2 * REMIND_DAYS * DAY_MS;
    const recent = row.checkedAt && now.getTime() - row.checkedAt.getTime() < RECHECK_DAYS * DAY_MS;
    if (!(farOff && recent)) {
      try {
        expiresAt = await (await clientForProfile(profileId, now)).getDataAccessExpiry();
      } catch (error) {
        // Meta documents debug_token for testers' tokens; without an answer there's no reminder.
        console.warn(
          `Couldn't read data access expiry for ${profileId}`,
          error instanceof Error ? error.message : error,
        );
      }
      await db()
        .update(threadsTokens)
        .set({ dataAccessExpiresAt: expiresAt, accessCheckedAt: now })
        .where(eq(threadsTokens.profileId, profileId));
    }

    const left = expiresAt ? expiresAt.getTime() - now.getTime() : Infinity;
    if (!expiresAt || left <= 0 || left > REMIND_DAYS * DAY_MS) return "ok";
    const lapsesOn = expiresAt.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: row.timezone,
    });
    await alertProfile(profileId, "reconnect_soon", `${profileId}:${expiresAt.toISOString().slice(0, 10)}`, () =>
      reconnectSoonEmail({ username: row.username, lapsesOn, url: `${emailOrigin()}/api/auth/threads/start` }),
    );
    return "reminded";
  } catch (error) {
    console.error(`Data access check failed for ${profileId}`, error);
    return "skipped";
  }
}
