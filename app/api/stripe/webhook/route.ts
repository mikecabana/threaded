import type Stripe from "stripe";
import { isStripeConfigured, stripe } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/webhook";
import { requireEnv } from "@/lib/env";

/** Stripe webhooks. Verified against STRIPE_WEBHOOK_SECRET; a 500 makes Stripe retry. */
export async function POST(request: Request) {
  if (!isStripeConfigured()) return Response.json({ error: "stripe_not_configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing_signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(
      await request.text(),
      signature,
      requireEnv("STRIPE_WEBHOOK_SECRET"),
    );
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (error) {
    console.error(`Stripe event ${event.id} (${event.type}) failed`, error);
    return Response.json({ error: "handler_failed" }, { status: 500 });
  }
}
