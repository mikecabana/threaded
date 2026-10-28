"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { maybeStartAutoRecharge } from "@/lib/billing/auto-recharge";
import { checkGatewayKey, storeByokKey, switchToCredits } from "@/lib/billing/byok";
import {
  createByokCheckout,
  createCardCheckout,
  createMonthlyCheckout,
  createTopUpCheckout,
} from "@/lib/billing/checkout";
import { isStripeConfigured, portalUrl, readyForAutoRecharge, stripeLocales } from "@/lib/billing/stripe";
import { runningPlan, setPlanCancellation } from "@/lib/billing/subscription";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { packById, RECHARGE_THRESHOLDS } from "@/lib/pricing";
import { type AccountIdentity, getAccountIdentity } from "@/lib/session/identity";

export type BillingFormState = { ok: boolean; message: string } | null;

const NOT_SET_UP = "Payments aren't set up on this deployment yet.";

/** Where to send Stripe's customers back to: this deployment's own origin. */
async function appOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

/** The language for a new Stripe customer's receipts, from the browser's. */
async function customerLocales(): Promise<string[] | undefined> {
  return stripeLocales((await headers()).get("accept-language"));
}

async function requireAccount(): Promise<AccountIdentity> {
  const identity = await getAccountIdentity();
  if (!identity) redirect("/");
  return identity;
}

function refresh() {
  revalidatePath("/settings/billing");
  revalidatePath("/", "layout");
}

/** Buy a credit pack with Stripe Checkout. */
export async function buyCreditsAction(formData: FormData): Promise<void> {
  const identity = await requireAccount();
  const pack = packById(String(formData.get("packId")));
  if (!pack) return;
  if (!isStripeConfigured()) redirect("/settings/billing?checkout=unavailable");
  redirect(
    await createTopUpCheckout({
      workspaceId: identity.workspaceId,
      pack,
      origin: await appOrigin(),
      locales: await customerLocales(),
    }),
  );
}

const autoRechargeSchema = z.object({
  enabled: z.literal("on").optional(),
  thresholdCredits: z.coerce.number().refine((n) => (RECHARGE_THRESHOLDS as readonly number[]).includes(n)),
  packId: z.string().refine((id) => Boolean(packById(id))),
});

/**
 * Saves auto-recharge settings. Turning it on without a saved card (or, with
 * Stripe Tax on, without an address) goes through Checkout to save one first;
 * it switches on when that completes.
 */
export async function saveAutoRechargeAction(_: BillingFormState, formData: FormData): Promise<BillingFormState> {
  const identity = await requireAccount();
  const parsed = autoRechargeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Pick a threshold and a pack." };
  const settings = {
    enabled: parsed.data.enabled === "on",
    thresholdCredits: parsed.data.thresholdCredits,
    packId: parsed.data.packId,
  };

  if (settings.enabled) {
    if (!isStripeConfigured()) return { ok: false, message: NOT_SET_UP };
    const [workspace] = await db()
      .select({ customerId: workspaces.stripeCustomerId })
      .from(workspaces)
      .where(eq(workspaces.id, identity.workspaceId));
    if (!(await readyForAutoRecharge(workspace?.customerId ?? null))) {
      redirect(
        await createCardCheckout({
          workspaceId: identity.workspaceId,
          settings: { thresholdCredits: settings.thresholdCredits, packId: settings.packId },
          origin: await appOrigin(),
          locales: await customerLocales(),
        }),
      );
    }
  }

  await db()
    .update(workspaces)
    .set({ autoRecharge: settings, ...(settings.enabled && { billingNotice: null }) })
    .where(eq(workspaces.id, identity.workspaceId));
  // Already under the new threshold? Top up now rather than after the next charge.
  const recharging = settings.enabled && (await maybeStartAutoRecharge(identity.workspaceId));
  refresh();
  return {
    ok: true,
    message: !settings.enabled
      ? "Auto-recharge is off."
      : recharging
        ? "Saved. Your balance is under the threshold, so a top-up is on its way."
        : "Saved. Auto-recharge is on.",
  };
}

