import { CircleCheck, Clock, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";

const MESSAGES: Record<string, { tone: "good" | "wait" | "bad"; text: string }> = {
  "topup:fulfilled": { tone: "good", text: "Payment received. Your credits are ready to use." },
  "topup:pending": { tone: "wait", text: "Payment is processing. Credits arrive as soon as it clears." },
  "byok:fulfilled": { tone: "good", text: "Your plan is active and Threaded now runs on your own key." },
  "byok:pending": { tone: "wait", text: "Your plan is being set up. It switches on in a moment." },
  "card:fulfilled": { tone: "good", text: "Card saved. Auto-recharge is on." },
  "monthly:fulfilled": {
    tone: "good",
    text: "You're on the Monthly plan, and this month's credits are in your balance.",
  },
  "monthly:pending": { tone: "wait", text: "Your plan is being set up. Its credits arrive in a moment." },
  plan_conflict: {
    tone: "bad",
    text: "One plan at a time. Switch back to credits from your own key, or cancel the Monthly plan, first.",
  },
  "card:pending": { tone: "wait", text: "Saving your card. Auto-recharge switches on in a moment." },
  canceled: { tone: "wait", text: "Checkout canceled. You weren't charged." },
  unavailable: { tone: "bad", text: "Payments aren't set up on this deployment yet." },
  error: { tone: "bad", text: "We couldn't confirm that checkout yet. If you paid, it shows up here shortly." },
};

/** The outcome of a trip to Stripe Checkout, from the query string /api/billing/return adds. */
export function CheckoutBanner({ checkout, status }: { checkout?: string; status?: string }) {
  const message = checkout ? (MESSAGES[`${checkout}:${status}`] ?? MESSAGES[checkout]) : undefined;
  if (!message) return null;
  const Icon = message.tone === "good" ? CircleCheck : message.tone === "wait" ? Clock : TriangleAlert;
  return (
    <Card
      role="status"
      className={
        message.tone === "good"
          ? "flex items-center gap-3 border-positive/30 bg-positive/5 p-4 text-sm"
          : message.tone === "bad"
            ? "flex items-center gap-3 border-negative/30 bg-negative/5 p-4 text-sm"
            : "flex items-center gap-3 p-4 text-sm"
      }
    >
      <Icon
        className={
          message.tone === "good"
            ? "size-4 shrink-0 text-positive"
            : message.tone === "bad"
              ? "size-4 shrink-0 text-negative"
              : "size-4 shrink-0 text-muted"
        }
        aria-hidden
      />
      {message.text}
    </Card>
  );
}
