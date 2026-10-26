import "server-only";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, type Tx } from "@/lib/db";
import { type AutoRechargeSettings, wallets, workspaces } from "@/lib/db/schema";
import { alertWorkspace } from "@/lib/email/alerts";
import { emailOrigin } from "@/lib/email/send";
import { rechargeDeclinedEmail } from "@/lib/email/templates";
import { CURRENCY, packById } from "@/lib/pricing";
import { automaticTax, isCardError, needsTaxAddress, stripe } from "./stripe";
import { grantCredits } from "./wallet";

// Auto-recharge: when a charge leaves the balance under the workspace's
// threshold, buy its chosen pack with the saved card. Off-session charges go
// through an invoice so Stripe Tax and receipts work like Checkout. A claim
// on the workspace (auto_recharge_pending_at) means only one recharge runs at
// a time; its timestamp keys every Stripe call, so retries never charge twice.
// A declined card turns auto-recharge off and leaves a notice in the app.

/** A claim older than this is assumed dead (the workflow never started) and can be taken over. */
const STALE_CLAIM_MS = 15 * 60_000;

export type RechargeOutcome = "recharged" | "failed" | "skipped";

export const DEFAULT_AUTO_RECHARGE: AutoRechargeSettings = { enabled: false, thresholdCredits: 100, packId: "pack_20" };

/**
 * Claims a recharge if one is due: auto-recharge on, a customer on file, the
 * balance under the threshold, and no recharge already running. Returns the
 * claim's timestamp, or null.
 */
export async function claimAutoRecharge(workspaceId: string, now = new Date()): Promise<string | null> {
  const [claimed] = await db()
    .update(workspaces)
    .set({ autoRechargePendingAt: now })
    .from(wallets)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(wallets.workspaceId, workspaces.id),
        isNotNull(workspaces.stripeCustomerId),
        sql`(${workspaces.autoRecharge}->>'enabled')::boolean`,
        sql`${wallets.balance} < (${workspaces.autoRecharge}->>'thresholdCredits')::int`,
        or(
          isNull(workspaces.autoRechargePendingAt),
          lt(workspaces.autoRechargePendingAt, new Date(now.getTime() - STALE_CLAIM_MS)),
        ),
      ),
    )
    .returning({ pendingAt: workspaces.autoRechargePendingAt });
  return claimed?.pendingAt?.toISOString() ?? null;
}

/** Starts a recharge in the background if one is due. Never throws; billing must not break a generation. */
export async function maybeStartAutoRecharge(workspaceId: string): Promise<boolean> {
  try {
    const attemptAt = await claimAutoRecharge(workspaceId);
    if (!attemptAt) return false;
    try {
      const [{ start }, { autoRecharge }] = await Promise.all([import("workflow/api"), import("@/workflows/billing")]);
      await start(autoRecharge, [workspaceId, attemptAt]);
      return true;
    } catch (error) {
      await releaseClaim(workspaceId, attemptAt);
      throw error;
    }
  } catch (error) {
    console.error(`Could not start auto-recharge for ${workspaceId}`, error);
    return false;
  }
}

const claimIs = (workspaceId: string, attemptAt: string) =>
  and(eq(workspaces.id, workspaceId), eq(workspaces.autoRechargePendingAt, new Date(attemptAt)));

async function releaseClaim(workspaceId: string, attemptAt: string) {
  await db().update(workspaces).set({ autoRechargePendingAt: null }).where(claimIs(workspaceId, attemptAt));
}

