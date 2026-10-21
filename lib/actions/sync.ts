"use server";

import { revalidatePath } from "next/cache";
import { getAccountIdentity } from "@/lib/session/identity";
import { latestSyncRun } from "@/lib/sync/sync";
import { startSync } from "@/lib/sync/trigger";

const COOLDOWN_MS = 10 * 60_000;

export type SyncNowResult = { ok: true } | { ok: false; reason: "not_signed_in" | "too_soon" | "running" };

/** "Sync now": a first sync if there's never been one, otherwise a refresh. Once per 10 minutes. */
export async function syncNowAction(): Promise<SyncNowResult> {
  const identity = await getAccountIdentity();
  if (!identity) return { ok: false, reason: "not_signed_in" };

  const last = await latestSyncRun(identity.profileId);
  if (last?.status === "succeeded" && last.finishedAt && Date.now() - last.finishedAt.getTime() < COOLDOWN_MS) {
    return { ok: false, reason: "too_soon" };
  }
  const neverSynced = !last || (last.kind === "initial" && last.status !== "succeeded");
  const started = await startSync(identity.profileId, neverSynced ? "initial" : "manual");
  if (!started) return { ok: false, reason: "running" };
  revalidatePath("/home");
  return { ok: true };
}
