import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { provisionThreadsAccount, tokenContext } from "@/lib/accounts/provision";
import { decryptSecret } from "@/lib/crypto/secrets";
import { loadProfileDataset } from "@/lib/data/dataset";
import { db } from "@/lib/db";
import { accountDaily, postMetrics, posts, threadsProfiles, threadsTokens } from "@/lib/db/schema";
import { ThreadsApiError } from "@/lib/threads/errors";
import { closeDatabase, resetDatabase } from "@/test/db";
import { type FakePost, installFakeThreads } from "@/test/fake-threads";
import { clientForProfile, NotConnectedError } from "./client";
import {
  finishSyncRun,
  hasActiveSyncRun,
  latestSyncRun,
  recentDays,
  startSyncRun,
  syncAccountDays,
  syncPostInsights,
  syncPosts,
} from "./sync";

const PROFILE = "1789";
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

const fakePosts: FakePost[] = [
  {
    id: "p3",
    text: "Which one would you pick?",
    timestamp: daysAgo(1),
    insights: { views: 900, likes: 40, replies: 22 },
  },
  { id: "p2", text: "Shipped dark mode 🌙", timestamp: daysAgo(4), insights: { views: 1500, likes: 70, reposts: 9 } },
  { id: "r1", text: "", timestamp: daysAgo(5), media_type: "REPOST_FACADE" },
  { id: "p1", text: "Read this https://example.com", timestamp: daysAgo(20), insights: { views: 400, likes: 12 } },
  { id: "old", text: "Ancient history", timestamp: daysAgo(400), insights: { views: 10 } },
];

async function provision(expiresInDays = 50) {
  await provisionThreadsAccount({
    profile: {
      id: PROFILE,
      username: "maya.builds",
      name: "Maya Chen",
      biography: "",
      profilePictureUrl: null,
      isVerified: false,
    },
    accessToken: "token-1",
    expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000),
    scopes: ["threads_basic", "threads_manage_insights"],
  });
}

let restore: (() => void) | undefined;
beforeAll(async () => {
  await resetDatabase();
  await provision();
});
afterEach(() => restore?.());
afterAll(closeDatabase);

describe("sync", () => {
  it("syncs the profile's own posts across pages, skipping reposts and old posts", async () => {
    ({ restore } = installFakeThreads({ posts: fakePosts, pageSize: 2 }));
    const ids = await syncPosts(PROFILE, 365, now);
    expect(ids).toEqual(["p3", "p2", "p1"]);

    const rows = await db().select().from(posts).where(eq(posts.profileId, PROFILE)).orderBy(posts.id);
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
    expect(rows.find((r) => r.id === "p1")).toMatchObject({ hasLink: true, hasQuestion: false });
    expect(rows.find((r) => r.id === "p3")).toMatchObject({ hasQuestion: true });
    // The moon emoji counts as its 4 UTF-8 bytes.
    expect(rows.find((r) => r.id === "p2")?.length).toBe("Shipped dark mode ".length + 4);

    // Re-running is a no-op apart from refreshing fields.
    expect(await syncPosts(PROFILE, 365, now)).toHaveLength(3);
    expect(await db().select().from(posts)).toHaveLength(3);
  });

  it("snapshots insights, and the dataset reads the newest snapshot", async () => {
    ({ restore } = installFakeThreads({ posts: fakePosts }));
    expect(await syncPostInsights(PROFILE, ["p3", "p2", "p1", "missing"], new Date(now.getTime() - 3_600_000))).toBe(3);

    const updated = fakePosts.map((p) => (p.id === "p3" ? { ...p, insights: { ...p.insights, views: 1200 } } : p));
    restore();
    ({ restore } = installFakeThreads({ posts: updated }));
    await syncPostInsights(PROFILE, ["p3"], now);

    expect(await db().select().from(postMetrics).where(eq(postMetrics.postId, "p3"))).toHaveLength(2);
    const data = await loadProfileDataset(
      { id: PROFILE, username: "maya.builds", name: "Maya", biography: "", profilePictureUrl: null, isVerified: false },
      now,
    );
    expect(data.posts.find((p) => p.id === "p3")?.insights.views).toBe(1200);
  });

  it("writes account days and snapshots followers on the latest day only", async () => {
    ({ restore } = installFakeThreads({ posts: fakePosts, followers: 2412, dailyViews: 321 }));
    const days = recentDays(3, now);
    // Two batches, like the workflow runs them: only yesterday gets the follower count.
    expect(await syncAccountDays(PROFILE, days.slice(0, 2), { now })).toBe(2);
    expect(await syncAccountDays(PROFILE, days.slice(2), { now })).toBe(1);

    const rows = await db()
      .select()
      .from(accountDaily)
      .where(eq(accountDaily.profileId, PROFILE))
      .orderBy(accountDaily.date);
    expect(rows.map((r) => r.date)).toEqual(days);
    expect(rows.map((r) => r.followersCount)).toEqual([null, null, 2412]);
    expect(rows[0]).toMatchObject({ views: 321, likes: 7, replies: 2, clicks: 3 });
  });

  it("tracks runs and marks the profile synced", async () => {
    const runId = await startSyncRun(PROFILE, "initial");
    expect(await hasActiveSyncRun(PROFILE)).toBe(true);
    await finishSyncRun(runId, PROFILE, { ok: true, stats: { posts: 3 } });
    expect(await hasActiveSyncRun(PROFILE)).toBe(false);
    expect(await latestSyncRun(PROFILE)).toMatchObject({ status: "succeeded", step: "done", stats: { posts: 3 } });
    const [profile] = await db().select().from(threadsProfiles).where(eq(threadsProfiles.id, PROFILE));
    expect(profile.lastSyncedAt).not.toBeNull();
  });
});

describe("tokens", () => {
  it("refreshes a token that's close to expiring", async () => {
    ({ restore } = installFakeThreads({ posts: fakePosts }));
    await db()
      .update(threadsTokens)
      .set({ expiresAt: new Date(now.getTime() + 5 * 86_400_000) })
      .where(eq(threadsTokens.profileId, PROFILE));
    await clientForProfile(PROFILE, now);

    const [token] = await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, PROFILE));
    expect(decryptSecret(token.accessTokenEnc, tokenContext(PROFILE))).toBe("refreshed-token");
    expect(token.lastRefreshedAt).not.toBeNull();
    expect(token.expiresAt.getTime()).toBeGreaterThan(now.getTime() + 50 * 86_400_000);
  });

  it("disconnects the profile when Threads rejects the token", async () => {
    ({ restore } = installFakeThreads({ posts: fakePosts, authFailures: ["/me/threads"] }));
    await expect(syncPosts(PROFILE, 30, now)).rejects.toBeInstanceOf(ThreadsApiError);
    expect(await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, PROFILE))).toHaveLength(0);
    await expect(clientForProfile(PROFILE, now)).rejects.toBeInstanceOf(NotConnectedError);
  });
});
