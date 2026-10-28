import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { db } from "@/lib/db";
import { generations, posts, scheduledPosts, suggestions, threadsTokens } from "@/lib/db/schema";
import { closeDatabase, resetDatabase } from "@/test/db";
import { type FakeThreadsOptions, installFakeThreads } from "@/test/fake-threads";
import { cancelPost, nextScheduledPost, type PublishingError, retryPost, schedulePost, updatePost } from "./posts";
import {
  claimForPublishing,
  containerReady,
  markFailed,
  markPublished,
  PublishFailure,
  partCount,
  planPublish,
  prepareContainer,
  publishContainer,
  STUCK_PUBLISHING_MS,
  sweepPublishing,
} from "./publish";

// Publish runs can't start outside the Workflow runtime, so record them instead
// and drive the steps by hand, the way workflows/publish.ts does.
const started = vi.hoisted(() => [] as unknown[][]);
vi.mock("workflow/api", () => ({
  start: vi.fn(async (_workflow: unknown, args: unknown[]) => {
    started.push(args);
    return { runId: `run-${started.length}` };
  }),
}));

const PROFILE = "1789";
const HOUR = 3_600_000;
let fake: ReturnType<typeof installFakeThreads> | undefined;
let suggestionId: string;

function useThreads(options: Partial<FakeThreadsOptions> = {}) {
  fake = installFakeThreads({ posts: [], ...options });
  return fake;
}

async function row(id: string) {
  const [found] = await db().select().from(scheduledPosts).where(eq(scheduledPosts.id, id));
  return found;
}

/** The workflow's happy path, step by step: each part that hasn't gone out, then the record. */
async function publishParts(id: string, version: number) {
  expect(await planPublish(id, version)).toEqual({ action: "publish" });
  expect(await claimForPublishing(id, version)).toBe(true);
  const media: string[] = [];
  const parts = await partCount(id);
  for (let part = 0; part < parts; part++) {
    const container = await prepareContainer(id, part);
    if (!container) continue;
    expect(await containerReady(id, container)).toBe(true);
    media.push(await publishContainer(id, container, part));
  }
  await markPublished(id);
  return media;
}

const publishNow = async (id: string, version: number) => (await publishParts(id, version))[0];

beforeAll(async () => {
  await resetDatabase();
  const account = await provisionThreadsAccount({
    profile: {
      id: PROFILE,
      username: "maya.builds",
      name: "Maya Chen",
      biography: "",
      profilePictureUrl: null,
      isVerified: false,
    },
    accessToken: "token-1",
    expiresAt: new Date(Date.now() + 50 * 86_400_000),
    scopes: ["threads_basic", "threads_content_publish"],
  });
  const [generation] = await db()
    .insert(generations)
    .values({
      profileId: account.profileId,
      goal: "engagement",
      model: "x",
      promptVersion: "x",
      billingMode: "credits",
      status: "done",
    })
    .returning({ id: generations.id });
  const [idea] = await db()
    .insert(suggestions)
    .values({
      generationId: generation.id,
      text: "What's one tool you'd never give up?",
      format: "question",
      status: "saved",
    })
    .returning({ id: suggestions.id });
  suggestionId = idea.id;
});
beforeEach(async () => {
  started.length = 0;
  await db().delete(scheduledPosts);
  await db().delete(posts);
  await db().update(suggestions).set({ status: "saved", postedMediaId: null });
});
afterEach(() => fake?.restore());
afterAll(closeDatabase);

describe("scheduling", () => {
  it("rejects drafts Threads wouldn't take, and times out of range", async () => {
    const when = { kind: "at" as const, at: new Date(Date.now() + HOUR) };
    const problem = (p: Promise<unknown>) => p.catch((e: PublishingError) => e.problem);
    expect(await problem(schedulePost({ profileId: PROFILE, text: "  ", when }))).toBe("empty");
    expect(await problem(schedulePost({ profileId: PROFILE, text: "🔥".repeat(130), when }))).toBe("too_long");
    expect(await problem(schedulePost({ profileId: PROFILE, text: "Hi", topicTag: "a.b", when }))).toBe("bad_topic");
    expect(
      await problem(
        schedulePost({ profileId: PROFILE, text: "Hi", when: { kind: "at", at: new Date(Date.now() - 2 * HOUR) } }),
      ),
    ).toBe("past");
    expect(
      await problem(
        schedulePost({
          profileId: PROFILE,
          text: "Hi",
          when: { kind: "at", at: new Date(Date.now() + 90 * 24 * HOUR) },
        }),
      ),
    ).toBe("too_far");
    expect(started).toHaveLength(0);
  });

  it("queues the post, marks its idea scheduled, and starts a run for it", async () => {
    const at = new Date(Date.now() + 2 * HOUR);
    const { id } = await schedulePost({
      profileId: PROFILE,
      text: "What's one tool you'd never give up?",
      topicTag: "#Productivity",
      suggestionId,
      when: { kind: "at", at },
    });
    expect(await row(id)).toMatchObject({
      status: "scheduled",
      version: 0,
      topicTag: "Productivity",
      workflowRunId: "run-1",
    });
    expect(started).toEqual([[id, 0]]);
    const [idea] = await db().select().from(suggestions).where(eq(suggestions.id, suggestionId));
    expect(idea.status).toBe("scheduled");
    // The run sleeps until the post's time.
    expect(await planPublish(id, 0)).toEqual({ action: "wait", until: at.toISOString() });
    expect((await nextScheduledPost(PROFILE))?.id).toBe(id);
  });
});

