import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db";
import {
  creditLedger,
  generations,
  posts,
  suggestions,
  threadsTokens,
  userSettings,
  wallets,
  workspaces,
} from "@/lib/db/schema";
import { TRIAL_CREDITS } from "@/lib/pricing";
import type { AccountIdentity } from "@/lib/session/identity";
import { KEYWORD_SEARCH_SCOPE } from "@/lib/threads/oauth";
import { closeDatabase, resetDatabase } from "@/test/db";
import { installFakeThreads } from "@/test/fake-threads";
import { RATE_LIMIT, startGeneration } from "./generate";
import { MOCK_SUGGESTIONS, MOCK_THREAD_PARTS, mockCalls } from "./mock-model";
import { byokContext } from "./models";
import { PROMPT_VERSION } from "./prompt";
import { generateRequestSchema } from "./schemas";

let identity: AccountIdentity;
const request = generateRequestSchema.parse({ goal: "engagement", count: 3 });

async function wallet() {
  const [row] = await db().select().from(wallets).where(eq(wallets.workspaceId, identity.workspaceId));
  return row;
}

async function run(overrides: Partial<typeof request> = {}) {
  const response = await startGeneration({ identity, request: { ...request, ...overrides } });
  const body = await response.text();
  return { response, body, generationId: response.headers.get("x-generation-id") };
}

beforeAll(async () => {
  await resetDatabase();
  const account = await provisionThreadsAccount({
    profile: {
      id: "4242",
      username: "maya.builds",
      name: "Maya Chen",
      biography: "Building Tidy",
      profilePictureUrl: null,
      isVerified: false,
    },
    accessToken: "t",
    expiresAt: new Date(Date.now() + 50 * 86_400_000),
    scopes: ["threads_basic"],
  });
  identity = { userId: account.userId, workspaceId: account.workspaceId, profileId: account.profileId };
});
beforeEach(async () => {
  process.env.AI_MOCK = "1";
  await db().delete(generations);
  await db()
    .update(wallets)
    .set({ balance: TRIAL_CREDITS, reserved: 0 })
    .where(eq(wallets.workspaceId, identity.workspaceId));
});
afterEach(() => {
  process.env.AI_MOCK = "";
});
afterAll(closeDatabase);

