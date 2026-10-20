import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { db } from "@/lib/db";
import { creditLedger, generations, posts, suggestions, wallets } from "@/lib/db/schema";
import { TRIAL_CREDITS } from "@/lib/pricing";
import type { AccountIdentity } from "@/lib/session/identity";
import { closeDatabase, resetDatabase } from "@/test/db";
import { RATE_LIMIT, startGeneration } from "./generate";
import { MOCK_SUGGESTIONS } from "./mock-model";
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
      promptVersion: "generate.v1",
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
