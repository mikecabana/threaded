import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threadsProfiles, workspaces } from "@/lib/db/schema";
import { alertWorkspace } from "@/lib/email/alerts";
import { emailOrigin } from "@/lib/email/send";
import { planLapsedEmail } from "@/lib/email/templates";
import { MONTHLY_PLAN } from "@/lib/pricing";
import { isStripeConfigured, stripe } from "./stripe";
import { grantCredits } from "./wallet";

// A workspace's plan, mirrored from Stripe: one at a time, either
// - the own-key plan ($5/month): the workspace runs on its own key only while
//   the plan is live and a key is saved; when the plan ends for good, the key
//   is deleted and the workspace falls back to credits; or
// - the Monthly plan: its credits are added each time an invoice is paid, and
//   stay (like all credits) when the plan ends.

export type PlanKind = "own_key" | "monthly";

/** The ledger note on the Monthly plan's credits, so the activity list can name them. */
export const MONTHLY_PLAN_NOTE = "monthly_plan";

/** Every subscription carries `kind` in its metadata; anything but "monthly" is the own-key plan. */
export const planKindOf = (metadata: Record<string, string> | null | undefined): PlanKind =>
  metadata?.kind === "monthly" ? "monthly" : "own_key";

const LIVE = new Set(["active", "trialing", "past_due"]);
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

export const isLivePlan = (status: string | null | undefined) => Boolean(status && LIVE.has(status));

/**
 * The plan that's running and not set to end, if any. Only one plan runs at a
 * time: starting the other one waits until this one is cancelled.
 */
export async function runningPlan(workspaceId: string): Promise<{ kind: PlanKind; subscriptionId: string } | null> {
  const [workspace] = await db()
    .select({
      kind: workspaces.planKind,
      subscriptionId: workspaces.stripeSubscriptionId,
      status: workspaces.subscriptionStatus,
      cancelling: workspaces.subscriptionCancelAtPeriodEnd,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace?.subscriptionId || !isLivePlan(workspace.status) || workspace.cancelling) return null;
  return { kind: workspace.kind ?? "own_key", subscriptionId: workspace.subscriptionId };
}

/** Re-reads a subscription from Stripe and applies it to its workspace. Safe to repeat and to reorder. */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const workspaceId = subscription.metadata?.workspaceId;
  if (!workspaceId) return;
  const kind = planKindOf(subscription.metadata);
  const live = LIVE.has(subscription.status);
  const ended = ENDED.has(subscription.status);
  const cancelling = subscription.cancel_at_period_end || subscription.cancel_at !== null;
  const periodEnd = Math.max(0, ...subscription.items.data.map((item) => item.current_period_end));

  const lapsed = await db().transaction(async (tx) => {
    const [workspace] = await tx
      .select({
        subscriptionId: workspaces.stripeSubscriptionId,
        billingMode: workspaces.billingMode,
        hasKey: workspaces.byokKeyEnc,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    if (!workspace) return false;
    // A plan that's winding down (or over) never replaces another: switching
    // plans starts a new subscription while the old one runs out.
    if (workspace.subscriptionId && workspace.subscriptionId !== subscription.id && (!live || cancelling)) return false;

    const ownKey = kind === "own_key";
    const byok = ownKey && live && workspace.hasKey !== null;
    await tx
      .update(workspaces)
      .set({
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        subscriptionPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        subscriptionCancelAtPeriodEnd: cancelling,
        planKind: kind,
        billingMode: byok ? "byok" : "credits",
        // Without the plan the key has no use, so it isn't kept.
        ...(ended && ownKey && { byokKeyEnc: null, byokKeyLast4: null }),
        ...(ended &&
          ownKey &&
          workspace.billingMode === "byok" && {
            billingNotice: {
              kind: "byok_ended" as const,
              message: "Your own-key plan ended, so Threaded is back on credits.",
              at: new Date().toISOString(),
            },
          }),
      })
      .where(eq(workspaces.id, workspaceId));
    return ended && ownKey && workspace.billingMode === "byok";
  });
  if (lapsed) {
    await alertWorkspace(workspaceId, "plan_lapsed", subscription.id, () =>
      planLapsedEmail({ url: `${emailOrigin()}/settings/billing` }),
    );
  }
}

/**
 * Ends a deleted account's plan now: there's nothing left to bill for.
 * Best effort; a failure is logged and left for Stripe's own dunning.
 */
export async function endPlanForDeletedAccount(threadsUserId: string): Promise<void> {
  const [workspace] = await db()
    .select({ subscriptionId: workspaces.stripeSubscriptionId, status: workspaces.subscriptionStatus })
    .from(threadsProfiles)
    .innerJoin(workspaces, eq(workspaces.id, threadsProfiles.workspaceId))
    .where(eq(threadsProfiles.id, threadsUserId));
  if (!workspace?.subscriptionId || !isLivePlan(workspace.status) || !isStripeConfigured()) return;
  try {
    await stripe().subscriptions.cancel(workspace.subscriptionId);
    await syncSubscription(workspace.subscriptionId);
  } catch (error) {
    console.error(`Could not end the plan for a deleted account (${workspace.subscriptionId})`, error);
  }
}

/**
 * invoice.paid (and the Checkout return): adds the Monthly plan's credits for
 * a paid invoice, once per invoice. Only the plan's own invoices count, at its
 * price, for its start or a renewal.
 */
export async function fulfillPlanInvoice(invoiceId: string): Promise<boolean> {
  const invoice = await stripe().invoices.retrieve(invoiceId);
  const details = invoice.parent?.subscription_details;
  const workspaceId = details?.metadata?.workspaceId;
  if (planKindOf(details?.metadata) !== "monthly" || !workspaceId || invoice.status !== "paid") return false;
  if (invoice.billing_reason !== "subscription_create" && invoice.billing_reason !== "subscription_cycle") return false;
  if (invoice.subtotal !== MONTHLY_PLAN.usd * 100) {
    console.error(`Invoice ${invoice.id}: ${invoice.subtotal}¢ for the Monthly plan; not crediting.`);
    return false;
  }
  return grantCredits({
    workspaceId,
    amount: MONTHLY_PLAN.credits,
    kind: "purchase",
    ref: invoice.id as string,
    note: MONTHLY_PLAN_NOTE,
  });
}

/** Ends the plan when the current period runs out (or keeps it, if `cancel` is false). */
export async function setPlanCancellation(subscriptionId: string, cancel: boolean): Promise<void> {
  await stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  await syncSubscription(subscriptionId);
}
