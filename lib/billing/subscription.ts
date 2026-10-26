import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { threadsProfiles, workspaces } from "@/lib/db/schema";
import { alertWorkspace } from "@/lib/email/alerts";
import { emailOrigin } from "@/lib/email/send";
import { planLapsedEmail } from "@/lib/email/templates";
import { isStripeConfigured, stripe } from "./stripe";

// The BYOK plan ($5/month) mirrored from Stripe. A workspace runs on its own
// key only while the plan is live and a key is saved; when the plan ends for
// good, the key is deleted and the workspace falls back to credits.

const LIVE = new Set(["active", "trialing", "past_due"]);
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

export const isLivePlan = (status: string | null | undefined) => Boolean(status && LIVE.has(status));

/** Re-reads a subscription from Stripe and applies it to its workspace. Safe to repeat and to reorder. */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  const workspaceId = subscription.metadata?.workspaceId;
  if (!workspaceId) return;
  const live = LIVE.has(subscription.status);
  const ended = ENDED.has(subscription.status);
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
    // An old plan ending doesn't touch a newer one.
    if (workspace.subscriptionId && workspace.subscriptionId !== subscription.id && !live) return false;

    const byok = live && workspace.hasKey !== null;
    await tx
      .update(workspaces)
      .set({
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        subscriptionPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        subscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancel_at !== null,
        billingMode: byok ? "byok" : "credits",
        // Without the plan the key has no use, so it isn't kept.
        ...(ended && { byokKeyEnc: null, byokKeyLast4: null }),
        ...(ended &&
          workspace.billingMode === "byok" && {
            billingNotice: {
              kind: "byok_ended" as const,
              message: "Your own-key plan ended, so Threaded is back on credits.",
              at: new Date().toISOString(),
            },
          }),
      })
      .where(eq(workspaces.id, workspaceId));
    return ended && workspace.billingMode === "byok";
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

/** Ends the plan when the current period runs out (or keeps it, if `cancel` is false). */
export async function setPlanCancellation(subscriptionId: string, cancel: boolean): Promise<void> {
  await stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  await syncSubscription(subscriptionId);
}
