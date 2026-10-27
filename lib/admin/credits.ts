import "server-only";
import { eq } from "drizzle-orm";
import { getBalance, grantCredits, InsufficientCreditsError, removeCredits } from "@/lib/billing/wallet";
import { db } from "@/lib/db";
import { wallets } from "@/lib/db/schema";

// Manual credit adjustments from /admin, written as `adjust` ledger rows with
// the reason and who made them. Adding credits makes a new lot; taking them
// back draws on the oldest lots, and never below zero. For a card refund,
// refund in Stripe first, then take the credits back here.

/** The most one adjustment can move, either way. */
export const MAX_ADJUSTMENT = 100_000;

export type AdjustmentProblem = "zero" | "too_large" | "no_reason" | "not_found" | "insufficient" | "duplicate";

export async function adjustCredits(input: {
  workspaceId: string;
  amount: number;
  reason: string;
  actorUserId: string;
  /** One per submitted form, so a double submit applies once. */
  token: string;
}): Promise<{ ok: true; balance: number } | { ok: false; problem: AdjustmentProblem }> {
  const amount = Math.trunc(input.amount);
  const reason = input.reason.trim().slice(0, 200);
  if (!Number.isFinite(amount) || amount === 0) return { ok: false, problem: "zero" };
  if (Math.abs(amount) > MAX_ADJUSTMENT) return { ok: false, problem: "too_large" };
  if (reason.length < 3) return { ok: false, problem: "no_reason" };
  const [wallet] = await db()
    .select({ id: wallets.workspaceId })
    .from(wallets)
    .where(eq(wallets.workspaceId, input.workspaceId));
  if (!wallet) return { ok: false, problem: "not_found" };

  const ref = `admin:${input.token}`;
  try {
    const applied =
      amount > 0
        ? await grantCredits({
            workspaceId: input.workspaceId,
            amount,
            kind: "adjust",
            ref,
            note: reason,
            actorUserId: input.actorUserId,
          })
        : await removeCredits({
            workspaceId: input.workspaceId,
            amount: -amount,
            ref,
            note: reason,
            actorUserId: input.actorUserId,
          });
    if (!applied) return { ok: false, problem: "duplicate" };
  } catch (error) {
    if (error instanceof InsufficientCreditsError) return { ok: false, problem: "insufficient" };
    throw error;
  }
  return { ok: true, balance: await getBalance(input.workspaceId) };
}
