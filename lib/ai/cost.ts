import { creditsForCost } from "@/lib/pricing";
import type { CatalogEntry } from "./catalog";

// Cost maths for one AI call. The reserve uses the worst case (every output
// token used) so a wallet can never be overdrawn; the user is charged what the
// Gateway reports the call actually cost.

/** Rough token count for planning only (≈4 characters per token in English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function costUsd(
  entry: Pick<CatalogEntry, "inputPrice" | "outputPrice">,
  input: number,
  output: number,
): number {
  return (input * entry.inputPrice + output * entry.outputPrice) / 1_000_000;
}

/** Output tokens a batch of `count` ideas may use (also caps what's reserved). */
export function outputTokenBudget(count: number): number {
  return 300 + 350 * count;
}

/** Credits to reserve: the maximum the call could cost. */
export function maxCredits(entry: CatalogEntry, inputTokens: number, maxOutputTokens: number): number {
  // 20% headroom on the input estimate, since it's a character-count guess.
  return creditsForCost(costUsd(entry, inputTokens * 1.2, maxOutputTokens), entry.markup, entry.minCredits);
}

/** What a typical call costs, shown before generating. */
// Planning figures for prices shown before generating: a typical prompt
// (voice, best posts, recent posts) and typical output per batch size.
export const TYPICAL_INPUT_TOKENS = 2500;
export const TYPICAL_OUTPUT_TOKENS = { 3: 900, 5: 1400 } as const;

export function typicalCredits(entry: CatalogEntry, inputTokens: number, typicalOutputTokens: number): number {
  return creditsForCost(costUsd(entry, inputTokens, typicalOutputTokens), entry.markup, entry.minCredits);
}

/**
 * What a call cost by the Gateway's own figure, which comes back with every
 * response as `providerMetadata.gateway.cost` (searches included), or null
 * when there isn't one (the test mock, a provider that didn't report it).
 */
export function reportedCostUsd(providerMetadata: unknown): number | null {
  const cost = (providerMetadata as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost;
  const usd = typeof cost === "string" || typeof cost === "number" ? Number(cost) : Number.NaN;
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

/** Credits for the cost the Gateway reported, never more than was reserved. */
export function chargeCredits(entry: CatalogEntry, actualCostUsd: number, reserved: number): number {
  return Math.min(reserved, creditsForCost(actualCostUsd, entry.markup, entry.minCredits));
}

// Research before a batch (./research.ts): a few thousand tokens on the
// research model (Threads posts on the topic, and search results) plus the
// Gateway's search fee. It's charged with the batch, with the research
// model's markup, and only when it searched the web or read Threads posts.

/** One Gateway web search (Perplexity Search: $5 per 1,000 requests). */
export const SEARCH_USD = 0.005;

/** The most a research call writes per step. */
export const RESEARCH_OUTPUT_TOKENS = 500;

export const RESEARCH_USAGE = {
  /** Planning figures for the estimate: Threads posts and one search, answered in the same call. */
  typical: { inputTokens: 4000, outputTokens: 350, searches: 1 },
  /** The worst case, for the reserve: every search and every step's tokens. */
  max: { inputTokens: 16_000, outputTokens: 3 * RESEARCH_OUTPUT_TOKENS, searches: 2 },
} as const;

/**
 * Credits for a finished batch: the ideas at the Studio model's price, plus
 * the research at the research model's markup when it searched or read
 * Threads posts (a topic it skipped is free). Never more than was reserved.
 */
export function chargeBatch(input: {
  entry: CatalogEntry;
  costUsd: number;
  research?: { entry: CatalogEntry; costUsd: number; searches: number; threadsPosts: number } | null;
  reserved: number;
}): number {
  const { research } = input;
  const ideas = creditsForCost(input.costUsd, input.entry.markup, input.entry.minCredits);
  const researched =
    research && (research.searches > 0 || research.threadsPosts > 0)
      ? creditsForCost(research.costUsd, research.entry.markup, 0)
      : 0;
  return Math.min(input.reserved, ideas + researched);
}

/** Prompt tokens research can add to the batch's prompt: the brief and the Threads summary. */
export const RESEARCH_BRIEF_TOKENS = 650;

export function researchCredits(entry: CatalogEntry, which: keyof typeof RESEARCH_USAGE): number {
  const usage = RESEARCH_USAGE[which];
  const cost = costUsd(entry, usage.inputTokens, usage.outputTokens) + usage.searches * SEARCH_USD;
  return creditsForCost(cost, entry.markup, 0);
}
