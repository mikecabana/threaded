"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/access";
import {
  addGatewayModel,
  addModel,
  gatewayPickSchema,
  modelUpdateSchema,
  newModelSchema,
  setDefaultModel,
  updateModel,
} from "@/lib/admin/catalog";
import { adjustCredits, MAX_ADJUSTMENT } from "@/lib/admin/credits";
import { fetchGatewayModels } from "@/lib/admin/gateway-models";
import { AI_TASKS, type AiTask, syncCatalogFromGateway } from "@/lib/ai/catalog";
import { gatewayReachable, platformGateway } from "@/lib/ai/models";

// /admin's actions. Each one checks the caller is staff again: an action is
// a public endpoint, whatever page it's rendered on.

export type AdminFormState = { ok: boolean; message: string } | null;

const ADJUSTMENT_MESSAGES = {
  zero: "Enter a number of credits, positive to add or negative to take back.",
  too_large: `At most ${MAX_ADJUSTMENT.toLocaleString("en-US")} credits at a time.`,
  no_reason: "Say why, so the ledger explains itself.",
  not_found: "That workspace has no wallet.",
  insufficient: "That's more than the workspace has left to spend.",
  duplicate: "That adjustment was already applied.",
} as const;

export async function adjustCreditsAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const staff = await requireStaff();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const result = await adjustCredits({
    workspaceId,
    amount: Number(formData.get("amount")),
    reason: String(formData.get("reason") ?? ""),
    actorUserId: staff.userId,
    token: String(formData.get("token") ?? ""),
  });
  if (!result.ok) return { ok: false, message: ADJUSTMENT_MESSAGES[result.problem] };
  revalidatePath("/admin/workspace");
  return { ok: true, message: `Done. The balance is now ${result.balance.toLocaleString("en-US")} credits.` };
}

const tasksFrom = (formData: FormData) => formData.getAll("tasks").map(String);

export async function updateModelAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireStaff();
  const parsed = modelUpdateSchema.safeParse({
    label: formData.get("label"),
    tier: formData.get("tier"),
    tasks: tasksFrom(formData),
    markup: formData.get("markup"),
    minCredits: formData.get("minCredits"),
    enabled: formData.get("enabled") === "on",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const result = await updateModel(String(formData.get("modelId")), parsed.data);
  if (!result.ok) return result;
  revalidatePath("/admin/catalog");
  return { ok: true, message: "Saved." };
}

export async function setDefaultModelAction(formData: FormData): Promise<void> {
  await requireStaff();
  const task = String(formData.get("task")) as AiTask;
  if (!AI_TASKS.includes(task)) return;
  await setDefaultModel(task, String(formData.get("modelId")));
  revalidatePath("/admin/catalog");
}

export async function addModelAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireStaff();
  const parsed = newModelSchema.safeParse({
    modelId: formData.get("modelId"),
    label: formData.get("label"),
    provider: formData.get("provider"),
    tier: formData.get("tier"),
    tasks: tasksFrom(formData),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const result = await addModel(parsed.data);
  if (!result.ok) return result;
  revalidatePath("/admin/catalog");
  return { ok: true, message: `Added ${parsed.data.modelId}, switched off. Evaluate it, then switch it on.` };
}

/** Adds a model picked from the Gateway's list, checked against the list as it is now. */
export async function addGatewayModelAction(_state: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireStaff();
  const parsed = gatewayPickSchema.safeParse({
    modelId: formData.get("modelId"),
    tier: formData.get("tier"),
    tasks: tasksFrom(formData),
    enabled: formData.get("enabled") === "on",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the fields." };
  const listing = await fetchGatewayModels();
  if (!listing.ok) return listing;
  const result = await addGatewayModel(parsed.data, listing.models);
  if (!result.ok) return result;
  revalidatePath("/admin/catalog");
  revalidatePath("/admin/models");
  return {
    ok: true,
    message: parsed.data.enabled
      ? `Added ${result.label}, switched on.`
      : `Added ${result.label}, switched off. Evaluate it, then switch it on in the catalog.`,
  };
}

/** Refreshes prices (and availability) from the Gateway now, rather than at the nightly sync. */
export async function syncPricesAction(): Promise<AdminFormState> {
  await requireStaff();
  if (!gatewayReachable()) return { ok: false, message: "The AI Gateway isn't reachable from here." };
  try {
    const { updated, disabled } = await syncCatalogFromGateway(() => platformGateway().getAvailableModels());
    revalidatePath("/admin/catalog");
    return { ok: true, message: `Prices updated for ${updated} models; ${disabled} not offered by the Gateway.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
