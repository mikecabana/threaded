import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditLedger, wallets } from "@/lib/db/schema";

// Two-phase spending. A generation first reserves the most it could cost
// (one conditional UPDATE, so concurrent requests can't overdraw), then settles
// at the actual cost, returning the difference. Every movement is a ledger row;
// (kind, ref) is unique, so retries can't double-charge or double-refund.
//
// Ledger `delta` is the change to the spendable balance:
//   reserve  −max     settle  +(max − charged)     release  +max

export class InsufficientCreditsError extends Error {
  constructor(
    readonly needed: number,
    readonly balance: number,
  ) {
    super(`Needs ${needed} credits, ${balance} available.`);
    this.name = "InsufficientCreditsError";
  }
}

export interface Hold {
  workspaceId: string;
  /** Usually the generation id. */
  ref: string;
  amount: number;
}

export async function getBalance(workspaceId: string): Promise<number> {
  const [wallet] = await db()
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.workspaceId, workspaceId));
  return wallet?.balance ?? 0;
}

export async function reserveCredits(workspaceId: string, amount: number, ref: string): Promise<Hold> {
  return db().transaction(async (tx) => {
    const [updated] = await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${amount}`, reserved: sql`${wallets.reserved} + ${amount}` })
      .where(and(eq(wallets.workspaceId, workspaceId), gte(wallets.balance, amount)))
      .returning({ balance: wallets.balance });
    if (!updated) {
      const [wallet] = await tx
        .select({ balance: wallets.balance })
        .from(wallets)
        .where(eq(wallets.workspaceId, workspaceId));
      throw new InsufficientCreditsError(amount, wallet?.balance ?? 0);
    }
    await tx.insert(creditLedger).values({ workspaceId, delta: -amount, kind: "reserve", ref });
    return { workspaceId, ref, amount };
  });
}

async function close(hold: Hold, kind: "settle" | "release", charged: number): Promise<boolean> {
  const refund = hold.amount - charged;
  return db().transaction(async (tx) => {
    // Lock the hold's reserve row so a concurrent settle and release can't both win.
    const [reserve] = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.kind, "reserve"), eq(creditLedger.ref, hold.ref)))
      .for("update");
    if (!reserve) throw new Error(`No reservation for ${hold.ref}.`);
    const [closed] = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.ref, hold.ref), inArray(creditLedger.kind, ["settle", "release"])));
    // Already closed (a retry, or the other outcome won): nothing to do.
    if (closed) return false;
    await tx.insert(creditLedger).values({ workspaceId: hold.workspaceId, delta: refund, kind, ref: hold.ref });
    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${refund}`, reserved: sql`${wallets.reserved} - ${hold.amount}` })
      .where(eq(wallets.workspaceId, hold.workspaceId));
    return true;
  });
}

/** Charges `charged` (capped at the hold) and returns the rest. Idempotent. */
export async function settleCredits(hold: Hold, charged: number): Promise<boolean> {
  return close(hold, "settle", Math.max(0, Math.min(hold.amount, Math.round(charged))));
}

/** Returns the whole hold, e.g. when the provider failed before producing anything. Idempotent. */
export async function releaseCredits(hold: Hold): Promise<boolean> {
  return close(hold, "release", 0);
}
