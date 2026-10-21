import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountDaily, postMetrics, posts, syncRuns, threadsProfiles } from "@/lib/db/schema";
import { ThreadsApiError } from "@/lib/threads/errors";
import { threadsLength } from "@/lib/threads/length";
import type { ThreadsPost } from "@/lib/threads/types";
import { clientForProfile, revokeToken } from "./client";
import { MAX_POSTS, RECENT_POST_DAYS, type SyncStep } from "./constants";

// The work behind the sync workflows. Every function is idempotent (safe to
// retry) and takes only ids and numbers, so the workflow event log never sees
// tokens or post content.

const DAY_MS = 86_400_000;

const unix = (date: Date) => Math.floor(date.getTime() / 1000);
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

/** Converts Threads auth failures into a disconnected profile instead of endless retries. */
async function guard<T>(profileId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ThreadsApiError && error.isAuthError) await revokeToken(profileId);
    throw error;
  }
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export async function startSyncRun(profileId: string, kind: "initial" | "daily" | "manual"): Promise<string> {
  const [run] = await db().insert(syncRuns).values({ profileId, kind, step: "posts" }).returning({ id: syncRuns.id });
  return run.id;
}

export async function setSyncStep(runId: string, step: SyncStep, stats?: Record<string, number>): Promise<void> {
  await db()
    .update(syncRuns)
    .set({ step, ...(stats ? { stats } : {}) })
    .where(eq(syncRuns.id, runId));
}

export async function finishSyncRun(
  runId: string,
  profileId: string,
  outcome: { ok: true; stats: Record<string, number> } | { ok: false; error: string },
): Promise<void> {
  const finishedAt = new Date();
  await db()
    .update(syncRuns)
    .set(
      outcome.ok
        ? { status: "succeeded", step: "done", stats: outcome.stats, finishedAt }
        : { status: "failed", error: outcome.error.slice(0, 500), finishedAt },
    )
    .where(eq(syncRuns.id, runId));
  if (outcome.ok)
    await db().update(threadsProfiles).set({ lastSyncedAt: finishedAt }).where(eq(threadsProfiles.id, profileId));
}

/** The newest run for a profile, for the progress UI and to avoid starting duplicates. */
export async function latestSyncRun(profileId: string) {
  const [run] = await db()
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.profileId, profileId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return run ?? null;
}

/** True while a run started in the last 30 minutes is still going (stale runs don't block). */
export async function hasActiveSyncRun(profileId: string, now = new Date()): Promise<boolean> {
  const [run] = await db()
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.profileId, profileId),
        eq(syncRuns.status, "running"),
        gte(syncRuns.startedAt, new Date(now.getTime() - 30 * 60_000)),
      ),
    )
    .limit(1);
  return Boolean(run);
}

// ── Profile & posts ──────────────────────────────────────────────────────────

export async function syncProfile(profileId: string): Promise<void> {
  const client = await clientForProfile(profileId);
  const profile = await guard(profileId, () => client.getProfile());
  await db()
    .update(threadsProfiles)
    .set({
      username: profile.username,
      name: profile.name,
      biography: profile.biography,
      profilePictureUrl: profile.profilePictureUrl,
      isVerified: profile.isVerified,
    })
    .where(eq(threadsProfiles.id, profileId));
}

/** A Threads post as a `posts` row. */
export function postRow(profileId: string, post: ThreadsPost) {
  return {
    id: post.id,
    profileId,
    text: post.text,
    mediaType: post.mediaType,
    permalink: post.permalink || null,
    postedAt: new Date(post.timestamp),
    isQuotePost: post.isQuotePost,
    topicTag: post.topicTag,
    length: threadsLength(post.text),
    hasLink: /https?:\/\//i.test(post.text),
    hasQuestion: post.text.includes("?"),
  };
}

/**
 * Upserts the profile's own posts from the last `sinceDays` (reposts of other
 * people's posts are skipped). Returns ids, newest first.
 */
