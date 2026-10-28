import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { provisionThreadsAccount } from "@/lib/accounts/provision";
import { catalogFor, syncCatalogFromGateway } from "@/lib/ai/catalog";
import { MOCK_GATEWAY_MODELS } from "@/lib/ai/mock-gateway-models";
import { grantCredits } from "@/lib/billing/wallet";
import { db } from "@/lib/db";
import { creditLedger, creditLots, generations, modelCatalog, wallets, workspaces } from "@/lib/db/schema";
import { closeDatabase, resetDatabase } from "@/test/db";
import { addGatewayModel, addModel, listCatalog, setDefaultModel, updateModel } from "./catalog";
import { adjustCredits } from "./credits";
import { languageModels } from "./gateway-models";
import { marginReport, type SpendReport } from "./margins";
import { searchWorkspaces, workspaceDetail } from "./workspaces";

const PROFILE = "5150";
let workspaceId: string;
let staffId: string;

async function wallet() {
  const [row] = await db().select().from(wallets).where(eq(wallets.workspaceId, workspaceId));
  return row;
}

async function lotsRemaining() {
  const lots = await db().select().from(creditLots).where(eq(creditLots.workspaceId, workspaceId));
  return lots.reduce((sum, lot) => sum + lot.remaining, 0);
}

beforeAll(async () => {
  await resetDatabase();
  const account = await provisionThreadsAccount({
    profile: {
      id: PROFILE,
      username: "rita.ships",
      name: "Rita",
      biography: "",
      profilePictureUrl: null,
      isVerified: false,
    },
    accessToken: "token",
    expiresAt: new Date(Date.now() + 50 * 86_400_000),
    scopes: ["threads_basic"],
  });
  workspaceId = account.workspaceId;
  staffId = account.userId;
});
afterAll(closeDatabase);

describe("credit adjustments", () => {
  it("adds and takes back credits with a reason, keeping the lots in step", async () => {
    const start = (await wallet()).balance;
    const added = await adjustCredits({
      workspaceId,
      amount: 250,
      reason: "Refund for a failed batch",
      actorUserId: staffId,
      token: "a1",
    });
    expect(added).toEqual({ ok: true, balance: start + 250 });
    // The same form submitted twice applies once.
    expect(
      await adjustCredits({
        workspaceId,
        amount: 250,
        reason: "Refund for a failed batch",
        actorUserId: staffId,
        token: "a1",
      }),
    ).toEqual({
      ok: false,
      problem: "duplicate",
    });

    const taken = await adjustCredits({
      workspaceId,
      amount: -100,
      reason: "Card refunded in Stripe",
      actorUserId: staffId,
      token: "a2",
    });
    expect(taken).toEqual({ ok: true, balance: start + 150 });
    const w = await wallet();
    expect(await lotsRemaining()).toBe(w.balance + w.reserved);

    const rows = await db().select().from(creditLedger).where(eq(creditLedger.kind, "adjust"));
    expect(rows.map((r) => [r.delta, r.note, r.actorUserId])).toEqual(
      expect.arrayContaining([
        [250, "Refund for a failed batch", staffId],
        [-100, "Card refunded in Stripe", staffId],
      ]),
    );
  });

  it("never takes a workspace below zero, and needs an amount and a reason", async () => {
    const { balance } = await wallet();
    const attempt = (amount: number, reason = "Testing limits") =>
      adjustCredits({ workspaceId, amount, reason, actorUserId: staffId, token: randomUUID() });
    expect(await attempt(-(balance + 1))).toEqual({ ok: false, problem: "insufficient" });
    expect(await attempt(0)).toEqual({ ok: false, problem: "zero" });
    expect(await attempt(10, " ")).toEqual({ ok: false, problem: "no_reason" });
    expect(await attempt(1_000_000)).toEqual({ ok: false, problem: "too_large" });
    expect(
      await adjustCredits({ workspaceId: randomUUID(), amount: 5, reason: "Nobody", actorUserId: staffId, token: "x" }),
    ).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect((await wallet()).balance).toBe(balance);
  });
});

