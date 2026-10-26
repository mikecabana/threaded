import type { syncRuns } from "@/lib/db/schema";

/** What the client sees of a sync run (no internals, no error details). */
export interface SyncStatus {
  status: "idle" | "running" | "succeeded" | "failed";
  step: string | null;
  stats: Record<string, number> | null;
  /** The author's topics once they've been named, for The Read. */
  topics?: string[];
}

export function toSyncStatus(run: typeof syncRuns.$inferSelect | null, topics: string[] = []): SyncStatus {
  if (!run) return { status: "idle", step: null, stats: null, topics };
  return {
    status: run.status,
    step: run.step,
    stats: (run.stats as Record<string, number> | null) ?? null,
    topics,
  };
}
