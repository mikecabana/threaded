import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { createMockBilling, signPayload } from "@/e2e/mock-billing.mjs";
import { db } from "@/lib/db";
import { creditLedger, creditLots, memberships, users, wallets, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { closeDatabase, resetDatabase } from "@/test/db";
import { claimAutoRecharge, fulfillRechargeInvoice, runAutoRecharge } from "./auto-recharge";
import { checkGatewayKey, storeByokKey, switchToCredits } from "./byok";
import { createByokCheckout, createCardCheckout, createTopUpCheckout, fulfillCheckout } from "./checkout";
import { ensureCustomer, readyForAutoRecharge, stripeLocales } from "./stripe";
import { syncSubscription } from "./subscription";
import { getBalance } from "./wallet";

// Billing against e2e/mock-billing.mjs, a stateful stand-in for Stripe's API.

const mock = createMockBilling();
const ORIGIN = "http://app.test";
const PACK_5 = { id: "pack_5", usd: 5, credits: 500 } as const;
let workspaceId: string;
let ownerEmail: string;

const sessionId = (url: string) => url.split("/pay/")[1];

async function workspace() {
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return row;
}

async function setBalance(balance: number) {
  await db().update(wallets).set({ balance, reserved: 0 }).where(eq(wallets.workspaceId, workspaceId));
}

/** Saves a card through setup-mode Checkout, turning auto-recharge on at `threshold`. */
async function saveCard(outcome: "pay" | "decline-card", threshold = 100) {
  const url = await createCardCheckout({
    workspaceId,
    settings: { thresholdCredits: threshold, packId: "pack_20" },
    origin: ORIGIN,
  });
  await mock.completeSession(sessionId(url), outcome);
  return fulfillCheckout(sessionId(url));
}

beforeAll(async () => {
  await mock.listen(3997);
  await resetDatabase();
});
beforeEach(async () => {
  await db().delete(creditLots);
  await db().delete(creditLedger);
  await db().delete(workspaces);
  const [ws] = await db().insert(workspaces).values({ name: "@billing" }).returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db().insert(wallets).values({ workspaceId });
  // An owner with a confirmed address, so billing problems are emailed.
  ownerEmail = `owner-${ws.id}@example.com`;
  const [owner] = await db()
    .insert(users)
    .values({ threadsUserId: `t-${ws.id}`, email: ownerEmail, emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  await db().insert(memberships).values({ userId: owner.id, workspaceId });
});

const emailsTo = (to: string) => mock.state.emails.filter((e: { to: string[] }) => e.to.includes(to));
afterAll(async () => {
  await mock.close();
  await closeDatabase();
});

describe("credit top-ups", () => {
  it("credits a paid pack once, however often it's fulfilled", async () => {
    const url = await createTopUpCheckout({ workspaceId, pack: PACK_5, origin: ORIGIN });
    expect(url).toMatch(/^http:\/\/localhost:3997\/pay\/cs_test_/);
    const id = sessionId(url);

    // Not paid yet (the customer is still on the Checkout page).
    expect(await fulfillCheckout(id)).toMatchObject({ kind: "topup", status: "pending" });
    expect(await getBalance(workspaceId)).toBe(0);

    await mock.completeSession(id);
    expect(await fulfillCheckout(id)).toMatchObject({ kind: "topup", status: "fulfilled", credits: 500 });
    // The return page and the webhook both fulfill; only one counts.
    await fulfillCheckout(id);
    expect(await getBalance(workspaceId)).toBe(500);

    const [lot] = await db().select().from(creditLots).where(eq(creditLots.workspaceId, workspaceId));
    expect(lot).toMatchObject({ amount: 500, remaining: 500 });
  });

  it("asks Stripe for French receipts when the browser prefers French", async () => {
    expect(stripeLocales("fr-CA,fr;q=0.9,en;q=0.8")).toEqual(["fr-CA"]);
    expect(stripeLocales("fr-FR,fr;q=0.9")).toEqual(["fr"]);
    expect(stripeLocales("en-CA,en;q=0.9,fr-CA;q=0.8")).toBeUndefined();
    expect(stripeLocales(null)).toBeUndefined();

    await createTopUpCheckout({ workspaceId, pack: PACK_5, origin: ORIGIN, locales: ["fr-CA"] });
    const customer = mock.state.customers.get((await workspace()).stripeCustomerId);
    expect(customer.preferred_locales).toEqual(["fr-CA"]);
  });

  it("reuses one Stripe customer per workspace, even when created concurrently", async () => {
    const ids = await Promise.all([ensureCustomer(workspaceId), ensureCustomer(workspaceId)]);
    expect(new Set(ids).size).toBe(1);
    expect((await workspace()).stripeCustomerId).toBe(ids[0]);
  });
});

describe("Stripe webhook", () => {
  async function post(event: object, secret = "whsec_test_mock") {
    const payload = JSON.stringify(event);
    return webhook(
      new Request("http://app.test/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": signPayload(payload, secret) },
        body: payload,
      }),
    );
  }

  it("rejects bad signatures and applies signed events", async () => {
    const url = await createTopUpCheckout({ workspaceId, pack: PACK_5, origin: ORIGIN });
    const session = await mock.completeSession(sessionId(url));
    const event = { id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: session } };

    expect((await post(event, "whsec_wrong")).status).toBe(400);
    expect(await getBalance(workspaceId)).toBe(0);

    const response = await post(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: true, result: "handled" });
    expect(await getBalance(workspaceId)).toBe(500);
    // Stripe retries deliver the same event again.
    await post(event);
    expect(await getBalance(workspaceId)).toBe(500);
  });
});

