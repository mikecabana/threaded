import "server-only";
import { start } from "workflow/api";
import { initialSync, refreshSync } from "@/workflows/sync";
import { hasActiveSyncRun } from "./sync";

/**
 * Starts a sync unless one is already running for the profile. The first sync
 * reads a year of history; later ones only refresh recent data.
 */
export async function startSync(profileId: string, mode: "initial" | "daily" | "manual"): Promise<boolean> {
  if (await hasActiveSyncRun(profileId)) return false;
  if (mode === "initial") await start(initialSync, [profileId]);
  else await start(refreshSync, [profileId, mode]);
  return true;
}
