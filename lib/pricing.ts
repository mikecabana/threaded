// Commercial terms in one place so marketing, legal and billing agree.
// Starting values from docs/PLAN.md §15; tune once the margin dashboard has data.

/**
 * Everything is priced in US dollars, though the business (and its Stripe
 * account) is in Quebec. Pass it on every Stripe object that takes a currency:
 * Stripe otherwise falls back to the account's, CAD.
 */
export const CURRENCY = "usd";

/** Retail value of one credit in USD. */
export const CREDIT_USD = 0.01;

/**
 * Default multiplier on actual AI Gateway cost; overridable per catalog model.
 * 2× leaves room for Stripe's fees (about 6% + 30¢ a payment), the free trial
 * and the background work every account costs (docs/PLAN.md §6).
 */
export const DEFAULT_MARKUP = 2;

/** Free credits granted once per Threads account. */
export const TRIAL_CREDITS = 100;

/** Bigger packs come with bonus credits: 100, 110 and 115 credits per dollar. */
export const CREDIT_PACKS = [
  { id: "pack_5", usd: 5, credits: 500 },
  { id: "pack_20", usd: 20, credits: 2200 },
  { id: "pack_50", usd: 50, credits: 5750 },
] as const;

export type CreditPack = (typeof CREDIT_PACKS)[number];

/** Credits beyond the pack's dollar value (1 credit = 1¢), e.g. 200 for $20 → 2,200. */
export function packBonus(pack: CreditPack): number {
  return pack.credits - Math.round(pack.usd / CREDIT_USD);
}

export function packById(id: string | null | undefined): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

/** Auto-recharge tops up when the balance drops below one of these. */
export const RECHARGE_THRESHOLDS = [50, 100, 200, 500] as const;

/** Monthly platform fee for workspaces that bring their own AI Gateway key. */
export const BYOK_PLATFORM_FEE_USD = 5;

export function creditsToUsd(credits: number): number {
  return Math.round(credits * CREDIT_USD * 100) / 100;
}

/** Credits charged for an AI call that cost the platform `costUsd`. */
export function creditsForCost(costUsd: number, markup = DEFAULT_MARKUP, minCredits = 1): number {
  // The epsilon stops float noise (0.04 * 1.5 / 0.01 = 6.000000000000001) rounding up a credit.
  return Math.max(minCredits, Math.ceil((costUsd * markup) / CREDIT_USD - 1e-9));
}
