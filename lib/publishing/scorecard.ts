import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import {
  MATCH_DAYS,
  matchDrafts,
  type ScorecardEntry,
  scoreAt72h,
  scoreChips,
  scorecardLine,
  type TrackedPost,
  WINNER,
} from "@/lib/analysis/scorecard";
import { db } from "@/lib/db";
import { generations, postMetrics, posts, suggestions } from "@/lib/db/schema";
import { RECENT_POST_DAYS } from "@/lib/sync/constants";

// The suggestion scorecard against the database: which posts count (published
// through Threaded, or written elsewhere from a Studio draft), their early
// snapshots, and the 3-day score stored on each draft for Studio to learn from.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Posts older than this aren't shown on the scorecard. */
const SCORECARD_DAYS = 30;
/** Enough history for the usual (30 earlier posts) behind every recent post. */
const HISTORY_POSTS = 200;

/** The profile's recent posts with their first-days snapshots and latest views. */
async function trackedPosts(profileId: string): Promise<TrackedPost[]> {
  const recent = await db()
    .select({ id: posts.id, postedAt: posts.postedAt })
    .from(posts)
    .where(eq(posts.profileId, profileId))
    .orderBy(desc(posts.postedAt))
    .limit(HISTORY_POSTS);
  if (recent.length === 0) return [];
  const ids = recent.map((p) => p.id);

  const [early, latest] = await Promise.all([
    db()
      .select({ postId: postMetrics.postId, at: postMetrics.capturedAt, views: postMetrics.views })
      .from(postMetrics)
      .innerJoin(posts, eq(posts.id, postMetrics.postId))
      .where(
        and(
          inArray(postMetrics.postId, ids),
          lte(postMetrics.capturedAt, sql`${posts.postedAt} + interval '96 hours'`),
        ),
      ),
    db()
      .selectDistinctOn([postMetrics.postId], { postId: postMetrics.postId, views: postMetrics.views })
      .from(postMetrics)
      .where(inArray(postMetrics.postId, ids))
      .orderBy(postMetrics.postId, desc(postMetrics.capturedAt)),
  ]);

  const snapshots = new Map<string, TrackedPost["snapshots"]>();
  for (const s of early) {
    const list = snapshots.get(s.postId) ?? [];
    list.push({ at: s.at.toISOString(), views: s.views });
    snapshots.set(s.postId, list);
  }
  const latestViews = new Map(latest.map((l) => [l.postId, l.views]));
  return recent.map((p) => ({
    id: p.id,
    postedAt: p.postedAt.toISOString(),
    snapshots: snapshots.get(p.id) ?? [],
    latestViews: latestViews.get(p.id),
  }));
}

/** Posts on the scorecard: the last 30 days' posts from Threaded or from a Studio draft, newest first. */
export async function scorecardFor(profileId: string, now = new Date(), limit = 10) {
  const linked = db()
    .select({ id: suggestions.postedMediaId })
    .from(suggestions)
    .where(sql`${suggestions.postedMediaId} is not null`);
  const rows = await db()
    .select({
      id: posts.id,
      text: posts.text,
      permalink: posts.permalink,
      postedAt: posts.postedAt,
      viaThreaded: posts.viaThreaded,
    })
    .from(posts)
    .where(
      and(
        eq(posts.profileId, profileId),
        gte(posts.postedAt, new Date(now.getTime() - SCORECARD_DAYS * DAY_MS)),
        or(eq(posts.viaThreaded, true), inArray(posts.id, linked)),
      ),
    )
    .orderBy(desc(posts.postedAt))
    .limit(limit);
  if (rows.length === 0) return { entries: [] as ScorecardEntry[], line: "" };

  const history = await trackedPosts(profileId);
  const byId = new Map(history.map((h) => [h.id, h]));
  const entries = rows.map((row): ScorecardEntry => {
    const tracked = byId.get(row.id) ?? { id: row.id, postedAt: row.postedAt.toISOString(), snapshots: [] };
    return {
      postId: row.id,
      text: row.text,
      permalink: row.permalink,
      postedAt: row.postedAt.toISOString(),
      source: row.viaThreaded ? "threaded" : "matched",
      chips: scoreChips(tracked, history, now),
    };
  });
  return { entries, line: scorecardLine(entries) };
}

