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

/** Credits to reserve: the maximum the call could cost. */
export function maxCredits(entry: CatalogEntry, inputTokens: number, maxOutputTokens: number): number {
  // 20% headroom on the input estimate, since it's a character-count guess.
  return creditsForCost(costUsd(entry, inputTokens * 1.2, maxOutputTokens), entry.markup, entry.minCredits);
}

/** What a typical call costs, shown before generating. */
export function typicalCredits(entry: CatalogEntry, inputTokens: number, typicalOutputTokens: number): number {
  return creditsForCost(costUsd(entry, inputTokens, typicalOutputTokens), entry.markup, entry.minCredits);
}

/** Credits for the cost the Gateway reported, never more than was reserved. */
export function chargeCredits(entry: CatalogEntry, actualCostUsd: number, reserved: number): number {
  return Math.min(reserved, creditsForCost(actualCostUsd, entry.markup, entry.minCredits));
}
