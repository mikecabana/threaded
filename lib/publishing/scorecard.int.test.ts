import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { db } from "@/lib/db";
import { generations, postMetrics, posts, suggestions } from "@/lib/db/schema";
import { closeDatabase, resetDatabase } from "@/test/db";
import { matchPostedDrafts, scorecardFor, scorePostedDrafts, updateScorecard, winningDrafts } from "./scorecard";

const PROFILE = "4242";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date("2026-10-20T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
let generationId: string;

/** A post with snapshots at the given ages (hours → views). */
async function post(
  id: string,
  postedAt: Date,
  readings: Record<number, number>,
  extra: Partial<typeof posts.$inferInsert> = {},
) {
  await db()
    .insert(posts)
    .values({ id, profileId: PROFILE, text: `Post ${id}`, mediaType: "TEXT_POST", postedAt, ...extra });
  const rows = Object.entries(readings).map(([hours, views]) => ({
    postId: id,
    capturedAt: new Date(postedAt.getTime() + Number(hours) * HOUR),
    views,
    likes: 0,
    replies: 0,
    reposts: 0,
    quotes: 0,
    shares: 0,
  }));
  if (rows.length) await db().insert(postMetrics).values(rows);
}

async function draft(text: string, createdAt: Date, status: "new" | "saved" | "scheduled" = "saved") {
  const [row] = await db()
    .insert(suggestions)
    .values({ generationId, text, format: "question", status, createdAt })
    .returning({ id: suggestions.id });
  return row.id;
}

async function suggestion(id: string) {
  const [row] = await db().select().from(suggestions).where(eq(suggestions.id, id));
  return row;
}

beforeAll(async () => {
  await resetDatabase();
  await provisionThreadsAccount({
    profile: { id: PROFILE, username: "sam", name: "Sam", biography: "", profilePictureUrl: null, isVerified: false },
    accessToken: "token",
    expiresAt: new Date(Date.now() + 50 * DAY),
    scopes: ["threads_basic"],
  });
  const [generation] = await db()
    .insert(generations)
    .values({
      profileId: PROFILE,
      goal: "views",
      model: "x",
      promptVersion: "x",
      billingMode: "credits",
      status: "done",
    })
    .returning({ id: generations.id });
  generationId = generation.id;
});

beforeEach(async () => {
  await db().delete(suggestions);
  await db().delete(posts);
  // The usual: three earlier posts measured at every checkpoint.
  for (const [i, id] of ["h1", "h2", "h3"].entries()) {
    await post(id, ago((20 - i) * DAY), { 1: 100, 24: 1000, 72: 2000, 200: 2400 });
  }
});
afterAll(closeDatabase);

describe("matching posts written elsewhere", () => {
  it("links an edited post to its draft, and leaves scheduled and unrelated drafts alone", async () => {
    const matched = await draft("Shipped the new onboarding today. Signups up 18% in a week.", ago(3 * DAY));
    const scheduled = await draft(
      "What's the one tool you'd keep if you had to drop the rest?",
      ago(3 * DAY),
      "scheduled",
    );
    const unrelated = await draft("Morning routine: coffee, inbox zero, then deep work.", ago(3 * DAY));
    await post("mine", ago(2 * DAY), {}, { text: "Shipped the new onboarding today! Signups are up 18% in one week." });
    await post(
      "same-as-scheduled",
      ago(2 * DAY),
      {},
      { text: "What's the one tool you'd keep if you had to drop the rest?" },
    );

    expect(await matchPostedDrafts(PROFILE, now)).toBe(1);
    expect(await suggestion(matched)).toMatchObject({ status: "posted", postedMediaId: "mine" });
    expect(await suggestion(scheduled)).toMatchObject({ status: "scheduled", postedMediaId: null });
    expect(await suggestion(unrelated)).toMatchObject({ status: "saved", postedMediaId: null });
    // Already linked: nothing to do the second time.
    expect(await matchPostedDrafts(PROFILE, now)).toBe(0);
  });
});

describe("the scorecard", () => {
  it("lists posts from Threaded and matched posts, with chips against the usual", async () => {
    await post("threaded", ago(4 * DAY), { 1: 300, 24: 1500, 72: 3000 }, { viaThreaded: true });
    await post("elsewhere", ago(30 * HOUR), { 24: 500 });
    await post("not-ours", ago(1 * DAY), { 1: 50 });
    const id = await draft("Post elsewhere", ago(2 * DAY));
    await db().update(suggestions).set({ status: "posted", postedMediaId: "elsewhere" }).where(eq(suggestions.id, id));

    const { entries, line } = await scorecardFor(PROFILE, now);
    expect(entries.map((e) => [e.postId, e.source])).toEqual([
      ["elsewhere", "matched"],
      ["threaded", "threaded"],
    ]);
    const multipliers = entries[1].chips.map((c) => (c.state === "measured" ? c.multiplier : c.state));
    expect(multipliers).toEqual([3, 1.5, 1.5]);
    expect(entries[0].chips.map((c) => c.state)).toEqual(["missed", "measured", "pending"]);
    expect(line).toBe("The one post scored so far beat your usual views at 3 days.");
  });

  it("is empty without posts from Threaded", async () => {
    expect(await scorecardFor(PROFILE, now)).toEqual({ entries: [], line: "" });
  });
});

describe("scores and winners", () => {
  it("stores each posted draft's 3-day score, and the winners feed Studio", async () => {
    await post("winner", ago(4 * DAY), { 72: 3000 }, { viaThreaded: true });
    await post("average", ago(4 * DAY), { 72: 2000 }, { viaThreaded: true });
    await post("young", ago(30 * HOUR), { 24: 4000 }, { viaThreaded: true });
    const winner = await draft("A", ago(5 * DAY), "scheduled");
    const average = await draft("B", ago(5 * DAY), "scheduled");
    const young = await draft("C", ago(2 * DAY), "scheduled");
    await db().update(suggestions).set({ status: "posted", postedMediaId: "winner" }).where(eq(suggestions.id, winner));
    await db()
      .update(suggestions)
      .set({ status: "posted", postedMediaId: "average" })
      .where(eq(suggestions.id, average));
    await db().update(suggestions).set({ status: "posted", postedMediaId: "young" }).where(eq(suggestions.id, young));

    expect(await scorePostedDrafts(PROFILE, now)).toBe(2);
    expect(Number((await suggestion(winner)).perfVsBaseline)).toBe(1.5);
    expect(Number((await suggestion(average)).perfVsBaseline)).toBe(1);
    // Too young for a 3-day score.
    expect((await suggestion(young)).perfVsBaseline).toBeNull();
    expect(await winningDrafts(PROFILE)).toEqual([{ postId: "winner", score: 1.5 }]);
  });

  it("never throws from a sync", async () => {
    await expect(updateScorecard("no-such-profile", now)).resolves.toBeUndefined();
  });
});