describe("publishing", () => {
  it("publishes once, then records the post, its link and its idea", async () => {
    const threads = useThreads();
    const { id } = await schedulePost({
      profileId: PROFILE,
      text: "Shipping today.",
      suggestionId,
      when: { kind: "now" },
    });

    const media = await publishNow(id, 0);
    // A second claim, or a retried step, doesn't post again.
    expect(await claimForPublishing(id, 0)).toBe(false);
    expect(await publishContainer(id, "container-1")).toBe(media);
    expect(threads.published).toHaveLength(1);

    expect(await row(id)).toMatchObject({
      status: "published",
      mediaId: media,
      permalink: `https://www.threads.net/@maya.builds/post/${media}`,
      attempts: 1,
    });
    const [post] = await db().select().from(posts).where(eq(posts.id, media));
    expect(post).toMatchObject({ text: "Shipping today.", viaThreaded: true, profileId: PROFILE });
    const [idea] = await db().select().from(suggestions).where(eq(suggestions.id, suggestionId));
    expect(idea).toMatchObject({ status: "posted", postedMediaId: media });
    expect(await planPublish(id, 0)).toEqual({ action: "stop", reason: "published" });
  });

  it("waits while Threads prepares the container, and fails on a container error", async () => {
    useThreads({ publishing: { containerStatuses: ["IN_PROGRESS", "FINISHED"] } });
    const { id } = await schedulePost({ profileId: PROFILE, text: "One", when: { kind: "now" } });
    await claimForPublishing(id, 0);
    const container = (await prepareContainer(id)) as string;
    expect(await containerReady(id, container)).toBe(false);
    expect(await containerReady(id, container)).toBe(true);
    fake?.restore();

    useThreads({ publishing: { containerStatuses: ["ERROR"] } });
    const { id: broken } = await schedulePost({ profileId: PROFILE, text: "Two", when: { kind: "now" } });
    await claimForPublishing(broken, 0);
    const failing = (await prepareContainer(broken)) as string;
    await expect(containerReady(broken, failing)).rejects.toThrow(
      "Threads couldn't prepare the post: Media upload failed",
    );
  });

  it("stops at the daily quota with a message the user can act on", async () => {
    useThreads({ publishing: { quotaUsed: 250 } });
    const { id } = await schedulePost({ profileId: PROFILE, text: "Too many", when: { kind: "now" } });
    await claimForPublishing(id, 0);
    const error = await prepareContainer(id).catch((e) => e);
    expect(error).toBeInstanceOf(PublishFailure);
    expect(error.message).toContain("limit of 250 posts");

    await markFailed(id, 0, error.message);
    expect(await row(id)).toMatchObject({ status: "failed", lastError: error.message });
  });

  it("asks the user to reconnect when Threads rejects the token", async () => {
    useThreads({ authFailures: ["/me/threads_publishing_limit"] });
    const { id } = await schedulePost({ profileId: PROFILE, text: "Auth", when: { kind: "now" } });
    await claimForPublishing(id, 0);
    await expect(prepareContainer(id)).rejects.toThrow("Reconnect your account");
    // The token is gone, so the app shows the reconnect banner.
    expect(await db().select().from(threadsTokens)).toHaveLength(0);
    await db()
      .insert(threadsTokens)
      .values({
        profileId: PROFILE,
        accessTokenEnc: (await import("@/lib/crypto/secrets")).encryptSecret(
          "token-1",
          (await import("@/lib/accounts/provision")).tokenContext(PROFILE),
        ),
        expiresAt: new Date(Date.now() + 50 * 86_400_000),
        scopes: ["threads_basic"],
      });
  });

  it("records a post that got a media id as published, even if a later step failed", async () => {
    useThreads();
    const { id } = await schedulePost({ profileId: PROFILE, text: "Half done", when: { kind: "now" } });
    await claimForPublishing(id, 0);
    await publishContainer(id, (await prepareContainer(id)) as string);
    await markFailed(id, 0, "Threads didn't respond.");
    expect((await row(id)).status).toBe("published");
  });
});

