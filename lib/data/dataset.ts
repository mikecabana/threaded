import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountDaily, postMetrics, posts } from "@/lib/db/schema";
import type { AccountDay, PostWithInsights, ThreadsMediaType, ThreadsProfile } from "@/lib/threads/types";

/** Everything the analysis layer needs about one profile (demo or real). */
export interface ProfileDataset {
  profile: ThreadsProfile & { followersCount: number | null };
  /** Newest first, each with its latest metrics snapshot. */
  posts: PostWithInsights[];
  /** Oldest → newest, complete UTC days ending yesterday. */
  days: AccountDay[];
}

export const HISTORY_DAYS = 60;
const DAY_MS = 86_400_000;

/**
 * `postDays` defaults to twice the KPI window, so "previous period"
 * comparisons have data; Profile DNA reads further back.
 */
export async function loadProfileDataset(
  profile: ThreadsProfile,
  now: Date,
  { postDays = 2 * HISTORY_DAYS }: { postDays?: number } = {},
): Promise<ProfileDataset> {
  const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const windowStart = new Date(todayStart.getTime() - HISTORY_DAYS * DAY_MS);
  const postsSince = new Date(todayStart.getTime() - postDays * DAY_MS);

  const latestMetrics = db()
    .selectDistinctOn([postMetrics.postId], {
      postId: postMetrics.postId,
      views: postMetrics.views,
      likes: postMetrics.likes,
      replies: postMetrics.replies,
      reposts: postMetrics.reposts,
      quotes: postMetrics.quotes,
      shares: postMetrics.shares,
    })
    .from(postMetrics)
    .orderBy(postMetrics.postId, desc(postMetrics.capturedAt))
    .as("latest");

  const [postRows, dayRows] = await Promise.all([
    db()
      .select({
        id: posts.id,
        text: posts.text,
        postedAt: posts.postedAt,
        mediaType: posts.mediaType,
        permalink: posts.permalink,
        isQuotePost: posts.isQuotePost,
        topicTag: posts.topicTag,
        views: sql<number>`coalesce(${latestMetrics.views}, 0)`,
        likes: sql<number>`coalesce(${latestMetrics.likes}, 0)`,
        replies: sql<number>`coalesce(${latestMetrics.replies}, 0)`,
        reposts: sql<number>`coalesce(${latestMetrics.reposts}, 0)`,
        quotes: sql<number>`coalesce(${latestMetrics.quotes}, 0)`,
        shares: sql<number>`coalesce(${latestMetrics.shares}, 0)`,
      })
      .from(posts)
      .leftJoin(latestMetrics, eq(latestMetrics.postId, posts.id))
      .where(and(eq(posts.profileId, profile.id), gte(posts.postedAt, postsSince)))
      .orderBy(desc(posts.postedAt))
      .limit(500),
    db()
      .select()
      .from(accountDaily)
      .where(
        and(
          eq(accountDaily.profileId, profile.id),
          gte(accountDaily.date, windowStart.toISOString().slice(0, 10)),
          lt(accountDaily.date, todayStart.toISOString().slice(0, 10)),
        ),
      )
      .orderBy(accountDaily.date),
  ]);

  // Follower counts are our own snapshots and can have gaps; carry the last known value forward.
  let lastFollowers = dayRows.find((d) => d.followersCount !== null)?.followersCount ?? 0;
  const days: AccountDay[] = dayRows.map((d) => {
    lastFollowers = d.followersCount ?? lastFollowers;
    return {
      date: d.date,
      views: d.views,
      likes: d.likes,
      replies: d.replies,
      reposts: d.reposts,
      quotes: d.quotes,
      followersCount: lastFollowers,
    };
  });

  return {
    profile: { ...profile, followersCount: days.at(-1)?.followersCount ?? null },
    posts: postRows.map((p) => ({
      id: p.id,
      text: p.text,
      timestamp: p.postedAt.toISOString(),
      mediaType: p.mediaType as ThreadsMediaType,
      permalink: p.permalink ?? "",
      isQuotePost: p.isQuotePost,
      topicTag: p.topicTag,
      insights: {
        views: Number(p.views),
        likes: Number(p.likes),
        replies: Number(p.replies),
        reposts: Number(p.reposts),
        quotes: Number(p.quotes),
        shares: Number(p.shares),
      },
    })),
    days,
  };
}
