import "server-only";
import type Stripe from "stripe";
import { fulfillRechargeInvoice } from "./auto-recharge";
import { fulfillCheckout } from "./checkout";
import { syncSubscription } from "./subscription";

/**
 * Applies a verified Stripe event. Handlers re-read the object from Stripe and
 * are idempotent, so retried, duplicated or out-of-order events are harmless.
 * Configure the endpoint with exactly these events (docs/SETUP.md).
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<"handled" | "ignored"> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfillCheckout(event.data.object.id);
      return "handled";
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object.id);
      return "handled";
    case "invoice.paid":
      if (event.data.object.id) await fulfillRechargeInvoice(event.data.object.id);
      return "handled";
    default:
      return "ignored";
  }
}
