import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret } from "@/lib/crypto/secrets";
import { sha256 } from "@/lib/crypto/sign";
import { loadProfileDataset } from "@/lib/data/dataset";
import { db } from "@/lib/db";
import {
  accountDaily,
  creditLedger,
  deletionRequests,
  postMetrics,
  posts,
  sessions,
  threadsProfiles,
  threadsTokens,
  users,
  wallets,
} from "@/lib/db/schema";
import { TRIAL_CREDITS } from "@/lib/pricing";
import { readSessionUserId } from "@/lib/session/session";
import type { ThreadsProfile } from "@/lib/threads/types";
import { closeDatabase, resetDatabase } from "@/test/db";
import { deleteThreadsData, disconnectThreadsProfile, provisionThreadsAccount, tokenContext } from "./provision";

const profile: ThreadsProfile = {
  id: "1789",
  username: "maya.builds",
  name: "Maya Chen",
  biography: "Building Tidy",
  profilePictureUrl: null,
  isVerified: false,
};
const expiresAt = new Date("2026-12-19T00:00:00Z");
const scopes = ["threads_basic", "threads_manage_insights"];

beforeAll(resetDatabase);
afterAll(closeDatabase);

describe("provisionThreadsAccount", () => {
  it("creates the account, encrypts the token and grants the trial", async () => {
    const result = await provisionThreadsAccount({
      profile,
      accessToken: "token-1",
      expiresAt,
      scopes,
      timezone: "America/Toronto",
    });
    expect(result).toMatchObject({ profileId: "1789", isNewProfile: true, trialGranted: true });

    const [wallet] = await db().select().from(wallets).where(eq(wallets.workspaceId, result.workspaceId));
    expect(wallet.balance).toBe(TRIAL_CREDITS);

    const [stored] = await db().select().from(threadsProfiles).where(eq(threadsProfiles.id, "1789"));
    expect(stored).toMatchObject({ timezone: "America/Toronto", activeGoal: "engagement" });
    expect(stored.trialGrantedAt).not.toBeNull();

    const [token] = await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, "1789"));
    expect(token.accessTokenEnc).not.toContain("token-1");
    expect(decryptSecret(token.accessTokenEnc, tokenContext("1789"))).toBe("token-1");
  });

  it("signs the same account back in without a second trial", async () => {
    const first = await db().select().from(users);
    const result = await provisionThreadsAccount({
      profile: { ...profile, username: "maya.ships", isVerified: true },
      accessToken: "token-2",
      expiresAt,
      scopes,
      timezone: "Europe/London",
    });
    expect(result).toMatchObject({ isNewProfile: false, trialGranted: false });
    expect(await db().select().from(users)).toHaveLength(first.length);

    const [stored] = await db().select().from(threadsProfiles).where(eq(threadsProfiles.id, "1789"));
    // Profile details refresh; the timezone chosen at sign-up stays.
    expect(stored).toMatchObject({ username: "maya.ships", isVerified: true, timezone: "America/Toronto" });

    const [token] = await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, "1789"));
    expect(decryptSecret(token.accessTokenEnc, tokenContext("1789"))).toBe("token-2");

    const [wallet] = await db().select().from(wallets).where(eq(wallets.workspaceId, result.workspaceId));
    expect(wallet.balance).toBe(TRIAL_CREDITS);
  });

  it("signs a new account in from two places at once", async () => {
    const both = await Promise.all(
      ["tab-1", "tab-2"].map((accessToken) =>
        provisionThreadsAccount({
          profile: { ...profile, id: "3003", username: "twice" },
          accessToken,
          expiresAt,
          scopes,
        }),
      ),
    );
    // One creates the account, the other signs in to it.
    expect(both.map((r) => r.isNewProfile).sort()).toEqual([false, true]);
    expect(new Set(both.map((r) => r.workspaceId)).size).toBe(1);
    expect(new Set(both.map((r) => r.userId)).size).toBe(1);
    expect(both.filter((r) => r.trialGranted)).toHaveLength(1);
    const [wallet] = await db().select().from(wallets).where(eq(wallets.workspaceId, both[0].workspaceId));
    expect(wallet.balance).toBe(TRIAL_CREDITS);
  });

  it("ignores an invalid timezone", async () => {
    const result = await provisionThreadsAccount({
      profile: { ...profile, id: "2001", username: "other" },
      accessToken: "t",
      expiresAt,
      scopes,
      timezone: "Not/AZone",
    });
    const [stored] = await db().select().from(threadsProfiles).where(eq(threadsProfiles.id, result.profileId));
    expect(stored.timezone).toBe("UTC");
  });
});

