import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, scheduledPosts, suggestions } from "@/lib/db/schema";
import { alertProfile } from "@/lib/email/alerts";
import { emailOrigin } from "@/lib/email/send";
import { postFailedEmail } from "@/lib/email/templates";
import { clientForProfile, NotConnectedError, revokeToken } from "@/lib/sync/client";
import { postRow, syncPostInsights } from "@/lib/sync/sync";
import { ThreadsApiError } from "@/lib/threads/errors";
import { DRAFT_PROBLEMS, draftProblem } from "./draft";

// What the publish workflow's steps do (workflows/publish.ts). Each is safe to
// repeat: a run only acts on the version of the post it was started for, the
// claim lets one run publish, a container is created once per attempt
// (container_id), and publishing checks media_id first. A series goes out
// part by part, each a reply to the part before; part 0 is the post itself.

/** A failure the user has to act on; the message is shown to them as is. */
export class PublishFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishFailure";
  }
}

export type PublishPlan =
  | { action: "wait"; until: string }
  | { action: "publish" }
  | { action: "stop"; reason: string };

/** Wake-up slack: a run woken a moment early still publishes. */
const EARLY_MS = 5_000;
/** A post stuck "publishing" this long is assumed lost (see sweepPublishing). */
export const STUCK_PUBLISHING_MS = 30 * 60_000;
/** A scheduled post this overdue has lost its run (see sweepPublishing). */
export const OVERDUE_MS = 5 * 60_000;

async function load(postId: string) {
  const [row] = await db().select().from(scheduledPosts).where(eq(scheduledPosts.id, postId));
  return row;
}

type Row = NonNullable<Awaited<ReturnType<typeof load>>>;

/** Every part of the post: the post itself, then the rest of its series. */
function partsOf(row: Row) {
  return [{ text: row.text, containerId: row.containerId, mediaId: row.mediaId }, ...row.seriesParts];
}

/** Records a part's container or media id. Each part that goes out counts as progress for the sweeper. */
async function savePart(postId: string, part: number, ids: { containerId: string } | { mediaId: string }) {
  const progress = "mediaId" in ids ? { publishingAt: new Date() } : {};
  if (part === 0) {
    await db()
      .update(scheduledPosts)
      .set({ ...ids, ...progress })
      .where(eq(scheduledPosts.id, postId));
    return;
  }
  const index = part - 1;
  await db()
    .update(scheduledPosts)
    .set({
      seriesParts: sql`jsonb_set(${scheduledPosts.seriesParts}, ${`{${index}}`}::text[], (${scheduledPosts.seriesParts} -> ${index}::int) || ${JSON.stringify(ids)}::jsonb)`,
      ...progress,
    })
    .where(eq(scheduledPosts.id, postId));
}

/** How many parts the post has: 1, or more for a series. */
export async function partCount(postId: string): Promise<number> {
  const row = await load(postId);
  return row ? partsOf(row).length : 0;
}

/** What a run should do next: sleep until the post's time, publish it, or stop because it changed. */
export async function planPublish(postId: string, version: number, now = new Date()): Promise<PublishPlan> {
  const row = await load(postId);
  if (!row) return { action: "stop", reason: "deleted" };
  if (row.version !== version) return { action: "stop", reason: "superseded" };
  if (row.status !== "scheduled") return { action: "stop", reason: row.status };
  if (row.scheduledFor.getTime() > now.getTime() + EARLY_MS) {
    return { action: "wait", until: row.scheduledFor.toISOString() };
  }
  return { action: "publish" };
}

/** Moves the post to "publishing" for this run. Only one run (the current version's) can. */
export async function claimForPublishing(postId: string, version: number, now = new Date()): Promise<boolean> {
  const claimed = await db()
    .update(scheduledPosts)
    .set({ status: "publishing", publishingAt: now, attempts: sql`${scheduledPosts.attempts} + 1` })
    .where(
      and(eq(scheduledPosts.id, postId), eq(scheduledPosts.version, version), eq(scheduledPosts.status, "scheduled")),
    )
    .returning({ id: scheduledPosts.id });
  return claimed.length > 0;
}

/** Translates API errors into messages for the user; anything else is left for the step to retry. */
async function explain(profileId: string, error: unknown): Promise<never> {
  if (error instanceof NotConnectedError) {
    throw new PublishFailure("Threaded lost access to your Threads account. Reconnect it, then retry.");
  }
  if (error instanceof ThreadsApiError && error.isAuthError) {
    // Forget the token so the app asks the user to reconnect.
    await revokeToken(profileId);
    throw new PublishFailure("Threads rejected Threaded's access. Reconnect your account, then retry.");
  }
  if (error instanceof ThreadsApiError && !error.isRateLimited && error.status >= 400 && error.status < 500) {
    throw new PublishFailure(`Threads didn't accept the post: ${error.message}`);
  }
  throw error;
}

