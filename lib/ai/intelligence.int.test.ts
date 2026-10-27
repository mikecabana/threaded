import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { latestDna, loadPostFeatures } from "@/lib/data/intelligence";
import { db } from "@/lib/db";
import { postFeatures, postMetrics, posts, profileDna, threadsProfiles, wallets } from "@/lib/db/schema";
import { TRIAL_CREDITS } from "@/lib/pricing";
import { closeDatabase, resetDatabase } from "@/test/db";
import { classifyPosts, pendingClassification, refreshTopics } from "./classify";
import { CLASSIFIER_MODEL, CLASSIFIER_VERSION } from "./classify-questions";
import { buildDna, dnaDue } from "./dna";
import { startGeneration } from "./generate";
import { mockCalls, mockDecisions } from "./mock-model";
import { generateRequestSchema } from "./schemas";

const now = new Date();
const DAY_MS = 86_400_000;
let profileId: string;
let workspaceId: string;
let userId: string;

/** 26 posts: questions draw replies, hot takes draw views, links fall flat. */
function seedPosts() {
  return Array.from({ length: 26 }, (_, i) => {
    const kind = i % 4;
    const text = [
      `Hot take: shipping weekly beats planning monthly (${i})`,
      `What's your favourite debugging trick? Asking for round ${i}`,
      `Notes from building in public, week ${i}`,
      `Worth reading on pricing https://example.com/${i}`,
    ][kind];
    return {
      post: {
        id: `p${i}`,
        profileId,
        text,
        mediaType: "TEXT_POST",
        postedAt: new Date(now.getTime() - (5 + i) * DAY_MS),
      },
      metrics: {
        postId: `p${i}`,
        capturedAt: now,
        views: [6000, 1500, 1800, 500][kind] + i * 10,
        likes: [120, 40, 45, 5][kind],
        replies: [10, 60, 8, 0][kind],
        reposts: [30, 2, 4, 0][kind],
        quotes: [6, 1, 1, 0][kind],
        shares: [8, 1, 2, 0][kind],
      },
    };
  });
}

async function wallet() {
  const [row] = await db().select().from(wallets).where(eq(wallets.workspaceId, workspaceId));
  return row;
}

beforeAll(async () => {
  await resetDatabase();
  const account = await provisionThreadsAccount({
    profile: {
      id: "5151",
      username: "sam.ships",
      name: "Sam Ortiz",
      biography: "Indie dev. Shipping weekly.",
      profilePictureUrl: null,
      isVerified: false,
    },
    accessToken: "t",
    expiresAt: new Date(Date.now() + 50 * DAY_MS),
    scopes: ["threads_basic"],
  });
  profileId = account.profileId;
  workspaceId = account.workspaceId;
  userId = account.userId;
  const seeded = seedPosts();
  await db()
    .insert(posts)
    .values([
      ...seeded.map((s) => s.post),
      // An image with no caption: nothing to classify.
      { id: "img", profileId, text: "", mediaType: "IMAGE", postedAt: new Date(now.getTime() - 3 * DAY_MS) },
    ]);
  await db()
    .insert(postMetrics)
    .values(seeded.map((s) => s.metrics));
});
beforeEach(() => {
  process.env.AI_MOCK = "1";
  mockCalls.length = 0;
  mockDecisions.length = 0;
});

async function storedTopics() {
  const [row] = await db()
    .select({ topics: threadsProfiles.topics })
    .from(threadsProfiles)
    .where(eq(threadsProfiles.id, profileId));
  return row.topics;
}
afterEach(() => {
  process.env.AI_MOCK = "";
});
afterAll(closeDatabase);