describe("changing a scheduled post", () => {
  it("stops the old run when the post is edited, and starts a new one", async () => {
    const { id } = await schedulePost({
      profileId: PROFILE,
      text: "Draft",
      when: { kind: "at", at: new Date(Date.now() + 5 * HOUR) },
    });
    const sooner = new Date(Date.now() + HOUR);
    await updatePost(PROFILE, id, { text: "Final", when: { kind: "at", at: sooner } });
    expect(await row(id)).toMatchObject({ text: "Final", version: 1, scheduledFor: sooner });
    expect(started).toEqual([
      [id, 0],
      [id, 1],
    ]);
    expect(await planPublish(id, 0)).toEqual({ action: "stop", reason: "superseded" });
    expect(await claimForPublishing(id, 0)).toBe(false);
  });

  it("cancels back to the saved idea, and won't touch a published post", async () => {
    const { id } = await schedulePost({
      profileId: PROFILE,
      text: "Maybe",
      suggestionId,
      when: { kind: "at", at: new Date(Date.now() + HOUR) },
    });
    await cancelPost(PROFILE, id);
    expect((await row(id)).status).toBe("canceled");
    const [idea] = await db().select().from(suggestions).where(eq(suggestions.id, suggestionId));
    expect(idea.status).toBe("saved");
    expect(await planPublish(id, 0)).toEqual({ action: "stop", reason: "superseded" });

    useThreads();
    const { id: live } = await schedulePost({ profileId: PROFILE, text: "Live", when: { kind: "now" } });
    await publishNow(live, 0);
    await expect(cancelPost(PROFILE, live)).rejects.toMatchObject({ problem: "not_editable" });
    await expect(cancelPost("someone-else", live)).rejects.toMatchObject({ problem: "not_found" });
  });

  it("retries a failed post now, with a fresh container", async () => {
    useThreads({ publishing: { quotaUsed: 250 } });
    const { id } = await schedulePost({ profileId: PROFILE, text: "Again", when: { kind: "now" } });
    await claimForPublishing(id, 0);
    await prepareContainer(id).catch((e: Error) => markFailed(id, 0, e.message));
    fake?.restore();

    const threads = useThreads();
    await retryPost(PROFILE, id);
    expect(await row(id)).toMatchObject({ status: "scheduled", version: 1, lastError: null, containerId: null });
    await publishNow(id, 1);
    expect(threads.published.map((p) => p.text)).toEqual(["Again"]);
  });
});

