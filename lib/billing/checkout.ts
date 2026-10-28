import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { type AutoRechargeSettings, workspaces } from "@/lib/db/schema";
import { BYOK_PLATFORM_FEE_USD, type CreditPack, CURRENCY, MONTHLY_PLAN, packById } from "@/lib/pricing";
import { maybeStartAutoRecharge } from "./auto-recharge";
import { automaticTax, ensureCustomer, stripe } from "./stripe";
import { fulfillPlanInvoice, syncSubscription } from "./subscription";
import { grantCredits } from "./wallet";

// Hosted Checkout for everything a customer pays for: credit packs, the BYOK
// plan, and saving a card for auto-recharge. Each session's metadata says what
// it's for; fulfillCheckout() turns a completed session into credits, a plan or
// a saved card, and is safe to run more than once (the webhook and the return
// page both call it).

// Stripe sends customers back through /api/billing/return, which fulfills the
// session before showing the billing page, so the new balance is there at once.
const returnUrls = (origin: string) => ({
  success_url: `${origin}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${origin}/settings/billing?checkout=canceled`,
});

/** Tax needs the customer's address; Checkout collects it and saves it on the customer. */
function taxOptions() {
  const tax = automaticTax();
  return tax.enabled
    ? { automatic_tax: tax, customer_update: { address: "auto" as const, name: "auto" as const } }
    : { automatic_tax: tax };
}

export async function createTopUpCheckout(input: {
  workspaceId: string;
  pack: CreditPack;
  origin: string;
  locales?: string[];
}) {
  const customer = await ensureCustomer(input.workspaceId, input.locales);
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: input.workspaceId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: input.pack.usd * 100,
          tax_behavior: "exclusive",
          product_data: { name: `${input.pack.credits.toLocaleString("en-US")} Threaded credits` },
        },
      },
    ],
    metadata: { kind: "topup", workspaceId: input.workspaceId, packId: input.pack.id },
    ...taxOptions(),
    ...returnUrls(input.origin),
  });
  return session.url as string;
}

/** The $5/month platform fee that unlocks bring-your-own-key. */
export async function createByokCheckout(input: { workspaceId: string; origin: string; locales?: string[] }) {
  const customer = await ensureCustomer(input.workspaceId, input.locales);
  const metadata = { kind: "byok", workspaceId: input.workspaceId };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: input.workspaceId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: BYOK_PLATFORM_FEE_USD * 100,
          recurring: { interval: "month" },
          tax_behavior: "exclusive",
          product_data: { name: "Threaded platform fee (your own AI key)" },
        },
      },
    ],
    metadata,
    subscription_data: { metadata },
    ...taxOptions(),
    ...returnUrls(input.origin),
  });
  return session.url as string;
}

/** The Monthly plan: its credits come with every paid invoice (fulfillPlanInvoice). */
export async function createMonthlyCheckout(input: { workspaceId: string; origin: string; locales?: string[] }) {
  const customer = await ensureCustomer(input.workspaceId, input.locales);
  const metadata = { kind: "monthly", workspaceId: input.workspaceId };
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: input.workspaceId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: MONTHLY_PLAN.usd * 100,
          recurring: { interval: "month" },
          tax_behavior: "exclusive",
          product_data: {
            name: `Threaded Monthly plan (${MONTHLY_PLAN.credits.toLocaleString("en-US")} credits a month)`,
          },
        },
      },
    ],
    metadata,
    subscription_data: { metadata },
    ...taxOptions(),
    ...returnUrls(input.origin),
  });
  return session.url as string;
}

/** Saves a card without charging it, then turns on auto-recharge with these settings. */
export async function createCardCheckout(input: {
  workspaceId: string;
  settings: Omit<AutoRechargeSettings, "enabled">;
  origin: string;
  locales?: string[];
}) {
  const customer = await ensureCustomer(input.workspaceId, input.locales);
  const session = await stripe().checkout.sessions.create({
    mode: "setup",
    currency: CURRENCY,
    customer,
    client_reference_id: input.workspaceId,
    metadata: {
      kind: "card",
      workspaceId: input.workspaceId,
      thresholdCredits: String(input.settings.thresholdCredits),
      packId: input.settings.packId,
    },
    // Auto-recharge invoices are taxed at the customer's address, so collect it with the card.
    ...(automaticTax().enabled && {
      billing_address_collection: "required" as const,
      customer_update: { address: "auto" as const, name: "auto" as const },
    }),
    ...returnUrls(input.origin),
  });
  return session.url as string;
}