/**
 * Links posts the author published themselves (in the last two weeks) to the
 * Studio drafts they came from, so they're scored like posts from Threaded.
 * Drafts already scheduled are left alone: their own post is on its way.
 */
export async function matchPostedDrafts(profileId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - RECENT_POST_DAYS * DAY_MS);
  const linked = db()
    .select({ id: suggestions.postedMediaId })
    .from(suggestions)
    .where(sql`${suggestions.postedMediaId} is not null`);
  const candidates = await db()
    .select({ id: posts.id, text: posts.text, postedAt: posts.postedAt })
    .from(posts)
    .where(
      and(
        eq(posts.profileId, profileId),
        eq(posts.viaThreaded, false),
        gte(posts.postedAt, since),
        notInArray(posts.id, linked),
      ),
    );
  if (candidates.length === 0) return 0;

  const drafts = await db()
    .select({ id: suggestions.id, text: suggestions.text, createdAt: suggestions.createdAt })
    .from(suggestions)
    .innerJoin(generations, eq(generations.id, suggestions.generationId))
    .where(
      and(
        eq(generations.profileId, profileId),
        inArray(suggestions.status, ["new", "saved", "dismissed"]),
        isNull(suggestions.postedMediaId),
        gte(suggestions.createdAt, new Date(since.getTime() - MATCH_DAYS * DAY_MS)),
      ),
    );
  const matches = matchDrafts(
    candidates.map((p) => ({ id: p.id, text: p.text, postedAt: p.postedAt.toISOString() })),
    drafts.map((d) => ({ id: d.id, text: d.text, createdAt: d.createdAt.toISOString() })),
  );
  for (const match of matches) {
    await db()
      .update(suggestions)
      .set({ status: "posted", postedMediaId: match.postId })
      .where(and(eq(suggestions.id, match.draftId), isNull(suggestions.postedMediaId)));
  }
  return matches.length;
}

/**
 * Stores each posted draft's 3-day score (views against the usual) once it
 * has one. Re-scored while the 3-day window is open, so the reading closest
 * to 72 hours wins.
 */
export async function scorePostedDrafts(profileId: string, now = new Date()): Promise<number> {
  const due = await db()
    .select({ id: suggestions.id, postId: posts.id })
    .from(suggestions)
    .innerJoin(generations, eq(generations.id, suggestions.generationId))
    .innerJoin(posts, eq(posts.id, suggestions.postedMediaId))
    .where(
      and(
        eq(generations.profileId, profileId),
        lte(posts.postedAt, new Date(now.getTime() - 54 * HOUR_MS)),
        gte(posts.postedAt, new Date(now.getTime() - 7 * DAY_MS)),
      ),
    );
  if (due.length === 0) return 0;

  const history = await trackedPosts(profileId);
  const byId = new Map(history.map((h) => [h.id, h]));
  let scored = 0;
  for (const draft of due) {
    const tracked = byId.get(draft.postId);
    const score = tracked ? scoreAt72h(tracked, history, now) : null;
    if (score === null) continue;
    await db()
      .update(suggestions)
      .set({ perfVsBaseline: score.toFixed(3) })
      .where(eq(suggestions.id, draft.id));
    scored++;
  }
  return scored;
}

/** Matching, then scoring: what a sync does once the day's snapshots are in. Never throws. */
export async function updateScorecard(profileId: string, now = new Date()): Promise<void> {
  try {
    await matchPostedDrafts(profileId, now);
    await scorePostedDrafts(profileId, now);
  } catch (error) {
    console.error(`Scorecard update failed for profile ${profileId}`, error);
  }
}

/** Recent drafts that beat the author's usual at 3 days, best first: Studio's own winners. */
export async function winningDrafts(profileId: string, limit = 3): Promise<{ postId: string; score: number }[]> {
  const rows = await db()
    .select({ postId: suggestions.postedMediaId, score: suggestions.perfVsBaseline })
    .from(suggestions)
    .innerJoin(generations, eq(generations.id, suggestions.generationId))
    .where(
      and(
        eq(generations.profileId, profileId),
        gte(suggestions.perfVsBaseline, WINNER.toFixed(3)),
        sql`${suggestions.postedMediaId} is not null`,
      ),
    )
    .orderBy(desc(suggestions.perfVsBaseline))
    .limit(limit);
  return rows.flatMap((r) => (r.postId && r.score ? [{ postId: r.postId, score: Number(r.score) }] : []));
}