/** Charges the saved card for the workspace's pack. Runs as a workflow step; idempotent per claim. */
export async function runAutoRecharge(workspaceId: string, attemptAt: string): Promise<RechargeOutcome> {
  const [workspace] = await db()
    .select({
      settings: workspaces.autoRecharge,
      customerId: workspaces.stripeCustomerId,
      pendingAt: workspaces.autoRechargePendingAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace || workspace.pendingAt?.toISOString() !== attemptAt) return "skipped";
  const pack = packById(workspace.settings?.packId);
  if (!workspace.settings?.enabled || !pack || !workspace.customerId) {
    await releaseClaim(workspaceId, attemptAt);
    return "skipped";
  }
  const customer = workspace.customerId;

  const card = await stripe().customers.retrieve(customer, { expand: ["tax"] });
  if (card.deleted || !card.invoice_settings?.default_payment_method) {
    await failRecharge(workspaceId, attemptAt, "There's no saved card to charge.");
    return "failed";
  }
  // Without an address Stripe can't finalize a taxed invoice, and retrying won't change that.
  // Turning auto-recharge back on goes through Checkout, which asks for the address.
  if (needsTaxAddress(card)) {
    await failRecharge(
      workspaceId,
      attemptAt,
      "We need your billing address to add sales tax. Turn it back on to add it.",
    );
    return "failed";
  }

  const key = `recharge:${workspaceId}:${attemptAt}`;
  let invoice: Stripe.Invoice | null = null;
  try {
    invoice = await stripe().invoices.create(
      {
        customer,
        currency: CURRENCY,
        collection_method: "charge_automatically",
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        automatic_tax: automaticTax(),
        description: "Threaded auto-recharge",
        metadata: { kind: "auto_recharge", workspaceId, packId: pack.id },
      },
      { idempotencyKey: `${key}:invoice` },
    );
    await stripe().invoiceItems.create(
      {
        customer,
        invoice: invoice.id,
        amount: pack.usd * 100,
        currency: CURRENCY,
        tax_behavior: "exclusive",
        description: `${pack.credits.toLocaleString("en-US")} Threaded credits`,
      },
      { idempotencyKey: `${key}:item` },
    );
    await stripe().invoices.finalizeInvoice(invoice.id, { auto_advance: false }, { idempotencyKey: `${key}:finalize` });
    invoice = await stripe().invoices.pay(invoice.id, { off_session: true }, { idempotencyKey: `${key}:pay` });
  } catch (error) {
    // Outages and bugs propagate so the workflow retries; only the customer's card ends the attempt.
    if (!isCardError(error)) throw error;
    if (invoice)
      await stripe()
        .invoices.voidInvoice(invoice.id)
        .catch(() => {});
    await failRecharge(workspaceId, attemptAt, error.message);
    return "failed";
  }

  if (invoice.status !== "paid") {
    await stripe()
      .invoices.voidInvoice(invoice.id)
      .catch(() => {});
    await failRecharge(workspaceId, attemptAt, "Your bank needs you to confirm the payment.");
    return "failed";
  }
  await db().transaction(async (tx) => {
    await grantRecharge(invoice, workspaceId, tx);
    await tx
      .update(workspaces)
      .set({ autoRechargePendingAt: null, billingNotice: null })
      .where(claimIs(workspaceId, attemptAt));
  });
  return "recharged";
}

async function grantRecharge(invoice: Stripe.Invoice, workspaceId: string, tx?: Tx) {
  const pack = packById(invoice.metadata?.packId);
  if (!pack) return false;
  return grantCredits({ workspaceId, amount: pack.credits, kind: "purchase", ref: invoice.id }, tx);
}

/** invoice.paid webhook: credits a recharge whose run didn't get to (e.g. it crashed after paying). */
export async function fulfillRechargeInvoice(invoiceId: string): Promise<boolean> {
  const invoice = await stripe().invoices.retrieve(invoiceId);
  const workspaceId = invoice.metadata?.workspaceId;
  if (invoice.metadata?.kind !== "auto_recharge" || !workspaceId || invoice.status !== "paid") return false;
  return grantRecharge(invoice, workspaceId);
}

async function failRecharge(workspaceId: string, attemptAt: string, reason: string) {
  const message = `Auto-recharge couldn't charge your card, so it's off for now. ${reason}`.trim();
  const updated = await db()
    .update(workspaces)
    .set({
      autoRecharge: sql`jsonb_set(${workspaces.autoRecharge}, '{enabled}', 'false')`,
      autoRechargePendingAt: null,
      billingNotice: { kind: "auto_recharge_failed", message, at: new Date().toISOString() },
    })
    .where(claimIs(workspaceId, attemptAt))
    .returning({ id: workspaces.id });
  if (updated.length > 0) {
    await alertWorkspace(workspaceId, "recharge_declined", attemptAt, () =>
      rechargeDeclinedEmail({ message, url: `${emailOrigin()}/settings/billing` }),
    );
  }
}
