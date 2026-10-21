import "server-only";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { generations, scheduledPosts, suggestions, threadsTokens } from "@/lib/db/schema";
import { type DraftProblem, draftProblem, MAX_SCHEDULE_DAYS, normalizeTopic } from "./draft";

// Scheduling a post, and changing your mind about it. Every change bumps the
// row's version and starts a fresh publish run for that version, so a run
// that's still asleep for an older time or text stops when it wakes
// (workflows/publish.ts). Nothing is ever posted without the user asking.

/** Pending (scheduled or publishing) posts a profile can have at once. */
export const MAX_PENDING = 100;
/** "Now" covers a post scheduled a moment ago, e.g. while the composer was open. */
const PAST_GRACE_MS = 60_000;
const DAY_MS = 86_400_000;

export type PublishingProblem =
  | DraftProblem
  | "past"
  | "too_far"
  | "too_many"
  | "not_found"
  | "not_editable"
  | "not_connected";

export class PublishingError extends Error {
  constructor(readonly problem: PublishingProblem) {
    super(problem);
    this.name = "PublishingError";
  }
}

export type PostWhen = { kind: "now" } | { kind: "at"; at: Date };

interface Draft {
  text: string;
  topicTag?: string | null;
  when: PostWhen;
}

function checkDraft(draft: Draft, now: Date): Date {
  const problem = draftProblem(draft.text, draft.topicTag);
  if (problem) throw new PublishingError(problem);
  if (draft.when.kind === "now") return now;
  const at = draft.when.at;
  if (at.getTime() < now.getTime() - PAST_GRACE_MS) throw new PublishingError("past");
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * DAY_MS) throw new PublishingError("too_far");
  return at.getTime() < now.getTime() ? now : at;
}

async function requireConnected(profileId: string, now: Date) {
  const [token] = await db()
    .select({ expiresAt: threadsTokens.expiresAt })
    .from(threadsTokens)
    .where(eq(threadsTokens.profileId, profileId));
  if (!token || token.expiresAt <= now) throw new PublishingError("not_connected");
}

/**
 * Starts the publish run for this version of the post. The post is already
 * saved, so if the run can't start it isn't an error for the user (who might
 * otherwise try again and post twice): the sweeper starts one once it's due.
 */
async function startPublishRun(postId: string, version: number) {
  try {
    const [{ start }, { publishPost }] = await Promise.all([import("workflow/api"), import("@/workflows/publish")]);
    const run = await start(publishPost, [postId, version]);
    await db()
      .update(scheduledPosts)
      .set({ workflowRunId: run.runId })
      .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.version, version)));
  } catch (error) {
    console.error(`Couldn't start publishing ${postId}; the sweeper will pick it up.`, error);
  }
}

/** The suggestion id if it belongs to the profile; anything else is dropped. */
async function ownedSuggestion(profileId: string, suggestionId: string | null | undefined) {
  if (!suggestionId) return null;
  const [row] = await db()
    .select({ id: suggestions.id })
    .from(suggestions)
    .innerJoin(generations, eq(generations.id, suggestions.generationId))
    .where(and(eq(suggestions.id, suggestionId), eq(generations.profileId, profileId)));
  return row?.id ?? null;
}

export async function schedulePost(input: {
  profileId: string;
  text: string;
  topicTag?: string | null;
  suggestionId?: string | null;
  when: PostWhen;
  now?: Date;
}): Promise<{ id: string; scheduledFor: Date }> {
  const now = input.now ?? new Date();
  const scheduledFor = checkDraft(input, now);
  await requireConnected(input.profileId, now);

  const [{ pending }] = await db()
    .select({ pending: count() })
    .from(scheduledPosts)
    .where(
      and(eq(scheduledPosts.profileId, input.profileId), inArray(scheduledPosts.status, ["scheduled", "publishing"])),
    );
  if (pending >= MAX_PENDING) throw new PublishingError("too_many");

  const suggestionId = await ownedSuggestion(input.profileId, input.suggestionId);
  const row = await db().transaction(async (tx) => {
    const [created] = await tx
      .insert(scheduledPosts)
      .values({
        profileId: input.profileId,
        suggestionId,
        text: input.text.trim(),
        topicTag: normalizeTopic(input.topicTag),
        scheduledFor,
      })
      .returning({ id: scheduledPosts.id, version: scheduledPosts.version });
    if (suggestionId) await tx.update(suggestions).set({ status: "scheduled" }).where(eq(suggestions.id, suggestionId));
    return created;
  });
  await startPublishRun(row.id, row.version);
  return { id: row.id, scheduledFor };
}

