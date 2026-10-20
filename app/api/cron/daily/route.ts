import { safeEqual } from "@/lib/crypto/sign";
import { db } from "@/lib/db";
import { threadsTokens } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { startSync } from "@/lib/sync/trigger";

/**
 * Vercel Cron (vercel.json, 06:00 UTC): starts a refresh for every connected
 * profile. Each refresh is its own durable workflow run, so one slow or failing
 * account doesn't hold up the rest.
 */
export async function GET(request: Request) {
  const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
  const given = request.headers.get("authorization") ?? "";
  if (!expected || !safeEqual(given, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const profiles = await db().select({ profileId: threadsTokens.profileId }).from(threadsTokens);
  let started = 0;
  for (const { profileId } of profiles) {
    try {
      if (await startSync(profileId, "daily")) started++;
    } catch (error) {
      console.error(`Could not start the daily sync for ${profileId}`, error);
    }
  }
  return Response.json({ profiles: profiles.length, started });
}
