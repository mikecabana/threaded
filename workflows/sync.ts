import { FatalError, RetryableError } from "workflow";
import {
  ACCOUNT_DAYS_BATCH,
  INITIAL_ACCOUNT_DAYS,
  INITIAL_HISTORY_DAYS,
  INSIGHTS_BATCH,
  REFRESH_ACCOUNT_DAYS,
  REFRESH_POST_DAYS,
  type SyncStep,
} from "@/lib/sync/constants";

// Durable sync workflows (Vercel Workflow). The workflow functions only
// orchestrate; each step loads its real implementation from lib/sync with a
// dynamic import, which keeps database, crypto and Node-only modules out of
// the workflow sandbox bundle. Steps receive ids and numbers only, so tokens
// and post text never land in the workflow event log.

/** First sync after connecting: a year of posts, their metrics, and 60 days of account insights. */
export async function initialSync(profileId: string) {
  "use workflow";
  return runSync(profileId, "initial", INITIAL_HISTORY_DAYS, INITIAL_ACCOUNT_DAYS);
}

/** Daily (cron) or on-demand refresh: new posts, fresh metrics for recent posts, the last few days. */
export async function refreshSync(profileId: string, kind: "daily" | "manual" = "daily") {
  "use workflow";
  return runSync(profileId, kind, REFRESH_POST_DAYS, REFRESH_ACCOUNT_DAYS);
}

async function runSync(profileId: string, kind: "initial" | "daily" | "manual", postDays: number, accountDays: number) {
  const runId = await startRun(profileId, kind);
  try {
    await refreshProfile(profileId);
    const listed = await listPosts(profileId, postDays);
    // Refreshes re-measure everything recent, not just what's new.
    const postIds = kind === "initial" ? listed : await recentPosts(profileId);

    await markStep(runId, "insights", { posts: listed.length });
    let measured = 0;
    for (let i = 0; i < postIds.length; i += INSIGHTS_BATCH) {
      measured += await measurePosts(profileId, postIds.slice(i, i + INSIGHTS_BATCH));
      await markStep(runId, "insights", { posts: listed.length, measured });
    }

    await markStep(runId, "account", { posts: listed.length, measured });
    let days = 0;
    for (let start = 0; start < accountDays; start += ACCOUNT_DAYS_BATCH) {
      days += await measureAccountDays(profileId, accountDays, start, ACCOUNT_DAYS_BATCH);
    }

    const stats = { posts: listed.length, measured, days };
    await finishRun(runId, profileId, true, stats);
    return stats;
  } catch (error) {
    await finishRun(runId, profileId, false, {}, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// ── Steps ────────────────────────────────────────────────────────────────────

/** Maps sync failures onto workflow retry semantics. */
async function classify(error: unknown): Promise<never> {
  const { NotConnectedError } = await import("@/lib/sync/client");
  const { ThreadsApiError } = await import("@/lib/threads/errors");
  if (error instanceof NotConnectedError) throw new FatalError(error.message);
  if (error instanceof ThreadsApiError && error.isAuthError) throw new FatalError("Threads access was revoked.");
  if (error instanceof ThreadsApiError && error.isRateLimited) {
    throw new RetryableError("Threads rate limit reached.", { retryAfter: "15m" });
  }
  throw error;
}

async function startRun(profileId: string, kind: "initial" | "daily" | "manual") {
  "use step";
  const { startSyncRun } = await import("@/lib/sync/sync");
  return startSyncRun(profileId, kind);
}

async function markStep(runId: string, step: SyncStep, stats: Record<string, number>) {
  "use step";
  const { setSyncStep } = await import("@/lib/sync/sync");
  await setSyncStep(runId, step, stats);
}

async function finishRun(runId: string, profileId: string, ok: boolean, stats: Record<string, number>, error = "") {
  "use step";
  const { finishSyncRun } = await import("@/lib/sync/sync");
  await finishSyncRun(runId, profileId, ok ? { ok: true, stats } : { ok: false, error });
}

async function refreshProfile(profileId: string) {
  "use step";
  const { syncProfile } = await import("@/lib/sync/sync");
  await syncProfile(profileId).catch(classify);
}

async function listPosts(profileId: string, sinceDays: number) {
  "use step";
  const { syncPosts } = await import("@/lib/sync/sync");
  return syncPosts(profileId, sinceDays).catch(classify);
}

async function recentPosts(profileId: string) {
  "use step";
  const { recentPostIds } = await import("@/lib/sync/sync");
  return recentPostIds(profileId);
}

async function measurePosts(profileId: string, postIds: string[]) {
  "use step";
  const { syncPostInsights } = await import("@/lib/sync/sync");
  return syncPostInsights(profileId, postIds).catch(classify);
}

async function measureAccountDays(profileId: string, total: number, start: number, count: number) {
  "use step";
  const { recentDays, syncAccountDays } = await import("@/lib/sync/sync");
  return syncAccountDays(profileId, recentDays(total).slice(start, start + count)).catch(classify);
}