describe("margins", () => {
  beforeEach(async () => {
    await db().delete(generations);
  });

  const generation = (values: Partial<typeof generations.$inferInsert>) =>
    db()
      .insert(generations)
      .values({
        profileId: PROFILE,
        goal: "views",
        model: "anthropic/claude-sonnet-5.5",
        promptVersion: "generate.v3",
        billingMode: "credits",
        status: "done",
        ...values,
      });

  it("weighs credits charged against the AI cost, by model and workspace", async () => {
    await generation({ creditsCharged: 3, costUsd: "0.018" });
    await generation({ creditsCharged: 2, costUsd: "0.012" });
    await generation({ model: "anthropic/claude-haiku-5.5", creditsCharged: 1, costUsd: "0.004" });
    // Not ours to count: own-key calls and failures.
    await generation({ billingMode: "byok", creditsCharged: 0, costUsd: "0.02" });
    await generation({ status: "failed", creditsCharged: 0, costUsd: null });
    await grantCredits({ workspaceId, amount: 500, kind: "purchase", ref: "cs_test_margin" });

    const report = await marginReport({ days: 30 });
    expect(report.byModel).toEqual([
      { model: "anthropic/claude-sonnet-5.5", generations: 2, revenueUsd: 0.05, costUsd: 0.03 },
      { model: "anthropic/claude-haiku-5.5", generations: 1, revenueUsd: 0.01, costUsd: 0.004 },
    ]);
    expect(report).toMatchObject({ generations: 3, ownKeyGenerations: 1, creditsSoldUsd: 5 });
    expect(report.revenueUsd).toBeCloseTo(0.06, 6);
    expect(report.byWorkspace).toEqual([
      { workspaceId, name: expect.any(String), generations: 3, revenueUsd: 0.06, costUsd: 0.034 },
    ]);
    const w = await wallet();
    expect(report.outstandingCredits).toBe(w.balance + w.reserved);
    expect(report.gateway).toEqual({ ok: false, reason: expect.stringMatching(/isn't reachable/) });
  });

  it("adds the Gateway's spend by model and task when it's reachable", async () => {
    const asked: unknown[] = [];
    const spend: SpendReport = async (params) => {
      asked.push(params);
      return params.groupBy === "model"
        ? { results: [{ model: "anthropic/claude-sonnet-5.5", totalCost: 0.5, requestCount: 40 }] }
        : {
            results: [
              { tag: "task:dna", totalCost: 0.3, requestCount: 4 },
              { tag: "billing:credits", totalCost: 0.5, requestCount: 40 },
              { tag: "task:generate", totalCost: 0.2, requestCount: 36 },
            ],
          };
    };
    const report = await marginReport({ days: 7, now: new Date("2026-10-26T12:00:00Z"), spend });
    expect(asked[0]).toEqual({
      startDate: "2026-10-19",
      endDate: "2026-10-26",
      credentialType: "system",
      groupBy: "model",
    });
    expect(report.gateway).toEqual({
      ok: true,
      spend: {
        totalUsd: 0.5,
        byModel: [{ model: "anthropic/claude-sonnet-5.5", costUsd: 0.5, requests: 40 }],
        byTask: [
          { task: "dna", costUsd: 0.3, requests: 4 },
          { task: "generate", costUsd: 0.2, requests: 36 },
        ],
      },
    });
    const failing: SpendReport = async () => {
      throw new Error("Gateway said no");
    };
    expect((await marginReport({ days: 7, spend: failing })).gateway).toEqual({ ok: false, reason: "Gateway said no" });
  });
});

describe("the catalog", () => {
  const base = {
    label: "Claude Opus 5.5",
    tier: "best" as const,
    tasks: ["generate", "dna"] as const,
    markup: 1.8,
    minCredits: 2,
  };

  it("edits markups and switches, and keeps every task with a default", async () => {
    await listCatalog();
    expect(
      await updateModel("anthropic/claude-opus-5.5", { ...base, tasks: ["generate", "dna"], enabled: false }),
    ).toEqual({ ok: true });
    expect((await catalogFor("generate")).map((m) => m.modelId)).not.toContain("anthropic/claude-opus-5.5");
    // Sonnet is Studio's default, so it can't be switched off or stop offering generate.
    const sonnet = { label: "Claude Sonnet 5.5", tier: "balanced" as const, markup: 1.5, minCredits: 1 };
    expect(
      await updateModel("anthropic/claude-sonnet-5.5", {
        ...sonnet,
        tasks: ["generate", "critique", "dna"],
        enabled: false,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await updateModel("anthropic/claude-sonnet-5.5", { ...sonnet, tasks: ["critique"], enabled: true }),
    ).toMatchObject({ ok: false });

    // A model switched off can't become a default; switched on, it takes the task from the old default.
    expect(await setDefaultModel("generate", "anthropic/claude-opus-5.5")).toMatchObject({ ok: false });
    await updateModel("anthropic/claude-opus-5.5", { ...base, tasks: ["generate", "dna"], enabled: true });
    expect(await setDefaultModel("generate", "anthropic/claude-opus-5.5")).toEqual({ ok: true });
    const rows = await listCatalog();
    expect(rows.filter((m) => m.defaultFor.includes("generate")).map((m) => m.modelId)).toEqual([
      "anthropic/claude-opus-5.5",
    ]);
    expect(Number(rows.find((m) => m.modelId === "anthropic/claude-opus-5.5")?.markup)).toBe(1.8);
  });

  it("adds new models switched off, and the nightly sync leaves the switch alone", async () => {
    expect(
      await addModel({
        modelId: "openai/gpt-6",
        label: "GPT-6",
        provider: "OpenAI",
        tier: "best",
        tasks: ["generate"],
      }),
    ).toEqual({ ok: true });
    expect(
      await addModel({
        modelId: "openai/gpt-6",
        label: "GPT-6",
        provider: "OpenAI",
        tier: "best",
        tasks: ["generate"],
      }),
    ).toMatchObject({ ok: false });
    await syncCatalogFromGateway(async () => ({
      models: [
        { id: "openai/gpt-6", pricing: { input: "0.000004", output: "0.00002" } },
        { id: "anthropic/claude-sonnet-5.5", pricing: null },
        { id: "anthropic/claude-opus-5.5", pricing: null },
      ],
    }));
    const [gpt] = await db().select().from(modelCatalog).where(eq(modelCatalog.modelId, "openai/gpt-6"));
    expect(gpt).toMatchObject({ enabled: false, available: true });
    expect(Number(gpt.inputPrice)).toBe(4);
    // Haiku isn't offered any more: unavailable, but still switched on for when it returns.
    const [haiku] = await db()
      .select()
      .from(modelCatalog)
      .where(eq(modelCatalog.modelId, "anthropic/claude-haiku-5.5"));
    expect(haiku).toMatchObject({ enabled: true, available: false });
    expect((await catalogFor("classify")).map((m) => m.modelId)).not.toContain("anthropic/claude-haiku-5.5");
  });

  it("adds models picked from the Gateway's list, named and priced as listed", async () => {
    const gateway = languageModels(MOCK_GATEWAY_MODELS);
    const pick = { tier: "fast" as const, tasks: ["generate" as const], enabled: true };
    expect(await addGatewayModel({ ...pick, modelId: "openai/gpt-5.5-mini" }, gateway)).toEqual({
      ok: true,
      label: "GPT-5.5 mini",
    });
    const [mini] = await db().select().from(modelCatalog).where(eq(modelCatalog.modelId, "openai/gpt-5.5-mini"));
    expect(mini).toMatchObject({ provider: "OpenAI", tier: "fast", enabled: true, available: true, markup: "2.00" });
    expect([Number(mini.inputPrice), Number(mini.outputPrice)]).toEqual([0.25, 2]);
    expect(mini.syncedAt).not.toBeNull();
    // Switched on as it's added, it's in Studio's list straight away.
    expect((await catalogFor("generate")).find((m) => m.modelId === "openai/gpt-5.5-mini")).toMatchObject({
      label: "GPT-5.5 mini",
      inputPrice: 0.25,
      outputPrice: 2,
    });

    // Switched off, it waits for an evaluation.
    await addGatewayModel({ ...pick, modelId: "google/gemini-3.5-pro", tier: "balanced", enabled: false }, gateway);
    expect((await catalogFor("generate")).map((m) => m.modelId)).not.toContain("google/gemini-3.5-pro");

    expect(await addGatewayModel({ ...pick, modelId: "openai/gpt-5.5-mini" }, gateway)).toMatchObject({ ok: false });
    expect(await addGatewayModel({ ...pick, modelId: "meta/llama-5-70b" }, gateway)).toEqual({
      ok: false,
      message: "The AI Gateway lists no price for it, so it can't be charged in credits.",
    });
    expect(await addGatewayModel({ ...pick, modelId: "acme/not-listed" }, gateway)).toMatchObject({ ok: false });
    expect((await db().select().from(modelCatalog).where(eq(modelCatalog.modelId, "meta/llama-5-70b"))).length).toBe(0);
  });
});

describe("workspace lookup", () => {
  it("finds a workspace by username and shows its money and AI use", async () => {
    const [match] = await searchWorkspaces("@rita");
    expect(match).toMatchObject({ id: workspaceId, usernames: ["rita.ships"] });
    expect(await searchWorkspaces("r")).toEqual([]);
    expect((await searchWorkspaces(workspaceId))[0]?.id).toBe(workspaceId);

    const detail = await workspaceDetail(workspaceId);
    expect(detail?.profiles).toEqual([expect.objectContaining({ username: "rita.ships", connected: true })]);
    expect(detail?.ledger.some((row) => row.note === "Card refunded in Stripe" && row.actor === PROFILE)).toBe(true);
    expect(await workspaceDetail("not-a-uuid")).toBeNull();
    const [ws] = await db().select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(detail?.workspace.name).toBe(ws.name);
  });
});
