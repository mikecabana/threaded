import type { syncRuns } from "@/lib/db/schema";

/** What the client sees of a sync run (no internals, no error details). */
export interface SyncStatus {
  status: "idle" | "running" | "succeeded" | "failed";
  step: string | null;
  stats: Record<string, number> | null;
}

export function toSyncStatus(run: typeof syncRuns.$inferSelect | null): SyncStatus {
  if (!run) return { status: "idle", step: null, stats: null };
  return { status: run.status, step: run.step, stats: (run.stats as Record<string, number> | null) ?? null };
}
