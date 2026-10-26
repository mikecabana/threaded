import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockBilling } from "@/e2e/mock-billing.mjs";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { db } from "@/lib/db";
import { emailLog, scheduledPosts, threadsTokens, users } from "@/lib/db/schema";
import { markFailed } from "@/lib/publishing/publish";
import { checkDataAccess } from "@/lib/sync/access";
import { closeDatabase, resetDatabase } from "@/test/db";
import { installFakeThreads } from "@/test/fake-threads";
import { alertProfile } from "./alerts";
import { postFailedEmail } from "./templates";
import { alertAddress, confirmEmail, readVerificationToken, requestEmailVerification, VERIFY_LIMIT } from "./verify";

// Emails against the Resend endpoint of e2e/mock-billing.mjs.

const mock = createMockBilling();
const PROFILE = "1789";
const DAY = 86_400_000;
let userId: string;
let fake: ReturnType<typeof installFakeThreads> | undefined;

type Sent = { to: string[]; subject: string; text: string; html: string };
const outbox = (to?: string) => (mock.state.emails as Sent[]).filter((e) => !to || e.to.includes(to));

async function verified(email: string) {
  await db().update(users).set({ email, emailVerifiedAt: new Date() }).where(eq(users.id, userId));
}

beforeAll(async () => {
  await mock.listen(3997);
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
    expiresAt: new Date(Date.now() + 50 * DAY),
    scopes: ["threads_basic"],
  });
  userId = account.userId;
});
beforeEach(async () => {
  mock.state.emails.length = 0;
  await db().delete(emailLog);
  await db().update(users).set({ email: null, emailVerifiedAt: null });
});
afterEach(() => fake?.restore());
afterAll(async () => {
  await mock.close();
  await closeDatabase();
});

describe("confirming an address", () => {
  it("emails a link, and only stores the address once it's opened", async () => {
    const result = await requestEmailVerification(userId, "  Maya@Example.com ", "http://app.test");
    expect(result).toEqual({ ok: true, email: "maya@example.com" });
    expect(await alertAddress(userId)).toBeNull();

    const [email] = outbox("maya@example.com");
    expect(email.subject).toBe("Confirm your email for Threaded alerts");
    const link = email.text.match(/http:\/\/app\.test\/api\/email\/verify\?token=(\S+)/);
    const token = decodeURIComponent(link?.[1] ?? "");
    expect(readVerificationToken(token)).toEqual({ userId, email: "maya@example.com" });

    expect(await confirmEmail(`${token}x`)).toBe(false);
    expect(await confirmEmail(token, new Date(Date.now() + 25 * 3_600_000))).toBe(false);
    expect(await confirmEmail(token)).toBe(true);
    expect(await alertAddress(userId)).toBe("maya@example.com");
    expect(await requestEmailVerification(userId, "maya@example.com", "http://app.test")).toEqual({
      ok: false,
      reason: "already",
    });
  });

  it("rejects bad addresses and limits how many links go out", async () => {
    expect(await requestEmailVerification(userId, "not an email", "http://app.test")).toEqual({
      ok: false,
      reason: "invalid",
    });
    for (let i = 0; i < VERIFY_LIMIT; i++) {
      expect((await requestEmailVerification(userId, `try${i}@example.com`, "http://app.test")).ok).toBe(true);
    }
    expect(await requestEmailVerification(userId, "one-more@example.com", "http://app.test")).toEqual({
      ok: false,
      reason: "too_many",
    });
    expect(outbox()).toHaveLength(VERIFY_LIMIT);
  });
});

