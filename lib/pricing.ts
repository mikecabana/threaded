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

/** Default multiplier on actual AI Gateway cost; overridable per catalog model. */
export const DEFAULT_MARKUP = 1.5;

/** Free credits granted once per Threads account. */
export const TRIAL_CREDITS = 100;

export const CREDIT_PACKS = [
  { id: "pack_5", usd: 5, credits: 500 },
  { id: "pack_20", usd: 20, credits: 2000 },
  { id: "pack_50", usd: 50, credits: 5000 },
] as const;

export type CreditPack = (typeof CREDIT_PACKS)[number];

export function packById(id: string | null | undefined): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

/** Auto-recharge tops up when the balance drops below one of these. */
export const RECHARGE_THRESHOLDS = [50, 100, 200, 500] as const;

/** Monthly platform fee for workspaces that bring their own AI Gateway key. */
export const BYOK_PLATFORM_FEE_USD = 5;

/** Purchased credits expire this many months after purchase. */
export const CREDIT_EXPIRY_MONTHS = 12;

export function creditsToUsd(credits: number): number {
  return Math.round(credits * CREDIT_USD * 100) / 100;
}

/** Credits charged for an AI call that cost the platform `costUsd`. */
export function creditsForCost(costUsd: number, markup = DEFAULT_MARKUP, minCredits = 1): number {
  // The epsilon stops float noise (0.04 * 1.5 / 0.01 = 6.000000000000001) rounding up a credit.
  return Math.max(minCredits, Math.ceil((costUsd * markup) / CREDIT_USD - 1e-9));
}