/** Rows the user can still change: waiting to publish, or failed. */
const EDITABLE = ["scheduled", "failed"] as const;

/** New text, tag or time for a scheduled (or failed) post. */
export async function updatePost(
  profileId: string,
  postId: string,
  draft: Draft,
  now = new Date(),
): Promise<{ id: string; scheduledFor: Date }> {
  const scheduledFor = checkDraft(draft, now);
  await requireConnected(profileId, now);
  const [row] = await db()
    .update(scheduledPosts)
    .set({
      text: draft.text.trim(),
      topicTag: normalizeTopic(draft.topicTag),
      scheduledFor,
      status: "scheduled",
      version: sql`${scheduledPosts.version} + 1`,
      // Containers are made for one text and expire unpublished; start fresh.
      containerId: null,
      lastError: null,
    })
    .where(
      and(
        eq(scheduledPosts.id, postId),
        eq(scheduledPosts.profileId, profileId),
        inArray(scheduledPosts.status, [...EDITABLE]),
        sql`${scheduledPosts.mediaId} is null`,
      ),
    )
    .returning({ id: scheduledPosts.id, version: scheduledPosts.version });
  if (!row) throw new PublishingError(await whyNotEditable(profileId, postId));
  await startPublishRun(row.id, row.version);
  return { id: row.id, scheduledFor };
}

/** Publish a failed post again, now. */
export async function retryPost(profileId: string, postId: string, now = new Date()) {
  const [row] = await db()
    .select({ text: scheduledPosts.text, topicTag: scheduledPosts.topicTag, status: scheduledPosts.status })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.profileId, profileId)));
  if (!row) throw new PublishingError("not_found");
  if (row.status !== "failed") throw new PublishingError("not_editable");
  return updatePost(profileId, postId, { text: row.text, topicTag: row.topicTag, when: { kind: "now" } }, now);
}

/** Takes a post out of the queue; its idea goes back to the saved list. */
export async function cancelPost(profileId: string, postId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .update(scheduledPosts)
      .set({ status: "canceled", version: sql`${scheduledPosts.version} + 1` })
      .where(
        and(
          eq(scheduledPosts.id, postId),
          eq(scheduledPosts.profileId, profileId),
          inArray(scheduledPosts.status, [...EDITABLE]),
          sql`${scheduledPosts.mediaId} is null`,
        ),
      )
      .returning({ suggestionId: scheduledPosts.suggestionId });
    if (!row) throw new PublishingError(await whyNotEditable(profileId, postId));
    if (row.suggestionId) {
      await tx
        .update(suggestions)
        .set({ status: "saved" })
        .where(and(eq(suggestions.id, row.suggestionId), eq(suggestions.status, "scheduled")));
    }
  });
}

async function whyNotEditable(profileId: string, postId: string): Promise<PublishingProblem> {
  const [row] = await db()
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.profileId, profileId)));
  return row ? "not_editable" : "not_found";
}

/** Next post due to go out, for Home's "Up next". */
export async function nextScheduledPost(profileId: string, now = new Date()) {
  const [row] = await db()
    .select({ id: scheduledPosts.id, text: scheduledPosts.text, scheduledFor: scheduledPosts.scheduledFor })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.profileId, profileId),
        eq(scheduledPosts.status, "scheduled"),
        gt(scheduledPosts.scheduledFor, new Date(now.getTime() - PAST_GRACE_MS)),
      ),
    )
    .orderBy(scheduledPosts.scheduledFor)
    .limit(1);
  return row ?? null;
}
