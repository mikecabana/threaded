import "server-only";
import { and, asc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { creditLedger, creditLots, wallets } from "@/lib/db/schema";

// Two-phase spending. A generation first reserves the most it could cost
// (one conditional UPDATE, so concurrent requests can't overdraw), then settles
// at the actual cost, returning the difference. Every movement is a ledger row;
// (kind, ref) is unique, so retries can't double-charge or double-refund.
//
// Ledger `delta` is the change to the spendable balance:
//   purchase/trial  +n     reserve  −max     settle  +(max − charged)     release  +max
//
// Credits never expire. They still arrive in lots (one per purchase or grant),
// which say how much of each purchase is left, for refunds and for accounting
// (unspent credits are owed to the customer). Only the settled charge draws on
// lots, oldest first.
// Lock order is reserve row → wallet → lots everywhere, so nothing deadlocks.

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

export interface Grant {
  workspaceId: string;
  amount: number;
  kind: "purchase" | "trial" | "adjust";
  /** Idempotency reference: the Checkout Session or invoice id, a hashed Threads id, etc. */
  ref: string;
  /** For manual adjustments: why, and who. */
  note?: string;
  actorUserId?: string;
}

/**
 * Adds credits as a new lot. Returns false if this (kind, ref) was already
 * granted, so webhook retries and the checkout return page can both call it.
 * Pass `tx` to make it part of a larger transaction.
 */
export async function grantCredits(grant: Grant, tx?: Tx): Promise<boolean> {
  if (!tx) return db().transaction((inner) => grantCredits(grant, inner));
  const [ledger] = await tx
    .insert(creditLedger)
    .values({
      workspaceId: grant.workspaceId,
      delta: grant.amount,
      kind: grant.kind,
      ref: grant.ref,
      note: grant.note,
      actorUserId: grant.actorUserId,
    })
    .onConflictDoNothing({ target: [creditLedger.kind, creditLedger.ref] })
    .returning({ id: creditLedger.id });
  if (!ledger) return false;
  await tx.insert(creditLots).values({
    workspaceId: grant.workspaceId,
    ledgerId: ledger.id,
    amount: grant.amount,
    remaining: grant.amount,
  });
  await tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${grant.amount}` })
    .where(eq(wallets.workspaceId, grant.workspaceId));
  return true;
}

/** Draws `amount` from the workspace's lots, oldest first. Caller holds the wallet lock. */
async function consumeLots(tx: Tx, workspaceId: string, amount: number) {
  if (amount <= 0) return;
  const lots = await tx
    .select({ id: creditLots.id, remaining: creditLots.remaining })
    .from(creditLots)
    .where(and(eq(creditLots.workspaceId, workspaceId), gt(creditLots.remaining, 0)))
    .orderBy(asc(creditLots.createdAt))
    .for("update");
  let left = amount;
  for (const lot of lots) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    await tx
      .update(creditLots)
      .set({ remaining: sql`${creditLots.remaining} - ${take}` })
      .where(eq(creditLots.id, lot.id));
    left -= take;
  }
  if (left > 0) console.error(`Wallet ${workspaceId}: lots were ${left} credits short of a charge.`);
}

/**
 * Takes credits back (a manual adjustment), oldest lots first. Never takes
 * more than the spendable balance. Returns false if this ref was already
 * applied, and throws InsufficientCreditsError if the balance is too low.
 */
export async function removeCredits(input: {
  workspaceId: string;
  amount: number;
  ref: string;
  note: string;
  actorUserId: string;
}): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [wallet] = await tx
      .select({ balance: wallets.balance })
      .from(wallets)
      .where(eq(wallets.workspaceId, input.workspaceId))
      .for("update");
    if (!wallet || wallet.balance < input.amount)
      throw new InsufficientCreditsError(input.amount, wallet?.balance ?? 0);
    const [ledger] = await tx
      .insert(creditLedger)
      .values({
        workspaceId: input.workspaceId,
        delta: -input.amount,
        kind: "adjust",
        ref: input.ref,
        note: input.note,
        actorUserId: input.actorUserId,
      })
      .onConflictDoNothing({ target: [creditLedger.kind, creditLedger.ref] })
      .returning({ id: creditLedger.id });
    if (!ledger) return false;
    await consumeLots(tx, input.workspaceId, input.amount);
    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} - ${input.amount}` })
      .where(eq(wallets.workspaceId, input.workspaceId));
    return true;
  });
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
    await tx
      .select({ workspaceId: wallets.workspaceId })
      .from(wallets)
      .where(eq(wallets.workspaceId, hold.workspaceId))
      .for("update");
    await consumeLots(tx, hold.workspaceId, charged);
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
