import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { creditLedger, creditLots, wallets, workspaces } from "@/lib/db/schema";
import { closeDatabase, resetDatabase } from "@/test/db";
import {
  creditExpiry,
  expireCredits,
  getBalance,
  grantCredits,
  InsufficientCreditsError,
  releaseCredits,
  reserveCredits,
  settleCredits,
} from "./wallet";

let workspaceId: string;
const DAY = 86_400_000;

/** Empties the wallet, then grants `balance` as one lot that never expires. */
async function setBalance(balance: number) {
  await db().delete(creditLots);
  await db().delete(creditLedger);
  await db().update(wallets).set({ balance: 0, reserved: 0 }).where(eq(wallets.workspaceId, workspaceId));
  if (balance > 0) await grantCredits({ workspaceId, amount: balance, kind: "adjust", ref: "seed", expiresAt: null });
}

async function lots() {
  return db()
    .select({ amount: creditLots.amount, remaining: creditLots.remaining, expiresAt: creditLots.expiresAt })
    .from(creditLots)
    .where(eq(creditLots.workspaceId, workspaceId))
    .orderBy(asc(creditLots.createdAt));
}

/** Lots always hold exactly the wallet's balance plus what's reserved. */
async function expectLotsMatchWallet() {
  const { balance, reserved } = await wallet();
  const held = (await lots()).reduce((sum, lot) => sum + lot.remaining, 0);
  expect(held).toBe(balance + reserved);
}

async function wallet() {
  const [row] = await db().select().from(wallets).where(eq(wallets.workspaceId, workspaceId));
  return row;
}

beforeAll(async () => {
  await resetDatabase();
  const [ws] = await db().insert(workspaces).values({ name: "test" }).returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db().insert(wallets).values({ workspaceId, balance: 0 });
});
beforeEach(() => setBalance(100));
afterAll(closeDatabase);

describe("wallet", () => {
  it("reserves, then settles at the actual cost and refunds the rest", async () => {
    const hold = await reserveCredits(workspaceId, 30, "gen-1");
    expect(await wallet()).toMatchObject({ balance: 70, reserved: 30 });

    expect(await settleCredits(hold, 12)).toBe(true);
    expect(await wallet()).toMatchObject({ balance: 88, reserved: 0 });

    const ledger = await db().select().from(creditLedger).where(eq(creditLedger.ref, "gen-1"));
    expect(ledger.map((r) => [r.kind, r.delta]).sort()).toEqual([
      ["reserve", -30],
      ["settle", 18],
    ]);
    // The ledger always sums to the net charge.
    expect(ledger.reduce((sum, r) => sum + r.delta, 0)).toBe(-12);
  });

  it("refuses to overdraw", async () => {
    await expect(reserveCredits(workspaceId, 101, "gen-2")).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await wallet()).toMatchObject({ balance: 100, reserved: 0 });
  });

  it("never lets concurrent reserves overdraw", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => reserveCredits(workspaceId, 30, `race-${i}`)),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(3);
    expect(await wallet()).toMatchObject({ balance: 10, reserved: 90 });
  });

  it("caps the charge at the hold and releases idempotently", async () => {
    const capped = await reserveCredits(workspaceId, 20, "gen-3");
    await settleCredits(capped, 999);
    expect(await getBalance(workspaceId)).toBe(80);

    const failed = await reserveCredits(workspaceId, 20, "gen-4");
    expect(await releaseCredits(failed)).toBe(true);
    expect(await releaseCredits(failed)).toBe(false);
    expect(await settleCredits(failed, 5)).toBe(false);
    expect(await wallet()).toMatchObject({ balance: 80, reserved: 0 });
  });

  it("lets only one of a concurrent settle and release win", async () => {
    const hold = await reserveCredits(workspaceId, 40, "gen-5");
    const results = await Promise.all([settleCredits(hold, 10), releaseCredits(hold), settleCredits(hold, 10)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const { balance, reserved } = await wallet();
    expect(reserved).toBe(0);
    expect([90, 100]).toContain(balance);
    await expectLotsMatchWallet();
  });
});

describe("credit lots", () => {
  it("grants once per (kind, ref)", async () => {
    const grant = {
      workspaceId,
      amount: 500,
      kind: "purchase" as const,
      ref: "cs_test_1",
      expiresAt: creditExpiry(new Date()),
    };
    expect(await grantCredits(grant)).toBe(true);
    expect(await grantCredits(grant)).toBe(false);
    expect(await getBalance(workspaceId)).toBe(600);
    expect(await lots()).toHaveLength(2);
    await expectLotsMatchWallet();
  });

  it("spends the soonest-expiring credits first", async () => {
    const now = Date.now();
    await grantCredits({
      workspaceId,
      amount: 50,
      kind: "purchase",
      ref: "late",
      expiresAt: new Date(now + 300 * DAY),
    });
    await grantCredits({ workspaceId, amount: 30, kind: "purchase", ref: "soon", expiresAt: new Date(now + 10 * DAY) });

    const hold = await reserveCredits(workspaceId, 60, "gen-lots");
    await settleCredits(hold, 40);
    // Seed (never expires) 100, late 50, soon 30: the 40 comes from "soon" (30), then "late" (10).
    expect((await lots()).map((lot) => lot.remaining)).toEqual([100, 40, 0]);
    await expectLotsMatchWallet();
  });

  it("expires lots past their date, but not while a generation is in flight", async () => {
    const now = new Date();
    await grantCredits({ workspaceId, amount: 25, kind: "purchase", ref: "old", expiresAt: new Date(+now - DAY) });
    expect(await getBalance(workspaceId)).toBe(125);

    const hold = await reserveCredits(workspaceId, 10, "gen-busy");
    expect(await expireCredits(now)).toEqual({ workspaces: 0, credits: 0 });
    await settleCredits(hold, 4);
    // The charge drew on the expired lot first, so only 21 are left to expire.
    expect(await expireCredits(now)).toEqual({ workspaces: 1, credits: 21 });
    expect(await getBalance(workspaceId)).toBe(100);
    expect(await expireCredits(now)).toEqual({ workspaces: 0, credits: 0 });

    const expired = await db().select().from(creditLedger).where(eq(creditLedger.kind, "expire"));
    expect(expired.map((row) => row.delta)).toEqual([-21]);
    await expectLotsMatchWallet();
  });
});
