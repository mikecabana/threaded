import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { postMetrics, scheduledPosts } from "@/lib/db/schema";

export interface QueuedPost {
  id: string;
  text: string;
  topicTag: string | null;
  status: "scheduled" | "publishing" | "published" | "failed" | "canceled";
  scheduledFor: string;
  publishedAt: string | null;
  permalink: string | null;
  lastError: string | null;
  suggestionId: string | null;
  /** Latest snapshot, for published posts. */
  metrics: { views: number; likes: number; replies: number } | null;
}

const columns = {
  id: scheduledPosts.id,
  text: scheduledPosts.text,
  topicTag: scheduledPosts.topicTag,
  status: scheduledPosts.status,
  scheduledFor: scheduledPosts.scheduledFor,
  publishedAt: scheduledPosts.publishedAt,
  permalink: scheduledPosts.permalink,
  lastError: scheduledPosts.lastError,
  suggestionId: scheduledPosts.suggestionId,
  mediaId: scheduledPosts.mediaId,
};

const selectPosts = () => db().select(columns).from(scheduledPosts);
type Row = Awaited<ReturnType<typeof selectPosts>>[number];

function toQueued(row: Row, metrics: Map<string, QueuedPost["metrics"]>): QueuedPost {
  return {
    id: row.id,
    text: row.text,
    topicTag: row.topicTag,
    status: row.status,
    scheduledFor: row.scheduledFor.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    permalink: row.permalink,
    lastError: row.lastError,
    suggestionId: row.suggestionId,
    metrics: (row.mediaId && metrics.get(row.mediaId)) || null,
  };
}

/** The profile's queue: what's coming up, what needs attention, and what went out recently. */
export async function queueFor(profileId: string) {
  const mine = eq(scheduledPosts.profileId, profileId);
  const [upcoming, failed, posted] = await Promise.all([
    selectPosts()
      .where(and(mine, inArray(scheduledPosts.status, ["scheduled", "publishing"])))
      .orderBy(asc(scheduledPosts.scheduledFor)),
    selectPosts()
      .where(and(mine, eq(scheduledPosts.status, "failed")))
      .orderBy(desc(scheduledPosts.scheduledFor))
      .limit(20),
    selectPosts()
      .where(and(mine, eq(scheduledPosts.status, "published")))
      .orderBy(desc(scheduledPosts.publishedAt))
      .limit(10),
  ]);

  const mediaIds = posted.flatMap((p) => (p.mediaId ? [p.mediaId] : []));
  const latest = mediaIds.length
    ? await db()
        .selectDistinctOn([postMetrics.postId], {
          postId: postMetrics.postId,
          views: postMetrics.views,
          likes: postMetrics.likes,
          replies: postMetrics.replies,
        })
        .from(postMetrics)
        .where(inArray(postMetrics.postId, mediaIds))
        .orderBy(postMetrics.postId, sql`${postMetrics.capturedAt} desc`)
    : [];
  const metrics = new Map(latest.map(({ postId, ...m }) => [postId, m]));

  return {
    upcoming: upcoming.map((r) => toQueued(r, metrics)),
    failed: failed.map((r) => toQueued(r, metrics)),
    posted: posted.map((r) => toQueued(r, metrics)),
  };
}

/** Failed posts waiting on the user, for the app-wide banner. */
export async function failedPostCount(profileId: string): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.profileId, profileId), eq(scheduledPosts.status, "failed")));
  return row?.count ?? 0;
}
