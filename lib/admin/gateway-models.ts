import "server-only";
import type { ModelTier } from "@/lib/ai/catalog";
import { costUsd, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS } from "@/lib/ai/cost";
import { MOCK_GATEWAY_MODELS } from "@/lib/ai/mock-gateway-models";
import { gatewayReachable, platformGateway } from "@/lib/ai/models";
import { creditsForCost, DEFAULT_MARKUP } from "@/lib/pricing";

// Every language model the AI Gateway offers, for /admin/models: staff browse
// them by provider, price or name and add the ones they want to the catalog.
// Only catalog models are ever offered to people (lib/ai/catalog.ts).

/** An entry from the Gateway's model list (`gateway.getAvailableModels()`). */
export interface GatewayEntry {
  id: string;
  name: string;
  description?: string | null;
  /** USD per token, as decimal strings. */
  pricing?: { input: string; output: string } | null;
  modelType?: string | null;
}

export interface GatewayModel {
  id: string;
  name: string;
  /** The company behind it, from the ID's prefix. */
  provider: string;
  description: string | null;
  /** USD per million tokens, or null when the Gateway lists no price. */
  inputPrice: number | null;
  outputPrice: number | null;
}

const PROVIDER_NAMES: Record<string, string> = {
  alibaba: "Alibaba",
  amazon: "Amazon",
  anthropic: "Anthropic",
  bytedance: "ByteDance",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  google: "Google",
  inception: "Inception",
  meituan: "Meituan",
  meta: "Meta",
  minimax: "MiniMax",
  mistral: "Mistral",
  moonshotai: "Moonshot AI",
  morph: "Morph",
  openai: "OpenAI",
  perplexity: "Perplexity",
  vercel: "Vercel",
  xai: "xAI",
  zai: "Z.ai",
};

export function providerName(modelId: string): string {
  const prefix = modelId.split("/")[0] ?? modelId;
  return PROVIDER_NAMES[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function perMillion(perToken: string | undefined): number | null {
  const usd = Number(perToken) * 1_000_000;
  return perToken === undefined || !Number.isFinite(usd) ? null : Math.round(usd * 10_000) / 10_000;
}

/** The language models in the Gateway's list (no image, embedding or decision models), priced per million tokens. */
export function languageModels(entries: GatewayEntry[]): GatewayModel[] {
  return entries
    .filter((entry) => (entry.modelType ?? "language") === "language")
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      provider: providerName(entry.id),
      description: entry.description?.trim() || null,
      inputPrice: perMillion(entry.pricing?.input),
      outputPrice: perMillion(entry.pricing?.output),
    }));
}

/** A starting tier from the output price, which is most of what a batch of ideas costs. */
export function suggestTier(outputPrice: number | null): ModelTier {
  if (outputPrice === null) return "balanced";
  return outputPrice < 6 ? "fast" : outputPrice < 20 ? "balanced" : "best";
}

/** What Studio would charge for a typical batch of 5 ideas at the default markup, or null without a price. */
export function batchCredits(model: Pick<GatewayModel, "inputPrice" | "outputPrice">): number | null {
  if (model.inputPrice === null || model.outputPrice === null) return null;
  const prices = { inputPrice: model.inputPrice, outputPrice: model.outputPrice };
  return creditsForCost(costUsd(prices, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS[5]), DEFAULT_MARKUP, 1);
}

export const SHOW = { all: "All models", new: "Not in the catalog", catalog: "In the catalog" } as const;
export const SORT = { cheapest: "Cheapest first", priciest: "Priciest first", name: "Name" } as const;

export interface ModelFilters {
  q: string;
  provider: string;
  show: keyof typeof SHOW;
  sort: keyof typeof SORT;
}

const pick = <T extends object>(options: T, value: string, fallback: keyof T): keyof T =>
  Object.hasOwn(options, value) ? (value as keyof T) : fallback;

/** Filters from the page's query string; anything unknown falls back to the defaults. */
export function parseFilters(params: Record<string, string | string[] | undefined>): ModelFilters {
  const one = (key: string) => {
    const value = params[key];
    return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
  };
  return {
    q: one("q").slice(0, 100),
    provider: one("provider").slice(0, 40),
    show: pick(SHOW, one("show"), "all"),
    sort: pick(SORT, one("sort"), "cheapest"),
  };
}

/** Cost of a typical batch in USD, for sorting; unpriced models sort last either way. */
const batchUsd = (m: GatewayModel) =>
  m.inputPrice === null || m.outputPrice === null
    ? null
    : costUsd({ inputPrice: m.inputPrice, outputPrice: m.outputPrice }, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS[5]);

export function filterModels(
  models: GatewayModel[],
  filters: ModelFilters,
  inCatalog: ReadonlySet<string>,
): GatewayModel[] {
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  const byName = (a: GatewayModel, b: GatewayModel) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const byPrice = (direction: 1 | -1) => (a: GatewayModel, b: GatewayModel) => {
    const [x, y] = [batchUsd(a), batchUsd(b)];
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    return (x - y) * direction || byName(a, b);
  };
  return models
    .filter((m) => {
      if (filters.provider && m.provider !== filters.provider) return false;
      if (filters.show === "new" && inCatalog.has(m.id)) return false;
      if (filters.show === "catalog" && !inCatalog.has(m.id)) return false;
      const text = `${m.id} ${m.name} ${m.provider}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort(filters.sort === "name" ? byName : byPrice(filters.sort === "priciest" ? -1 : 1));
}

/** Providers in the list, with how many language models each offers, by name. */
export function providerCounts(models: GatewayModel[]): { provider: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of models) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);
  return [...counts]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

export type GatewayListing = { ok: true; models: GatewayModel[] } | { ok: false; message: string };

/** The Gateway's language models now (the test mock's under AI_MOCK=1). */
export async function fetchGatewayModels(): Promise<GatewayListing> {
  if (process.env.AI_MOCK === "1") return { ok: true, models: languageModels(MOCK_GATEWAY_MODELS) };
  if (!gatewayReachable()) {
    return {
      ok: false,
      message: "The AI Gateway isn't reachable from here. Set AI_GATEWAY_API_KEY, or run on Vercel.",
    };
  }
  try {
    const { models } = await platformGateway().getAvailableModels();
    return { ok: true, models: languageModels(models) };
  } catch (error) {
    return {
      ok: false,
      message: `The AI Gateway's model list didn't load: ${error instanceof Error ? error.message : error}`,
    };
  }
}