export type FulfillResult =
  | { kind: "topup"; workspaceId: string; status: "fulfilled" | "pending"; credits: number }
  | { kind: "byok" | "card" | "monthly"; workspaceId: string; status: "fulfilled" | "pending" }
  | { kind: "ignored" };

const id = (value: string | { id: string } | null) => (typeof value === "string" ? value : (value?.id ?? null));

/**
 * Applies a Checkout Session. Re-reads it from Stripe, so a webhook payload or
 * a session id in a URL can only ever apply what Stripe says was paid for.
 * The return page passes the signed-in workspace, so it can't apply anyone else's.
 */
export async function fulfillCheckout(sessionId: string, expectedWorkspaceId?: string): Promise<FulfillResult> {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const workspaceId = session.metadata?.workspaceId;
  const kind = session.metadata?.kind;
  if (!workspaceId || session.client_reference_id !== workspaceId) return { kind: "ignored" };
  if (expectedWorkspaceId && workspaceId !== expectedWorkspaceId) return { kind: "ignored" };

  if (kind === "topup") return fulfillTopUp(session, workspaceId);
  if (session.status !== "complete") {
    return kind === "byok" || kind === "card" || kind === "monthly"
      ? { kind, workspaceId, status: "pending" }
      : { kind: "ignored" };
  }
  if (kind === "monthly") {
    // The plan's first credits come with its first invoice; the webhook may not have arrived yet.
    const subscription = id(session.subscription);
    if (subscription) {
      await syncSubscription(subscription);
      const invoice = id((await stripe().subscriptions.retrieve(subscription)).latest_invoice);
      if (invoice) await fulfillPlanInvoice(invoice);
    }
    return { kind, workspaceId, status: "fulfilled" };
  }
  if (kind === "byok") {
    const subscription = id(session.subscription);
    if (subscription) await syncSubscription(subscription);
    return { kind, workspaceId, status: "fulfilled" };
  }
  if (kind === "card") {
    await saveCardFromSetup(session, workspaceId);
    return { kind, workspaceId, status: "fulfilled" };
  }
  return { kind: "ignored" };
}

async function fulfillTopUp(session: Stripe.Checkout.Session, workspaceId: string): Promise<FulfillResult> {
  const pack = packById(session.metadata?.packId);
  if (!pack) return { kind: "ignored" };
  // Delayed payment methods complete the session before the money arrives;
  // checkout.session.async_payment_succeeded brings us back when it does.
  if (session.payment_status !== "paid")
    return { kind: "topup", workspaceId, status: "pending", credits: pack.credits };
  if (session.amount_subtotal !== pack.usd * 100) {
    console.error(`Checkout ${session.id}: paid ${session.amount_subtotal}¢ for ${pack.id}; not crediting.`);
    return { kind: "ignored" };
  }
  await db().transaction(async (tx) => {
    const granted = await grantCredits({ workspaceId, amount: pack.credits, kind: "purchase", ref: session.id }, tx);
    // A successful top-up clears a failed auto-recharge notice.
    if (granted) await tx.update(workspaces).set({ billingNotice: null }).where(eq(workspaces.id, workspaceId));
  });
  return { kind: "topup", workspaceId, status: "fulfilled", credits: pack.credits };
}

async function saveCardFromSetup(session: Stripe.Checkout.Session, workspaceId: string) {
  const setupIntentId = id(session.setup_intent);
  const customer = id(session.customer);
  if (!setupIntentId || !customer) return;
  const setupIntent = await stripe().setupIntents.retrieve(setupIntentId);
  const paymentMethod = id(setupIntent.payment_method);
  if (!paymentMethod) return;
  await stripe().customers.update(customer, { invoice_settings: { default_payment_method: paymentMethod } });

  const pack = packById(session.metadata?.packId);
  const threshold = Number(session.metadata?.thresholdCredits);
  if (!pack || !Number.isInteger(threshold) || threshold <= 0) return;
  await db()
    .update(workspaces)
    .set({ autoRecharge: { enabled: true, thresholdCredits: threshold, packId: pack.id }, billingNotice: null })
    .where(eq(workspaces.id, workspaceId));
  // Already under the threshold? Top up now rather than after the next charge.
  await maybeStartAutoRecharge(workspaceId);
}