describe("auto-recharge", () => {
  it("saves a card, then buys the pack when the balance drops below the threshold", async () => {
    expect(await saveCard("pay")).toMatchObject({ kind: "card", status: "fulfilled" });
    expect((await workspace()).autoRecharge).toEqual({ enabled: true, thresholdCredits: 100, packId: "pack_20" });

    await setBalance(150);
    expect(await claimAutoRecharge(workspaceId)).toBeNull();

    await setBalance(40);
    const attempt = await claimAutoRecharge(workspaceId);
    expect(attempt).not.toBeNull();
    // Only one recharge at a time.
    expect(await claimAutoRecharge(workspaceId)).toBeNull();

    expect(await runAutoRecharge(workspaceId, attempt as string)).toBe("recharged");
    expect(await getBalance(workspaceId)).toBe(2240);
    expect((await workspace()).autoRechargePendingAt).toBeNull();

    // A retried step, and the invoice.paid webhook, don't credit twice.
    expect(await runAutoRecharge(workspaceId, attempt as string)).toBe("skipped");
    const paid = [...mock.state.invoices.values()].find((invoice) => invoice.status === "paid");
    expect(paid?.subtotal).toBe(2000);
    // In USD, not the Canadian account's default currency.
    expect(paid?.currency).toBe("usd");
    expect(await fulfillRechargeInvoice(paid?.id as string)).toBe(false);
    expect(await getBalance(workspaceId)).toBe(2240);
  });

  it("turns itself off and leaves a notice when the card is declined", async () => {
    await saveCard("decline-card");
    await setBalance(10);
    const attempt = (await claimAutoRecharge(workspaceId)) as string;
    expect(await runAutoRecharge(workspaceId, attempt)).toBe("failed");

    const ws = await workspace();
    expect(ws.autoRecharge?.enabled).toBe(false);
    expect(ws.autoRechargePendingAt).toBeNull();
    expect(ws.billingNotice).toMatchObject({ kind: "auto_recharge_failed" });
    expect(ws.billingNotice?.message).toContain("Your card was declined.");
    expect(await getBalance(workspaceId)).toBe(10);
    expect([...mock.state.invoices.values()].at(-1)?.status).toBe("void");
    // Off means no more attempts until the user turns it back on.
    expect(await claimAutoRecharge(workspaceId)).toBeNull();
    // And the owner gets one email about it.
    expect(emailsTo(ownerEmail).map((e: { subject: string }) => e.subject)).toEqual([
      "Auto-recharge couldn't charge your card",
    ]);
  });
});

