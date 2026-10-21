"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { threadsProfiles } from "@/lib/db/schema";
import { DRAFT_PROBLEMS, MAX_SCHEDULE_DAYS } from "@/lib/publishing/draft";
import {
  cancelPost,
  MAX_PENDING,
  type PostWhen,
  PublishingError,
  type PublishingProblem,
  retryPost,
  schedulePost,
  updatePost,
} from "@/lib/publishing/posts";
import { fromLocalInput } from "@/lib/publishing/slots";
import { getAccountIdentity } from "@/lib/session/identity";

export type ComposeResult = { ok: true; id: string; scheduledFor: string } | { ok: false; message: string };

const MESSAGES: Record<PublishingProblem, string> = {
  ...DRAFT_PROBLEMS,
  past: "That time has already passed. Pick a later one.",
  too_far: `Posts can be scheduled up to ${MAX_SCHEDULE_DAYS} days ahead.`,
  too_many: `You already have ${MAX_PENDING} posts waiting. Let some go out first.`,
  not_found: "That post isn't in your queue anymore.",
  not_editable: "That post has already gone out, or is publishing right now.",
  not_connected: "Reconnect your Threads account to post.",
};

const draftSchema = z.object({
  text: z.string().max(5_000),
  topicTag: z.string().max(100).optional(),
  suggestionId: z.uuid().optional(),
  /** "now", a slot's ISO time, or a datetime-local value in the profile's timezone. */
  when: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("now") }),
    z.object({ kind: z.literal("at"), iso: z.iso.datetime() }),
    z.object({ kind: z.literal("local"), value: z.string().max(20) }),
  ]),
});

type Identity = NonNullable<Awaited<ReturnType<typeof getAccountIdentity>>>;

async function resolveWhen(identity: Identity, when: z.infer<typeof draftSchema>["when"]): Promise<PostWhen | null> {
  if (when.kind === "now") return { kind: "now" };
  if (when.kind === "at") return { kind: "at", at: new Date(when.iso) };
  const [profile] = await db()
    .select({ timezone: threadsProfiles.timezone })
    .from(threadsProfiles)
    .where(eq(threadsProfiles.id, identity.profileId));
  const at = fromLocalInput(when.value, profile?.timezone ?? "UTC");
  return at ? { kind: "at", at } : null;
}

function refresh() {
  for (const path of ["/queue", "/home", "/studio"]) revalidatePath(path);
}

async function run(action: () => Promise<{ id: string; scheduledFor: Date }>): Promise<ComposeResult> {
  try {
    const { id, scheduledFor } = await action();
    refresh();
    return { ok: true, id, scheduledFor: scheduledFor.toISOString() };
  } catch (error) {
    if (error instanceof PublishingError) return { ok: false, message: MESSAGES[error.problem] };
    throw error;
  }
}

/** Queue a new post, to publish now or at a time. */
export async function schedulePostAction(input: unknown): Promise<ComposeResult> {
  const identity = await getAccountIdentity();
  const parsed = draftSchema.safeParse(input);
  if (!identity) return { ok: false, message: MESSAGES.not_connected };
  if (!parsed.success) return { ok: false, message: "Something in that post didn't look right. Try again." };
  const when = await resolveWhen(identity, parsed.data.when);
  if (!when) return { ok: false, message: "Pick a date and time." };
  return run(() =>
    schedulePost({
      profileId: identity.profileId,
      text: parsed.data.text,
      topicTag: parsed.data.topicTag,
      suggestionId: parsed.data.suggestionId,
      when,
    }),
  );
}

/** Change a queued post's text, tag or time (or post it now). */
export async function updatePostAction(id: string, input: unknown): Promise<ComposeResult> {
  const identity = await getAccountIdentity();
  const parsed = draftSchema.safeParse(input);
  if (!identity || !z.uuid().safeParse(id).success) return { ok: false, message: MESSAGES.not_found };
  if (!parsed.success) return { ok: false, message: "Something in that post didn't look right. Try again." };
  const when = await resolveWhen(identity, parsed.data.when);
  if (!when) return { ok: false, message: "Pick a date and time." };
  return run(() =>
    updatePost(identity.profileId, id, { text: parsed.data.text, topicTag: parsed.data.topicTag, when }),
  );
}

export async function retryPostAction(id: string): Promise<ComposeResult> {
  const identity = await getAccountIdentity();
  if (!identity || !z.uuid().safeParse(id).success) return { ok: false, message: MESSAGES.not_found };
  return run(() => retryPost(identity.profileId, id));
}

export async function cancelPostAction(id: string): Promise<{ ok: boolean; message?: string }> {
  const identity = await getAccountIdentity();
  if (!identity || !z.uuid().safeParse(id).success) return { ok: false, message: MESSAGES.not_found };
  try {
    await cancelPost(identity.profileId, id);
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof PublishingError) return { ok: false, message: MESSAGES[error.problem] };
    throw error;
  }
}
