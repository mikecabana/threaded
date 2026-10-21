import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { env, requireEnv } from "@/lib/env";

// Stripe takes the money; our ledger decides what a workspace can spend
// (docs/PLAN.md §6). Every Stripe object we create carries the workspace id in
// its metadata, and fulfillment always re-reads the object from Stripe rather
// than trusting a webhook payload.

let client: Stripe | undefined;

/** Payments need both the API key and the webhook secret. */
export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export function stripe(): Stripe {
  if (!client) {
    const api = env.STRIPE_API_URL ? new URL(env.STRIPE_API_URL) : null;
    client = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      maxNetworkRetries: 2,
      appInfo: { name: "Threaded" },
      ...(api && {
        host: api.hostname,
        port: api.port,
        protocol: api.protocol === "http:" ? "http" : "https",
      }),
    });
  }
  return client;
}

export const automaticTax = () => ({ enabled: env.STRIPE_AUTOMATIC_TAX === "1" });

/** The workspace's Stripe customer, created on first use. Safe to call concurrently. */
export async function ensureCustomer(workspaceId: string): Promise<string> {
  const [workspace] = await db()
    .select({ name: workspaces.name, customerId: workspaces.stripeCustomerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace) throw new Error(`No workspace ${workspaceId}.`);
  if (workspace.customerId) return workspace.customerId;

  // The idempotency key makes concurrent first purchases get the same customer.
  const customer = await stripe().customers.create(
    { name: workspace.name, metadata: { workspaceId } },
    { idempotencyKey: `customer:${workspaceId}` },
  );
  const [saved] = await db()
    .update(workspaces)
    .set({ stripeCustomerId: customer.id })
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.stripeCustomerId)))
    .returning({ customerId: workspaces.stripeCustomerId });
  if (saved?.customerId) return saved.customerId;
  const [existing] = await db()
    .select({ customerId: workspaces.stripeCustomerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return existing?.customerId ?? customer.id;
}

export interface SavedCard {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** The card auto-recharge charges: the customer's default for invoices. */
export async function savedCard(customerId: string | null): Promise<SavedCard | null> {
  if (!customerId) return null;
  const customer = await stripe().customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (customer.deleted) return null;
  const method = customer.invoice_settings?.default_payment_method;
  if (!method || typeof method === "string" || !method.card) return null;
  return {
    brand: method.card.brand,
    last4: method.card.last4,
    expMonth: method.card.exp_month,
    expYear: method.card.exp_year,
  };
}

/** Stripe's hosted portal for invoices, cards and the BYOK plan. */
export async function portalUrl(workspaceId: string, returnUrl: string): Promise<string> {
  const customer = await ensureCustomer(workspaceId);
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: returnUrl });
  return session.url;
}

/** Card declines and other payment failures the customer has to fix (as opposed to outages). */
export function isCardError(error: unknown): error is Stripe.errors.StripeCardError {
  return error instanceof Stripe.errors.StripeCardError;
}
