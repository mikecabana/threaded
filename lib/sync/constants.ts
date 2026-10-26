// Sync tuning, shared by the workflows (which must stay free of server-only
// imports) and lib/sync/sync.ts.

/** How far back the first sync reads posts. */
export const INITIAL_HISTORY_DAYS = 365;
/** Account-insight days backfilled on the first sync. */
export const INITIAL_ACCOUNT_DAYS = 60;
/** Account days re-read on every daily refresh (late-arriving counts settle). */
export const REFRESH_ACCOUNT_DAYS = 3;
/** New posts are looked for this far back on a daily refresh. */
export const REFRESH_POST_DAYS = 3;
/** Posts younger than this get a fresh metrics snapshot on every refresh. */
export const RECENT_POST_DAYS = 14;
export const MAX_POSTS = 500;
/** Posts per insights step. */
export const INSIGHTS_BATCH = 25;
/** Account days per step (one API call each). */
export const ACCOUNT_DAYS_BATCH = 15;

/** Posts per classification step (each is its own decision; ten run at a time). */
export const CLASSIFY_BATCH = 50;

/** "classify" and "dna" run once the account's data is in, so the app can show it meanwhile. */
export const SYNC_STEPS = ["posts", "insights", "account", "classify", "dna", "done"] as const;
export type SyncStep = (typeof SYNC_STEPS)[number];