describe("startGeneration", () => {
  it("streams the batch, stores it, and charges the actual cost", async () => {
    const { response, body, generationId } = await run();
    expect(response.status).toBe(200);
    // The stream carries the model's JSON as it was written.
    expect(JSON.parse(body).suggestions).toHaveLength(5);

    const [generation] = await db()
      .select()
      .from(generations)
      .where(eq(generations.id, generationId as string));
    expect(generation).toMatchObject({
      status: "done",
      billingMode: "credits",
      promptVersion: PROMPT_VERSION,
      dropped: 0,
    });
    // Mock usage: 1,200 input + 400 output tokens on the default (Sonnet-tier) price, ×1.5 markup.
    expect(generation.creditsCharged).toBe(2);

    // Only the requested number of ideas are kept.
    const stored = await db()
      .select()
      .from(suggestions)
      .where(eq(suggestions.generationId, generationId as string));
    expect(stored.map((s) => s.text).sort()).toEqual(
      MOCK_SUGGESTIONS.slice(0, 3)
        .map((s) => s.text)
        .sort(),
    );
    expect(stored.every((s) => s.status === "new")).toBe(true);

    expect(await wallet()).toMatchObject({ balance: TRIAL_CREDITS - 2, reserved: 0 });
    const ledger = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.ref, generationId as string));
    expect(ledger.reduce((sum, row) => sum + row.delta, 0)).toBe(-2);
  });

  it("drops ideas that repeat the author's posts", async () => {
    await db()
      .insert(posts)
      .values({
        id: "p-dup",
        profileId: identity.profileId,
        text: MOCK_SUGGESTIONS[0].text,
        mediaType: "TEXT_POST",
        postedAt: new Date(Date.now() - 86_400_000),
      });
    const { generationId } = await run();
    const [generation] = await db()
      .select()
      .from(generations)
      .where(eq(generations.id, generationId as string));
    expect(generation.dropped).toBe(1);
    const stored = await db()
      .select()
      .from(suggestions)
      .where(eq(suggestions.generationId, generationId as string));
    expect(stored.map((s) => s.text)).not.toContain(MOCK_SUGGESTIONS[0].text);
    await db().delete(posts).where(eq(posts.id, "p-dup"));
  });

  it("refuses with 402 when the wallet can't cover the worst case", async () => {
    await db().update(wallets).set({ balance: 1 }).where(eq(wallets.workspaceId, identity.workspaceId));
    const { response, body } = await run();
    expect(response.status).toBe(402);
    expect(JSON.parse(body)).toMatchObject({ error: "insufficient_credits", balance: 1 });
    expect(await wallet()).toMatchObject({ balance: 1, reserved: 0 });
  });

  it("refunds everything when the provider fails", async () => {
    process.env.AI_MOCK = "error";
    const { generationId } = await run();
    const [generation] = await db()
      .select()
      .from(generations)
      .where(eq(generations.id, generationId as string));
    expect(generation.status).toBe("failed");
    expect(await wallet()).toMatchObject({ balance: TRIAL_CREDITS, reserved: 0 });
    const ledger = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.ref, generationId as string));
    expect(ledger.map((r) => r.kind).sort()).toEqual(["release", "reserve"]);
  });

  it("runs on the workspace's own key without touching credits", async () => {
    await db()
      .update(workspaces)
      .set({ billingMode: "byok", byokKeyEnc: encryptSecret("vck_test", byokContext(identity.workspaceId)) })
      .where(eq(workspaces.id, identity.workspaceId));
    try {
      const { response, generationId } = await run();
      expect(response.status).toBe(200);
      const [generation] = await db()
        .select()
        .from(generations)
        .where(eq(generations.id, generationId as string));
      expect(generation).toMatchObject({ status: "done", billingMode: "byok", creditsCharged: 0 });
      expect(await wallet()).toMatchObject({ balance: TRIAL_CREDITS, reserved: 0 });
      const ledger = await db()
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.ref, generationId as string));
      expect(ledger).toHaveLength(0);
    } finally {
      await db()
        .update(workspaces)
        .set({ billingMode: "credits", byokKeyEnc: null })
        .where(eq(workspaces.id, identity.workspaceId));
    }
  });

  it("rate-limits bursts", async () => {
    await db()
      .insert(generations)
      .values(
        Array.from({ length: RATE_LIMIT.max }, () => ({
          profileId: identity.profileId,
          goal: "engagement" as const,
          model: "x",
          promptVersion: "x",
          billingMode: "credits" as const,
        })),
      );
    const { response } = await run();
    expect(response.status).toBe(429);
  });
});

describe("voice settings", () => {
  afterEach(async () => {
    await db().delete(userSettings).where(eq(userSettings.userId, identity.userId));
  });

  it("tells the writer the author's rules, and drops an idea that breaks one", async () => {
    await db()
      .insert(userSettings)
      .values({
        userId: identity.userId,
        voicePrefs: { bannedWords: ["procrastination"], casing: "lowercase", notes: "Call my product Tidy." },
      });
    const { generationId } = await run();
    const lastPrompt = mockCalls.filter((call) => call.task === "generate").at(-1)?.prompt ?? "";
    expect(lastPrompt).toContain('Never use these words or phrases: "procrastination".');
    expect(lastPrompt).toContain("Write everything in lowercase");
    expect(lastPrompt).toContain('"""\nCall my product Tidy.\n"""');

    const [row] = await db()
      .select()
      .from(generations)
      .where(eq(generations.id, generationId as string));
    expect(row).toMatchObject({ status: "done", dropped: 1 });
    const kept = await db()
      .select()
      .from(suggestions)
      .where(eq(suggestions.generationId, generationId as string));
    // The mock writes five; the one with the banned word goes, and the batch still has three.
    expect(kept.map((s) => s.text).join(" ")).not.toContain("procrastination");
    expect(kept).toHaveLength(3);
  });
});