export async function syncPosts(profileId: string, sinceDays: number, now = new Date()): Promise<string[]> {
  const client = await clientForProfile(profileId, now);
  const ids: string[] = [];
  await guard(profileId, async () => {
    for await (const page of client.listPosts({ since: unix(new Date(now.getTime() - sinceDays * DAY_MS)) })) {
      const own = page.filter((p) => p.mediaType !== "REPOST_FACADE").slice(0, MAX_POSTS - ids.length);
      if (own.length > 0) {
        await db()
          .insert(posts)
          .values(own.map((p) => postRow(profileId, p)))
          .onConflictDoUpdate({
            target: posts.id,
            set: {
              text: sql`excluded.text`,
              permalink: sql`excluded.permalink`,
              topicTag: sql`excluded.topic_tag`,
              length: sql`excluded.length`,
              hasLink: sql`excluded.has_link`,
              hasQuestion: sql`excluded.has_question`,
            },
          });
        ids.push(...own.map((p) => p.id));
      }
      if (ids.length >= MAX_POSTS) break;
    }
  });
  return ids;
}

/** Posts that should get a fresh metrics snapshot today. */
export async function recentPostIds(profileId: string, now = new Date()): Promise<string[]> {
  const rows = await db()
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(eq(posts.profileId, profileId), gte(posts.postedAt, new Date(now.getTime() - RECENT_POST_DAYS * DAY_MS))),
    )
    .orderBy(desc(posts.postedAt));
  return rows.map((r) => r.id);
}

/**
 * Records a metrics snapshot for each post. A post that fails on its own (e.g.
 * deleted since we listed it) is skipped; auth failures stop the batch.
 */
export async function syncPostInsights(profileId: string, postIds: string[], now = new Date()): Promise<number> {
  if (postIds.length === 0) return 0;
  const client = await clientForProfile(profileId, now);
  const snapshots: (typeof postMetrics.$inferInsert)[] = [];
  // Small concurrency: fast enough, gentle on the API.
  for (let i = 0; i < postIds.length; i += 5) {
    const chunk = postIds.slice(i, i + 5);
    const results = await Promise.allSettled(chunk.map((id) => client.getPostInsights(id)));
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        snapshots.push({ postId: chunk[index], capturedAt: now, ...result.value });
      } else if (result.reason instanceof ThreadsApiError && result.reason.isAuthError) {
        await revokeToken(profileId);
        throw result.reason;
      } else if (result.reason instanceof ThreadsApiError && result.reason.isRateLimited) {
        throw result.reason;
      }
    }
  }
  if (snapshots.length > 0) await db().insert(postMetrics).values(snapshots).onConflictDoNothing();
  return snapshots.length;
}

// ── Account ──────────────────────────────────────────────────────────────────

/** The last `days` complete UTC days, oldest first. */
export function recentDays(days: number, now = new Date()): string[] {
  const todayStart = Date.parse(`${utcDay(now)}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => utcDay(new Date(todayStart - (days - i) * DAY_MS)));
}

/**
 * Account insights for each UTC day (one call per day, since only views come
 * back as a daily series). Threads only reports the follower count as of now,
 * so it's recorded on `followersOn` alone (normally yesterday, the newest
 * complete day) and never backdated onto older days.
 */
export async function syncAccountDays(
  profileId: string,
  days: string[],
  { now = new Date(), followersOn = recentDays(1, now)[0] }: { now?: Date; followersOn?: string } = {},
): Promise<number> {
  if (days.length === 0) return 0;
  const client = await clientForProfile(profileId, now);
  const latest = followersOn;
  let written = 0;
  await guard(profileId, async () => {
    for (const day of days) {
      const since = Date.parse(`${day}T00:00:00Z`);
      const insights = await client.getAccountInsights({ since: since / 1000, until: (since + DAY_MS) / 1000 });
      const values = {
        views: insights.dailyViews.reduce((sum, d) => sum + d.views, 0),
        likes: insights.likes,
        replies: insights.replies,
        reposts: insights.reposts,
        quotes: insights.quotes,
        clicks: insights.clicks,
      };
      const followers = day === latest ? { followersCount: insights.followersCount } : {};
      await db()
        .insert(accountDaily)
        .values({ profileId, date: day, ...values, ...followers })
        .onConflictDoUpdate({ target: [accountDaily.profileId, accountDaily.date], set: { ...values, ...followers } });
      written++;
    }
  });
  return written;
}
