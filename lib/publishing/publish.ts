import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, scheduledPosts, suggestions } from "@/lib/db/schema";
import { clientForProfile, NotConnectedError, revokeToken } from "@/lib/sync/client";
import { postRow, syncPostInsights } from "@/lib/sync/sync";
import { ThreadsApiError } from "@/lib/threads/errors";
import { DRAFT_PROBLEMS, draftProblem } from "./draft";

// What the publish workflow's steps do (workflows/publish.ts). Each is safe to
// repeat: a run only acts on the version of the post it was started for, the
// claim lets one run publish, a container is created once per attempt
// (container_id), and publishing checks media_id first.

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

/** Checks the post can go out, then creates its Threads container (once). */
export async function prepareContainer(postId: string): Promise<string> {
  const row = await load(postId);
  if (row?.status !== "publishing") throw new PublishFailure("This post is no longer queued.");
  if (row.containerId) return row.containerId;

  const problem = draftProblem(row.text, row.topicTag);
  if (problem) throw new PublishFailure(DRAFT_PROBLEMS[problem]);
  try {
    const client = await clientForProfile(row.profileId);
    const quota = await client.getPublishingLimit();
    if (quota.used >= quota.total) {
      throw new PublishFailure(`You've reached Threads' limit of ${quota.total} posts in 24 hours. Retry later.`);
    }
    const containerId = await client.createTextContainer({
      text: row.text,
      topicTag: row.topicTag ?? undefined,
    });
    await db().update(scheduledPosts).set({ containerId }).where(eq(scheduledPosts.id, postId));
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

/** Publishes the container, unless this post already has a media id. */
export async function publishContainer(postId: string, containerId: string): Promise<string> {
  const row = await load(postId);
  if (!row) throw new PublishFailure("This post is no longer queued.");
  if (row.mediaId) return row.mediaId;
  try {
    const client = await clientForProfile(row.profileId);
    const mediaId = await client.publish(containerId);
    await db().update(scheduledPosts).set({ mediaId }).where(eq(scheduledPosts.id, postId));
    return mediaId;
  } catch (error) {
    return explain(row.profileId, error);
  }
}

/** Records the published post: its link, a `posts` row, and its idea marked as posted. */
export async function markPublished(postId: string, now = new Date()): Promise<void> {
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
      .set({ status: "published", publishedAt: postedAt, permalink })
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
 * did get a media id, it went out, so it's recorded as published instead.
 */
export async function markFailed(postId: string, version: number, message: string): Promise<void> {
  const row = await load(postId);
  if (!row || row.version !== version) return;
  if (row.mediaId) return markPublished(postId);
  await db()
    .update(scheduledPosts)
    .set({ status: "failed", lastError: message })
    .where(
      and(
        eq(scheduledPosts.id, postId),
        eq(scheduledPosts.version, version),
        inArray(scheduledPosts.status, ["scheduled", "publishing"]),
      ),
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

/**
 * The cron safety net. Scheduled posts well past their time lost their run
 * (a deploy, an outage), so they get a new one. Posts stuck "publishing" may
 * or may not have gone out, so rather than risk posting twice they're marked
 * failed with a note to check Threads first.
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
    .set({
      status: "failed",
      lastError:
        "We couldn't confirm this post went out. Check your Threads profile before retrying, so it isn't posted twice.",
    })
    .where(
      and(
        eq(scheduledPosts.status, "publishing"),
        isNull(scheduledPosts.mediaId),
        lt(scheduledPosts.publishingAt, new Date(now.getTime() - STUCK_PUBLISHING_MS)),
      ),
    )
    .returning({ id: scheduledPosts.id });

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
  return { restarted, stuck: stuck.length };
}