describe("threads", () => {
  it("asks for threads and stores each idea's parts", async () => {
    const { generationId } = await run({ shape: "thread" });
    const lastPrompt = mockCalls.filter((call) => call.task === "generate").at(-1)?.prompt ?? "";
    expect(lastPrompt).toContain("Write 3 new ideas, each a thread.");
    expect(lastPrompt).toContain("Write every idea as a thread of 3 to 5 posts");

    const kept = await db()
      .select()
      .from(suggestions)
      .where(eq(suggestions.generationId, generationId as string));
    expect(kept).toHaveLength(3);
    for (const idea of kept) expect(idea.seriesParts).toHaveLength(2);
    expect(kept.find((idea) => idea.text === MOCK_SUGGESTIONS[0].text)?.seriesParts).toEqual(MOCK_THREAD_PARTS[0]);
  });

  it("keeps single posts single", async () => {
    const { generationId } = await run();
    const kept = await db()
      .select()
      .from(suggestions)
      .where(eq(suggestions.generationId, generationId as string));
    expect(kept.every((idea) => idea.seriesParts.length === 0)).toBe(true);
  });
});

describe("web research", () => {
  async function generation(id: string | null) {
    const [row] = await db()
      .select()
      .from(generations)
      .where(eq(generations.id, id as string));
    return row;
  }
  const lastPrompt = (task: string) => mockCalls.filter((call) => call.task === task).at(-1)?.prompt ?? "";

  it("looks up a specific topic, briefs the writer and charges for the search", async () => {
    const { response, generationId } = await run({ topic: "php2shell" });
    expect(response.status).toBe(200);
    const row = await generation(generationId);
    expect(row.status).toBe("done");
    expect(row.research).toMatchObject({
      version: "research.v2",
      model: "anthropic/claude-haiku-5.5",
      queries: ["php2shell news"],
      searches: 1,
      sources: [
        { url: "https://news.example.com/php2shell", date: "2026-10-20" },
        { url: "https://blog.example.org/php2shell-explained", date: "2026-10-21" },
      ],
    });
    expect(row.research?.brief).toContain("security flaw disclosed on 2026-10-20");

    // The researcher saw the author; the writer got the brief.
    expect(lastPrompt("research")).toContain("@maya.builds: Building Tidy");
    expect(lastPrompt("generate")).toContain('What\'s happening with "php2shell", from a web search today:');
    expect(lastPrompt("generate")).toContain("security flaw disclosed on 2026-10-20");

    // Ideas: 2 credits. Research: 2,500 + 120 tokens on the fast tier plus a $0.005 search, ×1.5 → 2 credits.
    expect(row.creditsCharged).toBe(4);
    expect(Number(row.costUsd)).toBeGreaterThan(0.005);
    expect(await wallet()).toMatchObject({ balance: TRIAL_CREDITS - 4, reserved: 0 });

    // Studio reads the sources back with the stored ideas.
    const { generationResult } = await import("@/lib/data/suggestions");
    const result = await generationResult(identity.profileId, generationId as string);
    expect(result?.research?.sources).toHaveLength(2);
    expect(result?.research).not.toHaveProperty("costUsd");
  });

  it("skips the search for a broad theme, and charges nothing for deciding", async () => {
    const { generationId } = await run({ topic: "morning routines" });
    const row = await generation(generationId);
    expect(row.research).toMatchObject({ queries: [], brief: null, sources: [], searches: 0 });
    expect(lastPrompt("generate")).not.toContain("web search");
    expect(row.creditsCharged).toBe(2);
  });

  it("tells the writer when a search finds nothing reliable", async () => {
    const { generationId } = await run({ topic: "zzz-unknown" });
    const row = await generation(generationId);
    expect(row.research).toMatchObject({ queries: ["zzz-unknown news"], brief: null, sources: [] });
    expect(lastPrompt("generate")).toContain('A web search for "zzz-unknown" found nothing reliable');
  });

  it("writes the batch without research when the search fails", async () => {
    const { generationId } = await run({ topic: "fail-search" });
    const row = await generation(generationId);
    expect(row).toMatchObject({ status: "done", research: null, creditsCharged: 2 });
  });

  it("doesn't search without a topic", async () => {
    const before = mockCalls.filter((call) => call.task === "research").length;
    const { generationId } = await run();
    expect((await generation(generationId)).research).toBeNull();
    expect(mockCalls.filter((call) => call.task === "research")).toHaveLength(before);
  });
});