describe("post classification", () => {
  it("lists posts with text that aren't labelled yet, newest first", async () => {
    const pending = await pendingClassification(profileId);
    expect(pending).toHaveLength(26);
    expect(pending[0]).toBe("p0");
    expect(pending).not.toContain("img");
  });

  it("names the author's topics first, once", async () => {
    expect(await refreshTopics(profileId, now)).toEqual({ topics: 4, refreshed: true });
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]).toMatchObject({ task: "classify", prompt: expect.stringContaining('[1] """Hot take:') });
    expect((await storedTopics())?.list.map((t) => t.name).sort()).toEqual([
      "building",
      "favourite",
      "reading",
      "shipping",
    ]);
    // A fresh list isn't asked for again.
    expect(await refreshTopics(profileId, now)).toEqual({ topics: 4, refreshed: false });
    expect(mockCalls).toHaveLength(1);
  });

  it("leaves posts pending when the model fails", async () => {
    process.env.AI_MOCK = "error";
    const pending = await pendingClassification(profileId);
    expect(await classifyPosts(profileId, pending)).toEqual({ classified: 0, ok: false });
    expect(await pendingClassification(profileId)).toHaveLength(26);
  });

  it("skips quietly when no model is reachable", async () => {
    process.env.AI_MOCK = "";
    expect(await classifyPosts(profileId, ["p0"])).toEqual({ classified: 0, ok: false });
    expect(mockDecisions).toHaveLength(0);
  });

  it("asks Jev about each post and files it under the author's topics", async () => {
    const pending = await pendingClassification(profileId);
    expect(await classifyPosts(profileId, pending)).toEqual({ classified: 26, ok: true });
    expect(mockDecisions).toHaveLength(26);
    expect(mockDecisions[0].questions).toEqual(["format", "hook", "tone", "topic"]);
    expect(await pendingClassification(profileId)).toEqual([]);

    const [stored] = await db().select().from(postFeatures).where(eq(postFeatures.postId, "p1"));
    expect(stored).toMatchObject({
      version: CLASSIFIER_VERSION,
      format: "question",
      topic: "favourite",
      model: CLASSIFIER_MODEL,
    });
    const features = await loadPostFeatures(profileId);
    expect(features.size).toBe(26);
    expect(features.get("p0")).toMatchObject({ format: "hot_take", topic: "shipping" });
    // Background work on credits is on us.
    expect(await wallet()).toMatchObject({ balance: TRIAL_CREDITS, reserved: 0 });
  });

  it("doesn't label a post twice", async () => {
    expect(await classifyPosts(profileId, ["p0", "p1"])).toEqual({ classified: 2, ok: true });
    const rows = await db().select().from(postFeatures).where(eq(postFeatures.postId, "p0"));
    expect(rows).toHaveLength(1);
  });

  it("refreshes stale topics when too many posts fit none, and files those posts again", async () => {
    const weekAgo = new Date(now.getTime() - 8 * DAY_MS).toISOString();
    await db()
      .update(threadsProfiles)
      .set({ topics: { list: [{ name: "shipping", description: "Releasing work" }], updatedAt: weekAgo } })
      .where(eq(threadsProfiles.id, profileId));
    await db().delete(postFeatures);
    await classifyPosts(profileId, await pendingClassification(profileId));
    // Only the hot takes mention shipping; the other 19 posts fit no topic.
    expect((await loadPostFeatures(profileId)).get("p1")?.topic).toBeNull();

    expect(await refreshTopics(profileId, now)).toEqual({ topics: 4, refreshed: true });
    // Existing topics keep their place and name; new ones follow.
    expect((await storedTopics())?.list[0]).toEqual({ name: "shipping", description: "Releasing work" });
    const relabel = await pendingClassification(profileId);
    expect(relabel).toHaveLength(19);
    expect(relabel).not.toContain("p0");
    await classifyPosts(profileId, relabel);
    expect((await loadPostFeatures(profileId)).get("p1")?.topic).toBe("favourite");
  });

  it("files posts labelled before the first topic list again once it's named", async () => {
    // The first naming failed, so every post was labelled with no topic to pick.
    await db().update(threadsProfiles).set({ topics: null }).where(eq(threadsProfiles.id, profileId));
    await db().delete(postFeatures);
    await classifyPosts(profileId, await pendingClassification(profileId));
    expect([...(await loadPostFeatures(profileId)).values()].every((f) => f.topic === null)).toBe(true);

    expect(await refreshTopics(profileId, now)).toEqual({ topics: 4, refreshed: true });
    expect(await pendingClassification(profileId)).toHaveLength(26);
    await classifyPosts(profileId, await pendingClassification(profileId));
    expect((await loadPostFeatures(profileId)).get("p1")?.topic).toBe("favourite");
  });
});