describe("auto-recharge with Stripe Tax on", () => {
  const taxSetting = env.STRIPE_AUTOMATIC_TAX;
  beforeEach(() => {
    env.STRIPE_AUTOMATIC_TAX = "1";
  });
  afterEach(() => {
    env.STRIPE_AUTOMATIC_TAX = taxSetting;
  });
  const customerId = async () => (await workspace()).stripeCustomerId as string;

  it("collects the address with the card, then charges a taxed invoice", async () => {
    await saveCard("pay");
    expect(mock.state.customers.get(await customerId()).address).toMatchObject({ country: "CA", state: "QC" });
    expect(await readyForAutoRecharge(await customerId())).toBe(true);

    await setBalance(40);
    const attempt = (await claimAutoRecharge(workspaceId)) as string;
    expect(await runAutoRecharge(workspaceId, attempt)).toBe("recharged");
    expect(await getBalance(workspaceId)).toBe(2240);
    expect([...mock.state.invoices.values()].at(-1)).toMatchObject({
      status: "paid",
      automatic_tax: { enabled: true },
    });
  });

  it("stops with a notice, rather than retrying, when there's no address to tax", async () => {
    // A card saved before tax was turned on: Checkout didn't ask for an address.
    env.STRIPE_AUTOMATIC_TAX = taxSetting;
    await saveCard("pay");
    env.STRIPE_AUTOMATIC_TAX = "1";
    // Turning auto-recharge back on will go through Checkout, which collects one.
    expect(await readyForAutoRecharge(await customerId())).toBe(false);

    await setBalance(10);
    const invoicesBefore = mock.state.invoices.size;
    const attempt = (await claimAutoRecharge(workspaceId)) as string;
    expect(await runAutoRecharge(workspaceId, attempt)).toBe("failed");

    const ws = await workspace();
    expect(ws.autoRecharge?.enabled).toBe(false);
    expect(ws.autoRechargePendingAt).toBeNull();
    expect(ws.billingNotice?.message).toContain("billing address");
    expect(mock.state.invoices.size).toBe(invoicesBefore);
  });
});

describe("bring your own key", () => {
  it("checks keys against the Gateway", async () => {
    expect(await checkGatewayKey("vck_good_key_1234")).toEqual({ ok: true, balanceUsd: 12.5 });
    expect(await checkGatewayKey("vck_bad_key_1234")).toEqual({ ok: false, reason: "invalid" });
  });

  it("needs the plan, switches back to credits, and resumes the plan with a new key", async () => {
    expect(await storeByokKey(workspaceId, "vck_good_key_abcd")).toBe("needs_plan");
    expect(await workspace()).toMatchObject({ billingMode: "credits", byokKeyLast4: "abcd" });

    const url = await createByokCheckout({ workspaceId, origin: ORIGIN });
    await mock.completeSession(sessionId(url));
    expect(await fulfillCheckout(sessionId(url))).toMatchObject({ kind: "byok", status: "fulfilled" });
    let ws = await workspace();
    expect(ws).toMatchObject({
      billingMode: "byok",
      subscriptionStatus: "active",
      subscriptionCancelAtPeriodEnd: false,
    });
    expect(ws.subscriptionPeriodEnd?.getTime()).toBeGreaterThan(Date.now());
    // The key is stored encrypted, never in the clear.
    expect(ws.byokKeyEnc).not.toContain("vck_");

    await switchToCredits(workspaceId);
    expect(await workspace()).toMatchObject({
      billingMode: "credits",
      byokKeyEnc: null,
      byokKeyLast4: null,
      subscriptionStatus: "active",
      subscriptionCancelAtPeriodEnd: true,
    });

    // Changing their mind before the period ends un-cancels the same plan.
    expect(await storeByokKey(workspaceId, "vck_good_key_efgh")).toBe("active");
    ws = await workspace();
    expect(ws).toMatchObject({ billingMode: "byok", byokKeyLast4: "efgh", subscriptionCancelAtPeriodEnd: false });

    // The plan lapsing deletes the key and leaves a notice.
    await mock.setSubscription(ws.stripeSubscriptionId as string, { status: "canceled" });
    await syncSubscription(ws.stripeSubscriptionId as string);
    expect(await workspace()).toMatchObject({
      billingMode: "credits",
      byokKeyEnc: null,
      subscriptionStatus: "canceled",
      billingNotice: { kind: "byok_ended" },
    });
    // Seeing the same ended plan again doesn't email twice.
    await syncSubscription(ws.stripeSubscriptionId as string);
    expect(emailsTo(ownerEmail).map((e: { subject: string }) => e.subject)).toEqual(["Your Threaded plan has ended"]);
  });
});