/**
 * Checks a part can go out, then creates its Threads container (once). Null
 * when the part already went out: a retried series picks up after it.
 */
export async function prepareContainer(postId: string, part = 0): Promise<string | null> {
  const row = await load(postId);
  if (row?.status !== "publishing") throw new PublishFailure("This post is no longer queued.");
  const parts = partsOf(row);
  const current = parts[part];
  if (!current) throw new PublishFailure("This post is no longer queued.");
  if (current.mediaId) return null;
  if (current.containerId) return current.containerId;

  const problem = draftProblem(current.text, part === 0 ? row.topicTag : null);
  if (problem) throw new PublishFailure(DRAFT_PROBLEMS[problem]);
  const replyToId = part > 0 ? parts[part - 1].mediaId : undefined;
  if (part > 0 && !replyToId) throw new PublishFailure("The part before this one didn't go out.");
  try {
    const client = await clientForProfile(row.profileId);
    if (part === 0) {
      // Replies to your own post have their own, far higher limit (1,000 a day).
      const quota = await client.getPublishingLimit();
      if (quota.used >= quota.total) {
        throw new PublishFailure(`You've reached Threads' limit of ${quota.total} posts in 24 hours. Retry later.`);
      }
    }
    const containerId = await client.createTextContainer({
      text: current.text,
      topicTag: part === 0 ? (row.topicTag ?? undefined) : undefined,
      replyToId: replyToId ?? undefined,
    });
    await savePart(postId, part, { containerId });
    return containerId;
  } catch (error) {
    if (error instanceof PublishFailure) throw error;
    return explain(row.profileId, error);
  }
}

/** True once Threads has finished preparing the container. */
export async function containerReady(postId: string, containerId: string): Promise<boolean> {
  const row = await load(postId);
  if (!row) throw new PublishFailure("This post is no longer queued.");
  try {
    const client = await clientForProfile(row.profileId);
    const status = await client.getContainerStatus(containerId);
    if (status.status === "ERROR" || status.status === "EXPIRED") {
      throw new PublishFailure(
        `Threads couldn't prepare the post${status.errorMessage ? `: ${status.errorMessage}` : "."}`,
      );
    }
    return status.status === "FINISHED" || status.status === "PUBLISHED";
  } catch (error) {
    if (error instanceof PublishFailure) throw error;
    return explain(row.profileId, error);
  }
}

/** Publishes a part's container, unless that part already has a media id. */
export async function publishContainer(postId: string, containerId: string, part = 0): Promise<string> {
  const row = await load(postId);
  const current = row && partsOf(row)[part];
  if (!row || !current) throw new PublishFailure("This post is no longer queued.");
  if (current.mediaId) return current.mediaId;
  try {
    const client = await clientForProfile(row.profileId);
    const mediaId = await client.publish(containerId);
    await savePart(postId, part, { mediaId });
    return mediaId;
  } catch (error) {
    return explain(row.profileId, error);
  }
}

/**
 * Records the published post: its link, a `posts` row, and its idea marked as
 * posted. With `failure`, only the start of a series went out: it's recorded
 * the same way but stays failed, with that message, for a retry.
 */
export async function markPublished(postId: string, now = new Date(), failure?: string): Promise<void> {
  const row = await load(postId);
  if (!row?.mediaId) return;
  const mediaId = row.mediaId;
  let permalink: string | null = null;
  let postedAt = now;
  try {
    const post = await (await clientForProfile(row.profileId)).getPost(mediaId);
    permalink = post.permalink;
    if (post.timestamp) postedAt = new Date(post.timestamp);
  } catch (error) {
    // The link is nice to have; the daily sync fills it in otherwise.
    console.warn(`Couldn't read published post ${mediaId}`, error);
  }

  await db().transaction(async (tx) => {
    await tx
      .update(scheduledPosts)
      .set({ status: failure ? "failed" : "published", publishedAt: postedAt, permalink, lastError: failure ?? null })
      .where(eq(scheduledPosts.id, postId));
    await tx
      .insert(posts)
      .values({
        ...postRow(row.profileId, {
          id: mediaId,
          text: row.text,
          timestamp: postedAt.toISOString(),
          mediaType: "TEXT_POST",
          permalink: permalink ?? "",
          isQuotePost: false,
          topicTag: row.topicTag,
        }),
        viaThreaded: true,
      })
      .onConflictDoUpdate({ target: posts.id, set: { viaThreaded: true } });
    if (row.suggestionId) {
      await tx
        .update(suggestions)
        .set({ status: "posted", postedMediaId: mediaId })
        .where(eq(suggestions.id, row.suggestionId));
    }
  });
}

/**
 * Marks this version of the post failed with a message for the user. If it
 * did get a media id, it went out, so it's recorded as published instead; a
 * series that stopped partway is recorded too, but stays failed.
 */