describe("sessions", () => {
  it("resolves only unexpired sessions by token hash", async () => {
    const [user] = await db().select().from(users).where(eq(users.threadsUserId, "1789"));
    await db()
      .insert(sessions)
      .values([
        { idHash: sha256("live-token"), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
        { idHash: sha256("old-token"), userId: user.id, expiresAt: new Date(Date.now() - 60_000) },
      ]);
    expect(await readSessionUserId("live-token")).toBe(user.id);
    expect(await readSessionUserId("old-token")).toBeNull();
    expect(await readSessionUserId("unknown")).toBeNull();
    expect(await readSessionUserId(undefined)).toBeNull();
  });
});

describe("loadProfileDataset", () => {
  it("uses each post's latest metrics and carries follower counts forward", async () => {
    const now = new Date();
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    await db()
      .insert(posts)
      .values({
        id: "p1",
        profileId: "1789",
        text: "hello",
        mediaType: "TEXT_POST",
        postedAt: new Date(Date.now() - 5 * 86_400_000),
      });
    await db()
      .insert(postMetrics)
      .values([
        {
          postId: "p1",
          capturedAt: new Date(Date.now() - 4 * 86_400_000),
          views: 10,
          likes: 1,
          replies: 0,
          reposts: 0,
          quotes: 0,
          shares: 0,
        },
        {
          postId: "p1",
          capturedAt: new Date(Date.now() - 1 * 86_400_000),
          views: 50,
          likes: 4,
          replies: 2,
          reposts: 1,
          quotes: 0,
          shares: 0,
        },
      ]);
    await db()
      .insert(accountDaily)
      .values([
        { profileId: "1789", date: day(3), views: 5, likes: 0, replies: 0, reposts: 0, quotes: 0, followersCount: 100 },
        {
          profileId: "1789",
          date: day(2),
          views: 7,
          likes: 1,
          replies: 0,
          reposts: 0,
          quotes: 0,
          followersCount: null,
        },
        { profileId: "1789", date: day(1), views: 9, likes: 2, replies: 1, reposts: 0, quotes: 0, followersCount: 104 },
        // Today is incomplete and stays out.
        { profileId: "1789", date: day(0), views: 1, likes: 0, replies: 0, reposts: 0, quotes: 0, followersCount: 105 },
      ]);

    const data = await loadProfileDataset(profile, now);
    expect(data.posts).toHaveLength(1);
    expect(data.posts[0].insights).toMatchObject({ views: 50, likes: 4, replies: 2, reposts: 1 });
    expect(data.days.map((d) => d.followersCount)).toEqual([100, 100, 104]);
    expect(data.profile.followersCount).toBe(104);
  });
});

describe("Meta callbacks", () => {
  it("disconnect drops the token but keeps the data", async () => {
    await disconnectThreadsProfile("2001");
    expect(await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, "2001"))).toHaveLength(0);
    expect(await db().select().from(threadsProfiles).where(eq(threadsProfiles.id, "2001"))).toHaveLength(1);
  });

  it("deletion removes the person's data, keeps the ledger, and blocks a second trial", async () => {
    await deleteThreadsData("1789", "code-123");

    expect(await db().select().from(threadsProfiles).where(eq(threadsProfiles.id, "1789"))).toHaveLength(0);
    expect(await db().select().from(posts).where(eq(posts.profileId, "1789"))).toHaveLength(0);
    expect(await db().select().from(users).where(eq(users.threadsUserId, "1789"))).toHaveLength(0);
    expect(await readSessionUserId("live-token")).toBeNull();

    const [request] = await db()
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.confirmationCode, "code-123"));
    expect(request.completedAt).not.toBeNull();
    expect(request.threadsUserIdHash).toBe(sha256("1789"));

    const trials = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.ref, `trial:${sha256("1789")}`));
    expect(trials).toHaveLength(1);

    const again = await provisionThreadsAccount({ profile, accessToken: "token-3", expiresAt, scopes });
    expect(again).toMatchObject({ isNewProfile: true, trialGranted: false });
    const [wallet] = await db().select().from(wallets).where(eq(wallets.workspaceId, again.workspaceId));
    expect(wallet.balance).toBe(0);
  });
});
