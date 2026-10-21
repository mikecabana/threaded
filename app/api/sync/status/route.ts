import { getAccountIdentity } from "@/lib/session/identity";
import { toSyncStatus } from "@/lib/sync/status";
import { latestSyncRun } from "@/lib/sync/sync";

/** Progress of the signed-in profile's latest sync, polled by the first-sync screen. */
export async function GET() {
  const identity = await getAccountIdentity();
  if (!identity) return Response.json({ error: "not signed in" }, { status: 401 });
  const run = await latestSyncRun(identity.profileId);
  return Response.json(toSyncStatus(run), { headers: { "cache-control": "no-store" } });
}
