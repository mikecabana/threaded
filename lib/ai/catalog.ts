import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { modelCatalog } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { DEFAULT_MARKUP } from "@/lib/pricing";

// The curated list of models users can pick from, with our markup. Lives in
// the database so prices and availability can change without a deploy; the
// defaults below seed it (and stand in when there's no database, e.g. demo).

export const AI_TASKS = ["generate", "critique", "classify", "dna"] as const;
export type AiTask = (typeof AI_TASKS)[number];
export type ModelTier = "fast" | "balanced" | "best";

export interface CatalogEntry {
  modelId: string;
  label: string;
  provider: string;
  tier: ModelTier;
  tasks: AiTask[];
  defaultFor: AiTask[];
  markup: number;
  minCredits: number;
  /** USD per million tokens. */
  inputPrice: number;
  outputPrice: number;
  enabled: boolean;
}

/**
 * Seed catalog. Prices are conservative placeholders per tier; the daily sync
 * replaces them with the Gateway's live prices (and disables any model the
 * Gateway no longer offers). ⚠ Confirm ids against gateway.getAvailableModels().
 */
export const DEFAULT_CATALOG: CatalogEntry[] = [
  {
    modelId: "anthropic/claude-haiku-5.5",
    label: "Claude Haiku 5.5",
    provider: "Anthropic",
    tier: "fast",
    tasks: ["generate", "critique", "classify"],
    defaultFor: ["classify", "critique"],
    markup: DEFAULT_MARKUP,
    minCredits: 1,
    inputPrice: 1,
    outputPrice: 5,
    enabled: true,
  },
  {
    modelId: "anthropic/claude-sonnet-5.5",
    label: "Claude Sonnet 5.5",
    provider: "Anthropic",
    tier: "balanced",
    tasks: ["generate", "critique", "dna"],
    defaultFor: ["generate", "dna"],
    markup: DEFAULT_MARKUP,
    minCredits: 1,
    inputPrice: 3,
    outputPrice: 15,
    enabled: true,
  },
  {
    modelId: "anthropic/claude-opus-5.5",
    label: "Claude Opus 5.5",
    provider: "Anthropic",
    tier: "best",
    tasks: ["generate", "dna"],
    defaultFor: [],
    markup: DEFAULT_MARKUP,
    minCredits: 2,
    inputPrice: 5,
    outputPrice: 25,
    enabled: true,
  },
];

const TIER_ORDER: Record<ModelTier, number> = { fast: 0, balanced: 1, best: 2 };

function fromRow(row: typeof modelCatalog.$inferSelect): CatalogEntry {
  const seed = DEFAULT_CATALOG.find((m) => m.modelId === row.modelId);
  return {
    modelId: row.modelId,
    label: row.label,
    provider: row.provider,
    tier: row.tier,
    tasks: row.tasks as AiTask[],
    defaultFor: row.defaultFor as AiTask[],
    markup: Number(row.markup),
    minCredits: row.minCredits,
    inputPrice: row.inputPrice === null ? (seed?.inputPrice ?? 15) : Number(row.inputPrice),
    outputPrice: row.outputPrice === null ? (seed?.outputPrice ?? 75) : Number(row.outputPrice),
    enabled: row.enabled,
  };
}

/** Enabled models for a task, cheapest tier first. Seeds the table on first use. */
export async function catalogFor(task: AiTask): Promise<CatalogEntry[]> {
  let entries = DEFAULT_CATALOG;
  if (env.DATABASE_URL) {
    let rows = await db().select().from(modelCatalog).orderBy(asc(modelCatalog.modelId));
    if (rows.length === 0) {
      await seedCatalog();
      rows = await db().select().from(modelCatalog);
    }
    entries = rows.map(fromRow);
  }
  return entries
    .filter((m) => m.enabled && m.tasks.includes(task))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.label.localeCompare(b.label));
}

/** The user's pick if it's allowed for the task, else the task's default, else the first allowed. */
export function pickModel(entries: CatalogEntry[], task: AiTask, requested?: string | null): CatalogEntry {
  const chosen =
    entries.find((m) => m.modelId === requested) ?? entries.find((m) => m.defaultFor.includes(task)) ?? entries[0];
  if (!chosen) throw new Error(`No enabled model for ${task}.`);
  return chosen;
}

/** Other enabled models in the same tier, used as Gateway fallbacks so a fallback never costs much more. */
export function sameTierFallbacks(entries: CatalogEntry[], chosen: CatalogEntry): string[] {
  return entries.filter((m) => m.tier === chosen.tier && m.modelId !== chosen.modelId).map((m) => m.modelId);
}

async function seedCatalog(): Promise<void> {
  await db()
    .insert(modelCatalog)
    .values(
      DEFAULT_CATALOG.map((m) => ({
        modelId: m.modelId,
        label: m.label,
        provider: m.provider,
        tier: m.tier,
        tasks: m.tasks,
        defaultFor: m.defaultFor,
        markup: m.markup.toFixed(2),
        minCredits: m.minCredits,
        inputPrice: m.inputPrice.toFixed(4),
        outputPrice: m.outputPrice.toFixed(4),
        enabled: m.enabled,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Daily: refresh prices from the Gateway and disable catalog models it no
 * longer lists (re-enabling ones that return). Markups are never touched.
 */
export async function syncCatalogFromGateway(
  fetchModels: () => Promise<{ models: { id: string; pricing?: { input: string; output: string } | null }[] }>,
): Promise<{ updated: number; disabled: number }> {
  await seedCatalog();
  const { models } = await fetchModels();
  const live = new Map(models.map((m) => [m.id, m]));
  const rows = await db().select().from(modelCatalog);
  let updated = 0;
  let disabled = 0;
  for (const row of rows) {
    const model = live.get(row.modelId);
    const perMillion = (perToken: string | undefined) =>
      perToken === undefined ? null : (Number(perToken) * 1_000_000).toFixed(4);
    await db()
      .update(modelCatalog)
      .set({
        enabled: Boolean(model),
        inputPrice: perMillion(model?.pricing?.input) ?? row.inputPrice,
        outputPrice: perMillion(model?.pricing?.output) ?? row.outputPrice,
        syncedAt: new Date(),
      })
      .where(eq(modelCatalog.modelId, row.modelId));
    if (model) updated++;
    else disabled++;
  }
  return { updated, disabled };
}
