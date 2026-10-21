import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  type AutoRechargeSettings,
  type BillingNotice,
  creditLedger,
  creditLots,
  generations,
  threadsProfiles,
  wallets,
  workspaces,
} from "@/lib/db/schema";
import { GOAL_META } from "@/lib/goals";

/** Show "expiring soon" this far ahead. */
const EXPIRY_WARNING_DAYS = 30;

export interface BillingOverview {
  mode: "credits" | "byok";
  balance: number;
  reserved: number;
  /** Credits that expire within the warning window, and the soonest date. */
  expiring: { credits: number; at: Date } | null;
  autoRecharge: AutoRechargeSettings | null;
  customerId: string | null;
  keyLast4: string | null;
  plan: { status: string; periodEnd: Date | null; cancelAtPeriodEnd: boolean } | null;
  notice: BillingNotice | null;
}

export async function billingOverview(workspaceId: string, now: Date): Promise<BillingOverview> {
  const [row] = await db()
    .select({ workspace: workspaces, balance: wallets.balance, reserved: wallets.reserved })
    .from(workspaces)
    .leftJoin(wallets, eq(wallets.workspaceId, workspaces.id))
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw new Error(`No workspace ${workspaceId}.`);

  const soon = await db()
    .select({ remaining: creditLots.remaining, expiresAt: creditLots.expiresAt })
    .from(creditLots)
    .where(
      and(
        eq(creditLots.workspaceId, workspaceId),
        gt(creditLots.remaining, 0),
        isNotNull(creditLots.expiresAt),
        lte(creditLots.expiresAt, new Date(now.getTime() + EXPIRY_WARNING_DAYS * 86_400_000)),
      ),
    );
  const expiringCredits = soon.reduce((sum, lot) => sum + lot.remaining, 0);
  const firstExpiry = soon.map((lot) => lot.expiresAt as Date).sort((a, b) => a.getTime() - b.getTime())[0];

  const { workspace } = row;
  return {
    mode: workspace.billingMode,
    balance: row.balance ?? 0,
    reserved: row.reserved ?? 0,
    expiring: expiringCredits > 0 ? { credits: expiringCredits, at: firstExpiry } : null,
    autoRecharge: workspace.autoRecharge,
    customerId: workspace.stripeCustomerId,
    keyLast4: workspace.byokKeyLast4,
    plan: workspace.subscriptionStatus
      ? {
          status: workspace.subscriptionStatus,
          periodEnd: workspace.subscriptionPeriodEnd,
          cancelAtPeriodEnd: workspace.subscriptionCancelAtPeriodEnd,
        }
      : null,
    notice: workspace.billingNotice,
  };
}

export interface ActivityItem {
  id: string;
  at: Date;
  kind: "purchase" | "auto_recharge" | "trial" | "usage" | "expire" | "adjust" | "refund";
  label: string;
  /** Signed change to the balance. */
  credits: number;
}

const LEDGER_LABELS = {
  purchase: "Bought credits",
  auto_recharge: "Auto-recharge",
  trial: "Free trial",
  expire: "Credits expired",
  adjust: "Adjustment",
  refund: "Refund",
} as const;

/** Purchases, grants, expiries and AI usage, newest first. Reservations net out into usage. */
export async function billingActivity(workspaceId: string, limit = 20): Promise<ActivityItem[]> {
  const ledger = await db()
    .select({
      id: creditLedger.id,
      at: creditLedger.createdAt,
      kind: creditLedger.kind,
      ref: creditLedger.ref,
      delta: creditLedger.delta,
    })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.workspaceId, workspaceId),
        inArray(creditLedger.kind, ["purchase", "trial", "expire", "adjust", "refund"]),
      ),
    )
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);

  const usage = await db()
    .select({
      id: generations.id,
      at: generations.createdAt,
      goal: generations.goal,
      credits: generations.creditsCharged,
    })
    .from(generations)
    .innerJoin(threadsProfiles, eq(threadsProfiles.id, generations.profileId))
    .where(and(eq(threadsProfiles.workspaceId, workspaceId), gt(generations.creditsCharged, 0)))
    .orderBy(desc(generations.createdAt))
    .limit(limit);

  const items: ActivityItem[] = [
    ...ledger.map((row) => {
      // Auto-recharges are paid by invoice (in_…); Checkout top-ups by session (cs_…).
      const kind = row.kind === "purchase" && row.ref.startsWith("in_") ? "auto_recharge" : row.kind;
      const known = kind as keyof typeof LEDGER_LABELS;
      return { id: row.id, at: row.at, kind: known, label: LEDGER_LABELS[known], credits: row.delta };
    }),
    ...usage.map((row) => ({
      id: row.id,
      at: row.at,
      kind: "usage" as const,
      label: `Studio ideas · ${GOAL_META[row.goal].label}`,
      credits: -row.credits,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
