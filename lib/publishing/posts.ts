import "server-only";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { generations, scheduledPosts, suggestions, threadsTokens } from "@/lib/db/schema";
import { type DraftProblem, MAX_SCHEDULE_DAYS, MAX_SERIES_PARTS, normalizeTopic, seriesProblem } from "./draft";

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
  | "not_connected"
  | "too_many_parts";

export class PublishingError extends Error {
  /** For a problem with one part of a series: which (1 is the first post). */
  constructor(
    readonly problem: PublishingProblem,
    readonly part?: number,
  ) {
    super(problem);
    this.name = "PublishingError";
  }
}

export type PostWhen = { kind: "now" } | { kind: "at"; at: Date };

interface Draft {
  text: string;
  topicTag?: string | null;
  /** The rest of a series, each posted as a reply to the one before. */
  seriesParts?: readonly string[];
  when: PostWhen;
}

function checkDraft(draft: Draft, now: Date): Date {
  const texts = [draft.text, ...(draft.seriesParts ?? [])];
  if (texts.length > MAX_SERIES_PARTS) throw new PublishingError("too_many_parts");
  const found = seriesProblem(texts, draft.topicTag);
  if (found) throw new PublishingError(found.problem, texts.length > 1 ? found.part : undefined);
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

const partsOf = (draft: Draft) => (draft.seriesParts ?? []).map((text) => ({ text: text.trim() }));

export async function schedulePost(input: {
  profileId: string;
  text: string;
  topicTag?: string | null;
  seriesParts?: readonly string[];
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
        seriesParts: partsOf(input),
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
      seriesParts: partsOf(draft),
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

/**
 * Publish a failed post again, now. A series that got partway picks up at
 * the first part that didn't go out; what's already posted stays as it is.
 */
export async function retryPost(profileId: string, postId: string, now = new Date()) {
  const [row] = await db()
    .select()
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.profileId, profileId)));
  if (!row) throw new PublishingError("not_found");
  if (row.status !== "failed") throw new PublishingError("not_editable");
  if (!row.mediaId) {
    const draft = { text: row.text, topicTag: row.topicTag, seriesParts: row.seriesParts.map((p) => p.text) };
    return updatePost(profileId, postId, { ...draft, when: { kind: "now" } }, now);
  }

  await requireConnected(profileId, now);
  const [resumed] = await db()
    .update(scheduledPosts)
    .set({
      status: "scheduled",
      scheduledFor: now,
      version: sql`${scheduledPosts.version} + 1`,
      // A part that didn't go out gets a fresh container.
      seriesParts: row.seriesParts.map((part) => (part.mediaId ? part : { text: part.text })),
      lastError: null,
    })
    .where(
      and(eq(scheduledPosts.id, postId), eq(scheduledPosts.version, row.version), eq(scheduledPosts.status, "failed")),
    )
    .returning({ id: scheduledPosts.id, version: scheduledPosts.version });
  if (!resumed) throw new PublishingError("not_editable");
  await startPublishRun(resumed.id, resumed.version);
  return { id: resumed.id, scheduledFor: now };
}

/**
 * Takes a post out of the queue; its idea goes back to the saved list. For a
 * series that failed partway, it keeps what went out and drops the rest.
 */
export async function cancelPost(profileId: string, postId: string): Promise<void> {
  if (await keepPostedParts(profileId, postId)) return;
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

/** A series that failed partway is published as far as it got. False for anything else. */
async function keepPostedParts(profileId: string, postId: string): Promise<boolean> {
  const [row] = await db()
    .select({ version: scheduledPosts.version, seriesParts: scheduledPosts.seriesParts })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.id, postId),
        eq(scheduledPosts.profileId, profileId),
        eq(scheduledPosts.status, "failed"),
        sql`${scheduledPosts.mediaId} is not null`,
      ),
    );
  if (!row) return false;
  const [kept] = await db()
    .update(scheduledPosts)
    .set({
      status: "published",
      seriesParts: row.seriesParts.filter((part) => part.mediaId),
      version: sql`${scheduledPosts.version} + 1`,
      lastError: null,
    })
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.version, row.version)))
    .returning({ id: scheduledPosts.id });
  if (!kept) throw new PublishingError("not_editable");
  return true;
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
