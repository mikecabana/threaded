import "server-only";
import type { GatewaySpendReportParams } from "@ai-sdk/gateway";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditLedger, generations, threadsProfiles, wallets, workspaces } from "@/lib/db/schema";
import { BYOK_PLATFORM_FEE_USD, CREDIT_USD } from "@/lib/pricing";

// The margin view (docs/PLAN.md §6): what credits brought in against what the
// AI cost. Studio generations carry their own Gateway cost, so per-model and
// per-workspace margins come from our database. The Gateway's spend report
// adds what the database can't see: background work (classification, DNA),
// which runs on our account for credit workspaces.

const DAY_MS = 86_400_000;
const LIVE_PLANS = ["active", "trialing", "past_due"];

export type SpendReport = (
  params: GatewaySpendReportParams,
) => Promise<{ results: { model?: string; tag?: string; totalCost: number; requestCount?: number }[] }>;

export interface ModelMargin {
  model: string;
  generations: number;
  revenueUsd: number;
  costUsd: number;
}

export interface WorkspaceMargin {
  workspaceId: string;
  name: string;
  generations: number;
  revenueUsd: number;
  costUsd: number;
}

export interface GatewaySpend {
  totalUsd: number;
  byModel: { model: string; costUsd: number; requests: number }[];
  byTask: { task: string; costUsd: number; requests: number }[];
}

export interface MarginReport {
  days: number;
  since: string;
  revenueUsd: number;
  generationCostUsd: number;
  generations: number;
  ownKeyGenerations: number;
  creditsSoldUsd: number;
  trialCredits: number;
  adjustedCredits: number;
  /** Credits bought or granted and not yet spent: owed to customers. */
  outstandingCredits: number;
  ownKeyPlans: number;
  byModel: ModelMargin[];
  byWorkspace: WorkspaceMargin[];
  gateway: { ok: true; spend: GatewaySpend } | { ok: false; reason: string };
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/** System-credential spend from the Gateway: everything on our account, by model and by task tag. */
export async function gatewaySpend(report: SpendReport, since: Date, now: Date): Promise<GatewaySpend> {
  const range = { startDate: day(since), endDate: day(now), credentialType: "system" as const };
  const [models, tags] = await Promise.all([
    report({ ...range, groupBy: "model" }),
    report({ ...range, groupBy: "tag" }),
  ]);
  const byModel = models.results
    .map((r) => ({ model: r.model ?? "unknown", costUsd: r.totalCost, requests: r.requestCount ?? 0 }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const byTask = tags.results
    .filter((r) => r.tag?.startsWith("task:"))
    .map((r) => ({ task: (r.tag ?? "").slice(5), costUsd: r.totalCost, requests: r.requestCount ?? 0 }))
    .sort((a, b) => b.costUsd - a.costUsd);
  return { totalUsd: byModel.reduce((sum, r) => sum + r.costUsd, 0), byModel, byTask };
}

export async function marginReport(input: {
  days: number;
  now?: Date;
  spend?: SpendReport | null;
}): Promise<MarginReport> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - input.days * DAY_MS);
  const recent = gte(generations.createdAt, since);
  const credits = and(recent, eq(generations.status, "done"), eq(generations.billingMode, "credits"));
  const revenue = sql<number>`coalesce(sum(${generations.creditsCharged}), 0)::int`;
  const cost = sql<string>`coalesce(sum(${generations.costUsd}), 0)`;
  const count = sql<number>`count(*)::int`;
  const ledgerSum = (kind: "purchase" | "trial" | "adjust") =>
    db()
      .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
      .from(creditLedger)
      .where(and(eq(creditLedger.kind, kind), gte(creditLedger.createdAt, since)));

  const [byModel, byWorkspace, ownKey, sold, trial, adjusted, outstanding, plans] = await Promise.all([
    db()
      .select({ model: generations.model, generations: count, credits: revenue, cost })
      .from(generations)
      .where(credits)
      .groupBy(generations.model)
      .orderBy(desc(revenue)),
    db()
      .select({
        workspaceId: workspaces.id,
        name: workspaces.name,
        generations: count,
        credits: revenue,
        cost,
      })
      .from(generations)
      .innerJoin(threadsProfiles, eq(threadsProfiles.id, generations.profileId))
      .innerJoin(workspaces, eq(workspaces.id, threadsProfiles.workspaceId))
      .where(credits)
      .groupBy(workspaces.id, workspaces.name)
      .orderBy(desc(revenue))
      .limit(20),
    db()
      .select({ count })
      .from(generations)
      .where(and(recent, eq(generations.status, "done"), eq(generations.billingMode, "byok"))),
    ledgerSum("purchase"),
    ledgerSum("trial"),
    ledgerSum("adjust"),
    db()
      .select({ total: sql<number>`coalesce(sum(${wallets.balance} + ${wallets.reserved}), 0)::int` })
      .from(wallets),
    db().select({ count }).from(workspaces).where(inArray(workspaces.subscriptionStatus, LIVE_PLANS)),
  ]);

  const toMargin = (row: { generations: number; credits: number; cost: string }) => ({
    generations: row.generations,
    revenueUsd: row.credits * CREDIT_USD,
    costUsd: Number(row.cost),
  });
  const models = byModel.map((row) => ({ model: row.model, ...toMargin(row) }));

  let gateway: MarginReport["gateway"];
  if (!input.spend) {
    gateway = { ok: false, reason: "The AI Gateway isn't reachable from this deployment." };
  } else {
    try {
      gateway = { ok: true, spend: await gatewaySpend(input.spend, since, now) };
    } catch (error) {
      gateway = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    days: input.days,
    since: since.toISOString(),
    revenueUsd: models.reduce((sum, m) => sum + m.revenueUsd, 0),
    generationCostUsd: models.reduce((sum, m) => sum + m.costUsd, 0),
    generations: models.reduce((sum, m) => sum + m.generations, 0),
    ownKeyGenerations: ownKey[0]?.count ?? 0,
    creditsSoldUsd: (sold[0]?.total ?? 0) * CREDIT_USD,
    trialCredits: trial[0]?.total ?? 0,
    adjustedCredits: adjusted[0]?.total ?? 0,
    outstandingCredits: outstanding[0]?.total ?? 0,
    ownKeyPlans: plans[0]?.count ?? 0,
    byModel: models,
    byWorkspace: byWorkspace.map((row) => ({
      workspaceId: row.workspaceId,
      name: row.name,
      ...toMargin(row),
    })),
    gateway,
  };
}

/** Monthly own-key plan revenue, for the summary. */
export const ownKeyMonthlyUsd = (plans: number) => plans * BYOK_PLATFORM_FEE_USD;