/** Saves a Vercel AI Gateway key after checking it, then starts (or resumes) the plan if needed. */
export async function saveKeyAction(_: BillingFormState, formData: FormData): Promise<BillingFormState> {
  const identity = await requireAccount();
  const key = String(formData.get("key") ?? "").trim();
  if (!/^\S{16,256}$/.test(key)) return { ok: false, message: "Paste the whole key. It has no spaces." };

  const check = await checkGatewayKey(key);
  if (!check.ok) {
    return {
      ok: false,
      message:
        check.reason === "invalid"
          ? "The AI Gateway didn't accept that key. Check it and try again."
          : "Couldn't reach the AI Gateway to check the key. Try again in a minute.",
    };
  }
  const result = await storeByokKey(identity.workspaceId, key);
  if (result === "monthly_plan") {
    return {
      ok: false,
      message: "You're on the Monthly plan. Cancel it first; it runs to the end of the period, and your credits stay.",
    };
  }
  if (result === "needs_plan") {
    if (!isStripeConfigured()) return { ok: false, message: NOT_SET_UP };
    redirect(
      await createByokCheckout({
        workspaceId: identity.workspaceId,
        origin: await appOrigin(),
        locales: await customerLocales(),
      }),
    );
  }
  refresh();
  return {
    ok: true,
    message:
      check.balanceUsd > 0
        ? `Threaded now runs on your key. Your Gateway balance is $${check.balanceUsd.toFixed(2)}.`
        : "Threaded now runs on your key, but its Gateway balance is $0. Add funds in Vercel first.",
  };
}

/** Continues to the plan's Checkout for a key that's saved but not yet in use. */
export async function startPlanAction(): Promise<void> {
  const identity = await requireAccount();
  if (!isStripeConfigured()) redirect("/settings/billing?checkout=unavailable");
  if ((await runningPlan(identity.workspaceId))?.kind === "monthly")
    redirect("/settings/billing?checkout=plan_conflict");
  redirect(
    await createByokCheckout({
      workspaceId: identity.workspaceId,
      origin: await appOrigin(),
      locales: await customerLocales(),
    }),
  );
}

/** The Monthly plan's Checkout. One plan at a time: a running own-key plan has to be cancelled first. */
export async function startMonthlyPlanAction(): Promise<void> {
  const identity = await requireAccount();
  if (!isStripeConfigured()) redirect("/settings/billing?checkout=unavailable");
  const running = await runningPlan(identity.workspaceId);
  if (running?.kind === "own_key") redirect("/settings/billing?checkout=plan_conflict");
  if (running) redirect("/settings/billing");
  redirect(
    await createMonthlyCheckout({
      workspaceId: identity.workspaceId,
      origin: await appOrigin(),
      locales: await customerLocales(),
    }),
  );
}

/** Ends the Monthly plan with its current period ("end"), or keeps it after all ("keep"). */
export async function setMonthlyPlanEndingAction(formData: FormData): Promise<void> {
  const identity = await requireAccount();
  const [workspace] = await db()
    .select({ subscriptionId: workspaces.stripeSubscriptionId, kind: workspaces.planKind })
    .from(workspaces)
    .where(eq(workspaces.id, identity.workspaceId));
  if (!workspace?.subscriptionId || workspace.kind !== "monthly" || !isStripeConfigured()) return;
  await setPlanCancellation(workspace.subscriptionId, formData.get("ending") === "end");
  refresh();
}

/** Back to credits: deletes the key; a live plan ends with its current period. */
export async function switchToCreditsAction(): Promise<void> {
  const identity = await requireAccount();
  await switchToCredits(identity.workspaceId);
  refresh();
}

/** Stripe's billing portal: invoices, cards and the plan. */
export async function openPortalAction(): Promise<void> {
  const identity = await requireAccount();
  if (!isStripeConfigured()) redirect("/settings/billing?checkout=unavailable");
  redirect(await portalUrl(identity.workspaceId, `${await appOrigin()}/settings/billing`, await customerLocales()));
}

export async function dismissBillingNoticeAction(): Promise<void> {
  const identity = await requireAccount();
  await db().update(workspaces).set({ billingNotice: null }).where(eq(workspaces.id, identity.workspaceId));
  refresh();
}
