import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db";
import {
  creditLedger,
  emailLog,
  generations,
  postFeatures,
  postMetrics,
  posts,
  profileDna,
  scheduledPosts,
  suggestions,
  threadsTokens,
  userSettings,
  users,
  wallets,
  workspaces,
} from "@/lib/db/schema";
import { TRIAL_CREDITS } from "@/lib/pricing";
import type { AccountIdentity } from "@/lib/session/identity";
import { closeDatabase, resetDatabase } from "@/test/db";
import { EXPORT_FORMAT, exportAccount } from "./export";
import { DELETED_WORKSPACE_NAME, deleteThreadsData, provisionThreadsAccount } from "./provision";

// "Account & data" in Settings: the export, and what deleting an account leaves behind.

let identity: AccountIdentity;
const BYOK_KEY = "vck_secret_gateway_key_1234";

beforeAll(async () => {
  await resetDatabase();
  const account = await provisionThreadsAccount({
    profile: {
      id: "5150",
      username: "maya.builds",
      name: "Maya Chen",
      biography: "Building Tidy",
      profilePictureUrl: null,
      isVerified: false,
    },
    accessToken: "threads-access-token-xyz",
    expiresAt: new Date("2026-12-31T00:00:00Z"),
    scopes: ["threads_basic"],
    timezone: "America/Toronto",
  });
  identity = { userId: account.userId, workspaceId: account.workspaceId, profileId: account.profileId };

  await db()
    .update(users)
    .set({ email: "maya@example.com", emailVerifiedAt: new Date("2026-10-01T12:00:00Z") })
    .where(eq(users.id, identity.userId));
  await db()
    .update(workspaces)
    .set({
      byokKeyEnc: encryptSecret(BYOK_KEY, `byok:${identity.workspaceId}`),
      byokKeyLast4: "1234",
      autoRecharge: { enabled: true, thresholdCredits: 100, packId: "pack_5" },
      billingNotice: { kind: "auto_recharge_failed", message: "Card declined.", at: "2026-10-20T00:00:00Z" },
    })
    .where(eq(workspaces.id, identity.workspaceId));
  await db()
    .insert(userSettings)
    .values({ userId: identity.userId, voicePrefs: { emoji: "some" } });

  await db()
    .insert(posts)
    .values([
      {
        id: "p1",
        profileId: "5150",
        text: "Shipped the budget export today.",
        mediaType: "TEXT_POST",
        postedAt: new Date("2026-10-10T14:00:00Z"),
      },
      {
        id: "p2",
        profileId: "5150",
        text: "What's your Sunday reset?",
        mediaType: "TEXT_POST",
        postedAt: new Date("2026-10-12T14:00:00Z"),
      },
    ]);
  await db()
    .insert(postMetrics)
    .values([
      {
        postId: "p1",
        capturedAt: new Date("2026-10-11T00:00:00Z"),
        views: 100,
        likes: 5,
        replies: 1,
        reposts: 0,
        quotes: 0,
        shares: 0,
      },
      {
        postId: "p1",
        capturedAt: new Date("2026-10-13T00:00:00Z"),
        views: 180,
        likes: 9,
        replies: 2,
        reposts: 1,
        quotes: 0,
        shares: 1,
      },
    ]);
  await db()
    .insert(postFeatures)
    .values([
      { postId: "p1", version: 1, format: "announcement", topic: "shipping", model: "m" },
      { postId: "p1", version: 2, format: "build_in_public", topic: "shipping", model: "m" },
    ]);
  await db()
    .insert(profileDna)
    .values({ profileId: "5150", version: 1, data: { summary: "Short and direct." }, model: "m" });
  const [generation] = await db()
    .insert(generations)
    .values({
      profileId: "5150",
      userId: identity.userId,
      goal: "engagement",
      model: "anthropic/claude-sonnet-5.5",
      promptVersion: "generate.v5",
      steer: { goal: "engagement", topic: "php2shell" },
      gatewayGenerationId: "gen_internal_1",
      billingMode: "credits",
      status: "done",
      creditsCharged: 4,
    })
    .returning();
  await db().insert(suggestions).values({
    generationId: generation.id,
    text: "Patch before the weekend.",
    format: "tip",
    goalFit: 80,
    rationale: "Tips land.",
  });
  await db()
    .insert(scheduledPosts)
    .values({ profileId: "5150", text: "Patch before the weekend.", scheduledFor: new Date("2026-11-01T14:00:00Z") });
  await db().insert(emailLog).values({ userId: identity.userId, kind: "post_failed", ref: "x:1", status: "sent" });
});
afterAll(closeDatabase);

