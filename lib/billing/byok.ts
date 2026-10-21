import "server-only";
import { eq } from "drizzle-orm";
import { gatewayStatus } from "@/lib/ai/errors";
import { byokContext, gatewayWithKey } from "@/lib/ai/models";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { isLivePlan, setPlanCancellation } from "./subscription";

// Bring your own Vercel AI Gateway key (docs/PLAN.md §6). The key is checked
// against the Gateway, stored encrypted (bound to the workspace), and only
// ever shown as its last four characters.

export type KeyCheck = { ok: true; balanceUsd: number } | { ok: false; reason: "invalid" | "unreachable" };

/** Confirms the key works and reads the Gateway balance it pays from. */
export async function checkGatewayKey(apiKey: string): Promise<KeyCheck> {
  try {
    const { balance } = await gatewayWithKey(apiKey).getCredits();
    return { ok: true, balanceUsd: Number(balance) };
  } catch (error) {
    const status = gatewayStatus(error);
    return { ok: false, reason: status === 401 || status === 403 ? "invalid" : "unreachable" };
  }
}

/** The live Gateway balance behind the workspace's saved key, or null if it can't be read. */
export async function savedKeyBalance(workspaceId: string): Promise<number | null> {
  const [workspace] = await db()
    .select({ keyEnc: workspaces.byokKeyEnc })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace?.keyEnc) return null;
  const check = await checkGatewayKey(decryptSecret(workspace.keyEnc, byokContext(workspaceId)));
  return check.ok ? check.balanceUsd : null;
}

/**
 * Saves a checked key. If the plan is already live (or was set to end), the
 * workspace switches to the key right away; otherwise it needs the plan first.
 */
export async function storeByokKey(workspaceId: string, apiKey: string): Promise<"active" | "needs_plan"> {
  const [workspace] = await db()
    .update(workspaces)
    .set({ byokKeyEnc: encryptSecret(apiKey, byokContext(workspaceId)), byokKeyLast4: apiKey.slice(-4) })
    .where(eq(workspaces.id, workspaceId))
    .returning({ subscriptionId: workspaces.stripeSubscriptionId, status: workspaces.subscriptionStatus });
  if (!workspace?.subscriptionId || !isLivePlan(workspace.status)) return "needs_plan";
  await setPlanCancellation(workspace.subscriptionId, false);
  return "active";
}

/** Back to credits: the key is deleted and the plan ends with the current period. */
export async function switchToCredits(workspaceId: string): Promise<void> {
  const [workspace] = await db()
    .update(workspaces)
    .set({ billingMode: "credits", byokKeyEnc: null, byokKeyLast4: null })
    .where(eq(workspaces.id, workspaceId))
    .returning({ subscriptionId: workspaces.stripeSubscriptionId, status: workspaces.subscriptionStatus });
  if (workspace?.subscriptionId && isLivePlan(workspace.status)) {
    await setPlanCancellation(workspace.subscriptionId, true);
  }
}
