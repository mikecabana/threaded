import { type NextRequest, NextResponse } from "next/server";
import { fulfillCheckout } from "@/lib/billing/checkout";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { getAccountIdentity } from "@/lib/session/identity";

/**
 * Where Stripe Checkout sends customers back. Fulfills the session right away
 * (the webhook may still be on its way), then shows the billing page with the
 * outcome. Fulfillment is idempotent, so the webhook arriving later is harmless.
 */
export async function GET(request: NextRequest) {
  const identity = await getAccountIdentity();
  if (!identity) return NextResponse.redirect(new URL("/", request.url));
  const back = new URL("/settings/billing", request.url);
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId || !isStripeConfigured()) return NextResponse.redirect(back);

  try {
    const result = await fulfillCheckout(sessionId, identity.workspaceId);
    if (result.kind !== "ignored") {
      back.searchParams.set("checkout", result.kind);
      back.searchParams.set("status", result.status);
    }
  } catch (error) {
    console.error(`Fulfilling checkout ${sessionId} on return failed`, error);
    back.searchParams.set("checkout", "error");
  }
  return NextResponse.redirect(back, 303);
}
