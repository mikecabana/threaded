import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threadsProfiles } from "@/lib/db/schema";
import { getAccountIdentity } from "@/lib/session/identity";
import { toSyncStatus } from "@/lib/sync/status";
import { latestSyncRun } from "@/lib/sync/sync";

/** Progress of the signed-in profile's latest sync, polled by The Read. */
export async function GET() {
  const identity = await getAccountIdentity();
  if (!identity) return Response.json({ error: "not signed in" }, { status: 401 });
  const [run, [profile]] = await Promise.all([
    latestSyncRun(identity.profileId),
    db()
      .select({ topics: threadsProfiles.topics })
      .from(threadsProfiles)
      .where(eq(threadsProfiles.id, identity.profileId)),
  ]);
  const topics = profile?.topics?.list.map((t) => t.name) ?? [];
  return Response.json(toSyncStatus(run, topics), { headers: { "cache-control": "no-store" } });
}
