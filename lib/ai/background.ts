import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threadsProfiles, workspaces } from "@/lib/db/schema";
import { isAiConfigured, type ResolvedModel, resolveModel } from "./models";

// Background AI (classification and Profile DNA) runs inside the sync
// workflows. On credits it's on us, on the task's default model (docs/PLAN.md
// §6); with the workspace's own key, it runs on that key. It's enrichment:
// when it can't run, the sync carries on without it.

export interface BackgroundModel {
  resolved: ResolvedModel;
  profile: typeof threadsProfiles.$inferSelect;
}

/** The model for a background task, or null when no model is reachable. */
export async function backgroundModel(profileId: string, task: "classify" | "dna"): Promise<BackgroundModel | null> {
  const [row] = await db()
    .select({ workspace: workspaces, profile: threadsProfiles })
    .from(threadsProfiles)
    .innerJoin(workspaces, eq(workspaces.id, threadsProfiles.workspaceId))
    .where(eq(threadsProfiles.id, profileId));
  if (!row) return null;
  const ownKey = row.workspace.billingMode === "byok" && row.workspace.byokKeyEnc !== null;
  if (!ownKey && !isAiConfigured()) {
    logNoGateway(task === "dna" ? "Profile DNA" : "Topic discovery");
    return null;
  }
  return { resolved: await resolveModel({ task, workspace: row.workspace }), profile: row.profile };
}

/** A skipped run says why, so a missing credential never passes for "nothing to do". */
export function logNoGateway(what: string) {
  console.warn(`${what} skipped: the AI Gateway has no credential (AI_GATEWAY_API_KEY or the Vercel OIDC token).`);
}

/** Logs a failed background call without its payload (which can include post text). */
export function logBackgroundFailure(what: string, profileId: string, error: unknown) {
  console.error(`${what} failed for profile ${profileId}: ${error instanceof Error ? error.message : String(error)}`);
}