describe("alerts", () => {
  const content = () =>
    postFailedEmail({ text: "Hello <world>", reason: "Threads said no.", url: "http://app.test/queue" });

  it("go once per event, and only to confirmed addresses", async () => {
    expect(await alertProfile(PROFILE, "post_failed", "p1:1", content)).toBe(0);
    await verified("maya@example.com");
    expect(await alertProfile(PROFILE, "post_failed", "p1:1", content)).toBe(1);
    expect(await alertProfile(PROFILE, "post_failed", "p1:1", content)).toBe(0);
    expect(await alertProfile(PROFILE, "post_failed", "p1:2", content)).toBe(1);
    const sent = outbox("maya@example.com");
    expect(sent).toHaveLength(2);
    expect(sent[0].html).toContain("Hello &lt;world&gt;");
    expect(sent[0].text).toContain("Open your Queue: http://app.test/queue");
  });

  it("try again next time when the provider fails", async () => {
    await verified("maya@example.com");
    await mock.close();
    expect(await alertProfile(PROFILE, "post_failed", "p2:1", content)).toBe(0);
    await mock.listen(3997);
    expect(await alertProfile(PROFILE, "post_failed", "p2:1", content)).toBe(1);
  });

  it("email when a scheduled post fails, once", async () => {
    await verified("maya@example.com");
    const [post] = await db()
      .insert(scheduledPosts)
      .values({ profileId: PROFILE, text: "Shipping today.", scheduledFor: new Date(), status: "publishing" })
      .returning({ id: scheduledPosts.id, version: scheduledPosts.version });
    await markFailed(post.id, post.version, "Threads didn't accept the post: too many links.");
    await markFailed(post.id, post.version, "Threads didn't accept the post: too many links.");
    const sent = outbox("maya@example.com");
    expect(sent.map((e) => e.subject)).toEqual(["A scheduled post didn't go out"]);
    expect(sent[0].text).toContain("Threads didn't accept the post: too many links.");
    expect(sent[0].text).toContain('"Shipping today."');
  });
});

describe("reconnect reminders", () => {
  const now = new Date();
  async function grantedDaysAgo(days: number) {
    await db()
      .update(threadsTokens)
      .set({ grantedAt: new Date(now.getTime() - days * DAY), dataAccessExpiresAt: null, accessCheckedAt: null })
      .where(eq(threadsTokens.profileId, PROFILE));
  }

  it("waits until a grant could be near its end, then reminds a week before", async () => {
    await verified("maya@example.com");
    fake = installFakeThreads({ posts: [], dataAccessExpiresAt: Math.floor((now.getTime() + 5 * DAY) / 1000) });
    await grantedDaysAgo(30);
    expect(await checkDataAccess(PROFILE, now)).toBe("skipped");
    expect(fake.calls).toHaveLength(0);

    await grantedDaysAgo(85);
    expect(await checkDataAccess(PROFILE, now)).toBe("reminded");
    expect(await checkDataAccess(PROFILE, now)).toBe("reminded");
    const sent = outbox("maya@example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Reconnect Threads to keep posting from Threaded");
    expect(sent[0].text).toContain("Threaded loses access to @maya.builds on");
  });

  it("stays quiet when access is extended, and rechecks weekly", async () => {
    fake = installFakeThreads({ posts: [], dataAccessExpiresAt: Math.floor((now.getTime() + 80 * DAY) / 1000) });
    await grantedDaysAgo(70);
    expect(await checkDataAccess(PROFILE, now)).toBe("ok");
    const debugCalls = () => fake?.calls.filter((c) => c.pathname.endsWith("/debug_token")).length;
    expect(debugCalls()).toBe(1);
    expect(await checkDataAccess(PROFILE, new Date(now.getTime() + DAY))).toBe("ok");
    expect(debugCalls()).toBe(1);
  });

  it("does nothing when Threads won't say", async () => {
    fake = installFakeThreads({ posts: [] });
    await grantedDaysAgo(85);
    expect(await checkDataAccess(PROFILE, now)).toBe("ok");
    const [token] = await db().select().from(threadsTokens).where(eq(threadsTokens.profileId, PROFILE));
    expect(token.accessCheckedAt).not.toBeNull();
    expect(token.dataAccessExpiresAt).toBeNull();
  });
});
