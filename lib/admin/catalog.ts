import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AI_TASKS, type AiTask, seedCatalog } from "@/lib/ai/catalog";
import { db } from "@/lib/db";
import { modelCatalog } from "@/lib/db/schema";
import { DEFAULT_MARKUP } from "@/lib/pricing";

// Editing the model catalog from /admin: switch models on and off, set their
// markup and minimum charge, which tasks they're offered for, and each task's
// default. New models start switched off, so they can be evaluated first
// (`pnpm eval --model …`). Prices come from the Gateway's nightly sync.

export type CatalogRow = typeof modelCatalog.$inferSelect;

export async function listCatalog(): Promise<CatalogRow[]> {
  const rows = await db().select().from(modelCatalog).orderBy(asc(modelCatalog.modelId));
  if (rows.length > 0) return rows;
  await seedCatalog();
  return db().select().from(modelCatalog).orderBy(asc(modelCatalog.modelId));
}

const tasks = z.array(z.enum(AI_TASKS)).min(1);

export const modelUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60),
  tier: z.enum(["fast", "balanced", "best"]),
  tasks,
  /** At least 1: below cost, credits would lose money on every call. */
  markup: z.coerce.number().min(1).max(10),
  minCredits: z.coerce.number().int().min(0).max(100),
  enabled: z.boolean(),
});

export const newModelSchema = z.object({
  modelId: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+\/[a-z0-9._-]+$/i, "A Gateway model id, like provider/model-name"),
  label: z.string().trim().min(1).max(60),
  provider: z.string().trim().min(1).max(40),
  tier: z.enum(["fast", "balanced", "best"]),
  tasks,
});

export type ModelUpdate = z.infer<typeof modelUpdateSchema>;

/**
 * Applies an edit. A model can't be the default for a task it's no longer
 * offered for, or be switched off while it's a default (pick another first).
 */
export async function updateModel(
  modelId: string,
  update: ModelUpdate,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const [row] = await db().select().from(modelCatalog).where(eq(modelCatalog.modelId, modelId));
  if (!row) return { ok: false, message: "That model isn't in the catalog." };
  const defaults = row.defaultFor as AiTask[];
  if (!update.enabled && defaults.length > 0) {
    return { ok: false, message: `It's the default for ${defaults.join(", ")}. Make another model the default first.` };
  }
  const dropped = defaults.filter((task) => !update.tasks.includes(task));
  if (dropped.length > 0) {
    return { ok: false, message: `It's the default for ${dropped.join(", ")}, so it has to stay offered for it.` };
  }
  await db()
    .update(modelCatalog)
    .set({
      label: update.label,
      tier: update.tier,
      tasks: update.tasks,
      markup: update.markup.toFixed(2),
      minCredits: update.minCredits,
      enabled: update.enabled,
    })
    .where(eq(modelCatalog.modelId, modelId));
  return { ok: true };
}

/** Makes a model the default for a task (and no other model). */
export async function setDefaultModel(
  task: AiTask,
  modelId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(modelCatalog).where(eq(modelCatalog.modelId, modelId)).for("update");
    if (!row) return { ok: false as const, message: "That model isn't in the catalog." };
    if (!row.enabled || !row.available) return { ok: false as const, message: "Switch the model on first." };
    if (!row.tasks.includes(task)) return { ok: false as const, message: `Offer it for ${task} first.` };
    await tx
      .update(modelCatalog)
      .set({ defaultFor: sql`array_remove(${modelCatalog.defaultFor}, ${task})` })
      .where(sql`${task} = any(${modelCatalog.defaultFor})`);
    await tx
      .update(modelCatalog)
      .set({ defaultFor: sql`array_append(${modelCatalog.defaultFor}, ${task})` })
      .where(eq(modelCatalog.modelId, modelId));
    return { ok: true as const };
  });
}

/** Adds a model, switched off until it's been evaluated. */
export async function addModel(
  input: z.infer<typeof newModelSchema>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const added = await db()
    .insert(modelCatalog)
    .values({
      modelId: input.modelId,
      label: input.label,
      provider: input.provider,
      tier: input.tier,
      tasks: input.tasks,
      defaultFor: [],
      markup: DEFAULT_MARKUP.toFixed(2),
      minCredits: 1,
      enabled: false,
    })
    .onConflictDoNothing()
    .returning({ id: modelCatalog.modelId });
  return added.length > 0 ? { ok: true } : { ok: false, message: "That model is already in the catalog." };
}