describe("series", () => {
  const rest = ["Part two: the setup.", "Part three: what we learned."];
  const series = (extra: Partial<Parameters<typeof schedulePost>[0]> = {}) =>
    schedulePost({ profileId: PROFILE, text: "Part one: why.", seriesParts: rest, when: { kind: "now" }, ...extra });

  /** Publishes the first part, then stops as if Threads stopped answering. */
  async function stopAfterFirst(id: string) {
    await claimForPublishing(id, 0);
    const first = await publishContainer(id, (await prepareContainer(id, 0)) as string, 0);
    await prepareContainer(id, 1);
    return first;
  }

  it("checks every part, and how many there are", async () => {
    const when = { kind: "now" as const };
    const error = await schedulePost({
      profileId: PROFILE,
      text: "One",
      seriesParts: ["Two", "🔥".repeat(130)],
      when,
    }).catch((e) => e);
    expect(error).toMatchObject({ problem: "too_long", part: 3 });
    const eleven = Array.from({ length: 10 }, (_, i) => `Part ${i + 2}`);
    expect(
      await schedulePost({ profileId: PROFILE, text: "One", seriesParts: eleven, when }).catch((e) => e.problem),
    ).toBe("too_many_parts");
    // A single post's problem doesn't name a part.
    expect(await schedulePost({ profileId: PROFILE, text: " ", when }).catch((e) => e.part)).toBeUndefined();
    expect(started).toHaveLength(0);
  });

  it("posts each part as a reply to the one before, with the topic tag on the first", async () => {
    const threads = useThreads();
    const { id } = await series({ topicTag: "BuildInPublic", suggestionId });
    const media = await publishParts(id, 0);
    expect(threads.published.map(({ text, topicTag, replyToId }) => ({ text, topicTag, replyToId }))).toEqual([
      { text: "Part one: why.", topicTag: "BuildInPublic", replyToId: null },
      { text: rest[0], topicTag: null, replyToId: media[0] },
      { text: rest[1], topicTag: null, replyToId: media[1] },
    ]);
    const published = await row(id);
    expect(published).toMatchObject({ status: "published", mediaId: media[0] });
    expect(published.seriesParts.map((part) => part.mediaId)).toEqual(media.slice(1));
    // The first post is the one on the profile, and the one the idea is scored on.
    expect((await db().select().from(posts)).map((post) => post.id)).toEqual([media[0]]);
    const [idea] = await db().select().from(suggestions).where(eq(suggestions.id, suggestionId));
    expect(idea).toMatchObject({ status: "posted", postedMediaId: media[0] });
  });

  it("stops partway, then a retry posts the rest without repeating what went out", async () => {
    const threads = useThreads();
    const { id } = await series();
    const first = await stopAfterFirst(id);
    await markFailed(id, 0, "Threads didn't respond. Retry in a few minutes.");
    expect(await row(id)).toMatchObject({
      status: "failed",
      mediaId: first,
      lastError: "Part 1 of 3 is live, but the series stopped there. Threads didn't respond. Retry in a few minutes.",
    });
    // What's live is recorded, and can't be edited any more.
    expect((await db().select().from(posts)).map((post) => post.id)).toEqual([first]);
    await expect(updatePost(PROFILE, id, { text: "New", when: { kind: "now" } })).rejects.toMatchObject({
      problem: "not_editable",
    });

    await retryPost(PROFILE, id);
    const resumed = await row(id);
    expect(resumed).toMatchObject({ status: "scheduled", version: 1, lastError: null, mediaId: first });
    // The part that stopped gets a fresh container.
    expect(resumed.seriesParts[0]).toEqual({ text: rest[0] });
    expect(started.at(-1)).toEqual([id, 1]);

    await publishParts(id, 1);
    expect(threads.published.map((post) => post.text)).toEqual(["Part one: why.", ...rest]);
    expect(threads.published[1].replyToId).toBe(first);
    expect(await row(id)).toMatchObject({ status: "published", lastError: null });
  });

  it("keeps what went out when a stopped series is removed", async () => {
    useThreads();
    const { id } = await series();
    await stopAfterFirst(id);
    await markFailed(id, 0, "Threads didn't respond.");
    await cancelPost(PROFILE, id);
    const kept = await row(id);
    expect(kept).toMatchObject({ status: "published", lastError: null });
    expect(kept.seriesParts).toEqual([]);
  });

  it("the sweeper records a series whose run died partway", async () => {
    useThreads();
    const { id } = await series();
    await stopAfterFirst(id);
    await db()
      .update(scheduledPosts)
      .set({ publishingAt: new Date(Date.now() - STUCK_PUBLISHING_MS - 60_000) })
      .where(eq(scheduledPosts.id, id));
    expect((await sweepPublishing()).stuck).toBe(1);
    const swept = await row(id);
    expect(swept.status).toBe("failed");
    expect(swept.lastError).toMatch(/^Part 1 of 3 is live, but the series stopped there\. We couldn't confirm/);
  });
});

describe("sweeper", () => {
  it("restarts overdue posts and fails ones stuck mid-publish", async () => {
    const { id: overdue } = await schedulePost({ profileId: PROFILE, text: "Overdue", when: { kind: "now" } });
    await db()
      .update(scheduledPosts)
      .set({ scheduledFor: new Date(Date.now() - HOUR) })
      .where(eq(scheduledPosts.id, overdue));
    const { id: stuck } = await schedulePost({ profileId: PROFILE, text: "Stuck", when: { kind: "now" } });
    await claimForPublishing(stuck, 0, new Date(Date.now() - STUCK_PUBLISHING_MS - 60_000));
    const { id: fine } = await schedulePost({
      profileId: PROFILE,
      text: "Later",
      when: { kind: "at", at: new Date(Date.now() + HOUR) },
    });
    started.length = 0;

    expect(await sweepPublishing()).toEqual({ restarted: [overdue], stuck: 1 });
    expect(started).toEqual([[overdue, 1]]);
    expect(await row(stuck)).toMatchObject({ status: "failed" });
    expect((await row(stuck)).lastError).toContain("couldn't confirm");
    expect((await row(fine)).version).toBe(0);
  });
});