describe("Profile DNA", () => {
  it("is due once there are enough posts and none exists", async () => {
    expect(await dnaDue(profileId, now)).toBe(true);
  });

  it("stores a DNA whose claims carry our own numbers", async () => {
    const result = await buildDna(profileId, now);
    expect(result).toEqual({ ok: true, version: 1 });
    expect(mockCalls.at(-1)?.task).toBe("dna");
    // The model sees labelled posts and numbered facts.
    expect(mockCalls.at(-1)?.prompt).toMatch(/^F1 /m);
    expect(mockCalls.at(-1)?.prompt).toContain("(Hot take · ");

    const stored = await latestDna(profileId);
    expect(stored).toMatchObject({ version: 1, model: "anthropic/claude-sonnet-5.5" });
    const dna = stored?.dna;
    expect(dna?.postsAnalyzed).toBe(26);
    expect(dna?.rewards.length).toBeGreaterThan(0);
    expect(dna?.rewards.every((r) => r.fact.multiplier > 1 && /×|almost no/.test(r.fact.text))).toBe(true);
    expect(dna?.blindSpots.every((b) => b.fact.multiplier < 1)).toBe(true);
    // Phrases the author never wrote twice are dropped.
    expect(dna?.voice.signaturePhrases).toEqual(["Hot take:"]);
    expect(dna?.topics.some((t) => t.core)).toBe(true);
    expect(dna?.stats.posts).toBe(26);
  });

  it("isn't rebuilt within a week, then is, as a new version", async () => {
    expect(await dnaDue(profileId, now)).toBe(false);
    const nextWeek = new Date(now.getTime() + 7 * DAY_MS);
    expect(await dnaDue(profileId, nextWeek)).toBe(true);
    expect(await buildDna(profileId, nextWeek)).toEqual({ ok: true, version: 2 });
    expect((await latestDna(profileId))?.version).toBe(2);
  });

  it("keeps the last DNA when the model fails", async () => {
    process.env.AI_MOCK = "error";
    expect(await buildDna(profileId, now)).toEqual({ ok: false, version: null });
    expect((await latestDna(profileId))?.version).toBe(2);
  });

  it("treats DNA in an older shape as missing, so it's rebuilt", async () => {
    await db()
      .insert(profileDna)
      .values({ profileId, version: 3, data: { schema: 0 }, model: "old" });
    expect(await latestDna(profileId)).toBeNull();
    expect(await dnaDue(profileId, now)).toBe(true);
    await db().delete(profileDna).where(eq(profileDna.version, 3));
  });

  it("shapes Studio's prompt: voice guide, labelled examples, on-topic posts first", async () => {
    const request = generateRequestSchema.parse({ goal: "engagement", topic: "shipping faster", count: 3 });
    const response = await startGeneration({ identity: { userId, workspaceId, profileId }, request });
    expect(response.status).toBe(200);
    await response.text();
    const prompt = mockCalls.findLast((c) => c.task === "generate")?.prompt ?? "";
    expect(prompt).toContain("Voice guide, learned from 26 of their posts:");
    expect(prompt).toContain("What their audience rewards:");
    expect(prompt).toMatch(/\(Question · \w+; [\d.,k]+ views/);
    expect(prompt).toContain("They've written about shipping before");
  });

  it("waits for ten posts with text", async () => {
    await db().delete(posts).where(eq(posts.profileId, profileId));
    await db().delete(profileDna).where(eq(profileDna.profileId, profileId));
    expect(await dnaDue(profileId, now)).toBe(false);
    expect(await buildDna(profileId, now)).toEqual({ ok: false, version: null });
  });
});
