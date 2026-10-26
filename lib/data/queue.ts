import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduledPosts } from "@/lib/db/schema";

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
};

const selectPosts = () => db().select(columns).from(scheduledPosts);
type Row = Awaited<ReturnType<typeof selectPosts>>[number];

function toQueued(row: Row): QueuedPost {
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
  };
}

/** The profile's queue: what's coming up and what needs attention. Posts that went out are on the scorecard. */
export async function queueFor(profileId: string) {
  const mine = eq(scheduledPosts.profileId, profileId);
  const [upcoming, failed] = await Promise.all([
    selectPosts()
      .where(and(mine, inArray(scheduledPosts.status, ["scheduled", "publishing"])))
      .orderBy(asc(scheduledPosts.scheduledFor)),
    selectPosts()
      .where(and(mine, eq(scheduledPosts.status, "failed")))
      .orderBy(desc(scheduledPosts.scheduledFor))
      .limit(20),
  ]);
  return { upcoming: upcoming.map(toQueued), failed: failed.map(toQueued) };
}

/** Failed posts waiting on the user, for the app-wide banner. */
export async function failedPostCount(profileId: string): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.profileId, profileId), eq(scheduledPosts.status, "failed")));
  return row?.count ?? 0;
}