describe("exportAccount", () => {
  it("includes everything kept about the account", async () => {
    const data = await exportAccount(identity, new Date("2026-10-28T12:00:00Z"));
    expect(data).toMatchObject({
      format: EXPORT_FORMAT,
      exportedAt: "2026-10-28T12:00:00.000Z",
      account: {
        threadsUserId: "5150",
        username: "maya.builds",
        timezone: "America/Toronto",
        alertEmail: "maya@example.com",
        alertEmailConfirmedAt: "2026-10-01T12:00:00.000Z",
      },
      settings: { voice: { emoji: "some" } },
      billing: {
        mode: "credits",
        ownKeyLast4: "1234",
        credits: { balance: TRIAL_CREDITS, reserved: 0 },
        ledger: [{ change: TRIAL_CREDITS, kind: "trial" }],
      },
      profileDna: [{ version: 1, dna: { summary: "Short and direct." } }],
      scheduledPosts: [{ text: "Patch before the weekend.", status: "scheduled" }],
      emailsSent: [{ kind: "post_failed", status: "sent" }],
    });
    // Newest posts first, each with its latest labels and every insights snapshot.
    expect(data?.posts.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(data?.posts[1]).toMatchObject({
      text: "Shipped the budget export today.",
      labels: { format: "build_in_public", topic: "shipping" },
      insights: [
        { capturedAt: "2026-10-11T00:00:00.000Z", views: 100 },
        { capturedAt: "2026-10-13T00:00:00.000Z", views: 180 },
      ],
    });
    expect(data?.studio).toMatchObject([
      {
        goal: "engagement",
        request: { topic: "php2shell" },
        creditsCharged: 4,
        ideas: [{ text: "Patch before the weekend.", goalFit: 80, why: "Tips land." }],
      },
    ]);
  });

  it("leaves out secrets and internal ids", async () => {
    const json = JSON.stringify(await exportAccount(identity));
    const [token] = await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, "5150"));
    const [workspace] = await db().select().from(workspaces).where(eq(workspaces.id, identity.workspaceId));
    for (const secret of ["threads-access-token-xyz", token.accessTokenEnc, BYOK_KEY, workspace.byokKeyEnc ?? "-"]) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain("gen_internal_1");
    expect(json).not.toContain(identity.workspaceId);
  });

  it("finds nothing once the account is gone", async () => {
    expect(await exportAccount({ ...identity, profileId: "nobody" })).toBeNull();
  });
});

describe("deleting the account", () => {
  it("removes the person and strips what stays for accounting", async () => {
    await deleteThreadsData("5150", "code-account-data");

    expect(await db().select().from(posts).where(eq(posts.profileId, "5150"))).toHaveLength(0);
    expect(await db().select().from(scheduledPosts).where(eq(scheduledPosts.profileId, "5150"))).toHaveLength(0);
    expect(await db().select().from(users).where(eq(users.id, identity.userId))).toHaveLength(0);
    expect(await db().select().from(emailLog).where(eq(emailLog.userId, identity.userId))).toHaveLength(0);

    // The workspace stays for the ledger, with nothing that identifies the person.
    const [workspace] = await db().select().from(workspaces).where(eq(workspaces.id, identity.workspaceId));
    expect(workspace).toMatchObject({
      name: DELETED_WORKSPACE_NAME,
      billingMode: "credits",
      byokKeyEnc: null,
      byokKeyLast4: null,
      autoRecharge: null,
      billingNotice: null,
    });
    expect(
      await db().select().from(creditLedger).where(eq(creditLedger.workspaceId, identity.workspaceId)),
    ).toHaveLength(1);
    expect(await db().select().from(wallets).where(eq(wallets.workspaceId, identity.workspaceId))).toHaveLength(1);
  });
});