describe("Threads posts on the topic", () => {
  let restore: (() => void) | undefined;
  let calls: URL[] = [];
  const lastPrompt = (task: string) => mockCalls.filter((call) => call.task === task).at(-1)?.prompt ?? "";
  const search = () => calls.filter((url) => url.pathname.endsWith("/keyword_search"));
  async function grant(scopes: string[]) {
    await db().update(threadsTokens).set({ scopes }).where(eq(threadsTokens.profileId, identity.profileId));
  }
  async function generation(id: string | null) {
    const [row] = await db()
      .select()
      .from(generations)
      .where(eq(generations.id, id as string));
    return row;
  }

  beforeEach(async () => {
    await grant(["threads_basic", KEYWORD_SEARCH_SCOPE]);
    ({ restore, calls } = installFakeThreads({ posts: [] }));
  });
  afterEach(async () => {
    restore?.();
    await grant(["threads_basic"]);
  });

  it("reads recent top posts by other people, and tells the writer what they're missing", async () => {
    const { generationId } = await run({ topic: "php2shell" });
    const [url] = search();
    expect(url.searchParams.get("q")).toBe("php2shell");
    expect(url.searchParams.get("search_type")).toBe("TOP");
    expect(Number(url.searchParams.get("since"))).toBeGreaterThan(Date.now() / 1000 - 15 * 86_400);

    // The researcher read the two posts by other people: not the reply, not the author's own.
    const researched = lastPrompt("research");
    expect(researched).toContain("[1] @sec.daily");
    expect(researched).toContain("[2] @ops.notes");
    expect(researched).not.toContain("@random.dev");
    expect(researched).not.toContain("My own thoughts");

    const row = await generation(generationId);
    expect(row.research).toMatchObject({
      version: "research.v2",
      searches: 1,
      conversation: expect.stringContaining("2 posts (mock summary)"),
      threads: [
        { username: "sec.daily", permalink: "https://www.threads.net/@sec.daily/post/KW1" },
        { username: "ops.notes", permalink: "https://www.threads.net/@ops.notes/post/KW2" },
      ],
    });
    // Their words are read, never stored or passed to the writer.
    expect(JSON.stringify(row.research)).not.toContain("broke half the internet");
    expect(lastPrompt("generate")).not.toContain("broke half the internet");
    expect(lastPrompt("generate")).toContain('What recent popular Threads posts about "php2shell" are saying:');
    expect(lastPrompt("generate")).toContain("security flaw disclosed on 2026-10-20");

    const { generationResult } = await import("@/lib/data/suggestions");
    const result = await generationResult(identity.profileId, generationId as string);
    expect(result?.research?.conversation).toContain("mock summary");
    expect(result?.research?.threads).toHaveLength(2);
  });

  it("reads posts on a broad theme too, and charges for reading them", async () => {
    const { generationId } = await run({ topic: "morning routines" });
    const row = await generation(generationId);
    expect(row.research).toMatchObject({ queries: [], brief: null, searches: 0 });
    expect(row.research?.conversation).toContain("mock summary");
    expect(lastPrompt("generate")).not.toContain("web search");
    // Ideas: 2 credits. Research: 2,500 + 120 tokens on the fast tier, ×1.5 → 1 credit.
    expect(row.creditsCharged).toBe(3);
  });

  it("drops an idea that repeats a post on Threads", async () => {
    restore?.();
    ({ restore, calls } = installFakeThreads({
      posts: [],
      searchExtra: [{ username: "fast.copier", text: MOCK_SUGGESTIONS[0].text }],
    }));
    const { generationId } = await run({ topic: "php2shell" });
    const row = await generation(generationId);
    expect(row.dropped).toBe(1);
    const kept = await db()
      .select()
      .from(suggestions)
      .where(eq(suggestions.generationId, generationId as string));
    expect(kept.map((s) => s.text)).not.toContain(MOCK_SUGGESTIONS[0].text);
  });

  it("goes on with the web alone when Threads search fails or wasn't granted", async () => {
    restore?.();
    ({ restore, calls } = installFakeThreads({ posts: [], authFailures: ["/keyword_search"] }));
    const failed = await generation((await run({ topic: "php2shell" })).generationId);
    expect(failed).toMatchObject({ status: "done", creditsCharged: 4 });
    expect(failed.research).toMatchObject({ searches: 1, conversation: null, threads: [] });
    expect(search()).toHaveLength(1);

    await grant(["threads_basic"]);
    const ungranted = await generation((await run({ topic: "php2shell" })).generationId);
    expect(ungranted.research).toMatchObject({ searches: 1, conversation: null, threads: [] });
    expect(search()).toHaveLength(1);
  });
});