export async function markFailed(postId: string, version: number, message: string): Promise<void> {
  const row = await load(postId);
  if (!row || row.version !== version) return;
  if (row.mediaId) {
    const parts = partsOf(row);
    const live = parts.findIndex((part) => !part.mediaId);
    if (live === -1) return markPublished(postId);
    if (row.status !== "publishing") return;
    const failure = `${live === 1 ? "Part 1" : `Parts 1–${live}`} of ${parts.length} ${live === 1 ? "is" : "are"} live, but the series stopped there. ${message}`;
    await markPublished(postId, new Date(), failure);
    return alertFailed({ ...row, lastError: failure });
  }
  const failed = await db()
    .update(scheduledPosts)
    .set({ status: "failed", lastError: message })
    .where(
      and(
        eq(scheduledPosts.id, postId),
        eq(scheduledPosts.version, version),
        inArray(scheduledPosts.status, ["scheduled", "publishing"]),
      ),
    )
    .returning({ id: scheduledPosts.id });
  if (failed.length > 0) await alertFailed({ ...row, lastError: message });
}

/** Emails the workspace that a post didn't go out, once per version of it. */
async function alertFailed(post: {
  id: string;
  profileId: string;
  version: number;
  text: string;
  lastError: string | null;
}) {
  await alertProfile(post.profileId, "post_failed", `${post.id}:${post.version}`, () =>
    postFailedEmail({
      text: post.text,
      reason: post.lastError ?? "Threads didn't take the post.",
      url: `${emailOrigin()}/queue`,
    }),
  );
}

/** A metrics snapshot for the published post (best effort; the daily sync also measures it). */
export async function snapshotPublished(postId: string): Promise<number> {
  const row = await load(postId);
  if (!row?.mediaId) return 0;
  return syncPostInsights(row.profileId, [row.mediaId]).catch((error) => {
    console.warn(`Snapshot for ${row.mediaId} failed`, error);
    return 0;
  });
}

/** Scores the published post's draft once its 3-day snapshot is in. */
export async function scorePublished(postId: string): Promise<void> {
  const row = await load(postId);
  if (!row?.mediaId) return;
  const { updateScorecard } = await import("./scorecard");
  await updateScorecard(row.profileId);
}

const UNCONFIRMED =
  "We couldn't confirm this post went out. Check your Threads profile before retrying, so it isn't posted twice.";

/**
 * The cron safety net. Scheduled posts well past their time lost their run
 * (a deploy, an outage), so they get a new one. Posts stuck "publishing" may
 * or may not have gone out, so rather than risk posting twice they're marked
 * failed with a note to check Threads first. One stuck after going out (a
 * series partway through) is recorded as far as it got.
 */
export async function sweepPublishing(now = new Date()): Promise<{ restarted: string[]; stuck: number }> {
  const overdue = await db()
    .update(scheduledPosts)
    .set({ version: sql`${scheduledPosts.version} + 1` })
    .where(
      and(
        eq(scheduledPosts.status, "scheduled"),
        lt(scheduledPosts.scheduledFor, new Date(now.getTime() - OVERDUE_MS)),
      ),
    )
    .returning({ id: scheduledPosts.id, version: scheduledPosts.version });

  const stuck = await db()
    .update(scheduledPosts)
    .set({ status: "failed", lastError: UNCONFIRMED })
    .where(
      and(
        eq(scheduledPosts.status, "publishing"),
        isNull(scheduledPosts.mediaId),
        lt(scheduledPosts.publishingAt, new Date(now.getTime() - STUCK_PUBLISHING_MS)),
      ),
    )
    .returning({
      id: scheduledPosts.id,
      profileId: scheduledPosts.profileId,
      version: scheduledPosts.version,
      text: scheduledPosts.text,
      lastError: scheduledPosts.lastError,
    });
  for (const post of stuck) await alertFailed(post);

  const stalled = await db()
    .select({ id: scheduledPosts.id, version: scheduledPosts.version })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, "publishing"),
        isNotNull(scheduledPosts.mediaId),
        lt(scheduledPosts.publishingAt, new Date(now.getTime() - STUCK_PUBLISHING_MS)),
      ),
    );
  for (const post of stalled) {
    await markFailed(
      post.id,
      post.version,
      "We couldn't confirm the next part went out. Check your Threads profile before retrying, so it isn't posted twice.",
    );
  }

  const { start } = await import("workflow/api");
  const { publishPost } = await import("@/workflows/publish");
  const restarted: string[] = [];
  for (const post of overdue) {
    try {
      const run = await start(publishPost, [post.id, post.version]);
      await db()
        .update(scheduledPosts)
        .set({ workflowRunId: run.runId })
        .where(and(eq(scheduledPosts.id, post.id), eq(scheduledPosts.version, post.version)));
      restarted.push(post.id);
    } catch (error) {
      console.error(`Couldn't restart publishing for ${post.id}`, error);
    }
  }
  return { restarted, stuck: stuck.length + stalled.length };
}
