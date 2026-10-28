import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, creditsForCost, packBonus } from "./pricing";

describe("credit pricing", () => {
  it("charges cost × markup in whole credits, rounding up", () => {
    // 2× by default.
    expect(creditsForCost(0.04)).toBe(8);
    expect(creditsForCost(0.041)).toBe(9);
    // Float noise doesn't round up a credit (0.04 × 1.5 / 0.01 = 6.000000000000001).
    expect(creditsForCost(0.04, 1.5)).toBe(6);
  });

  it("applies the minimum charge", () => {
    expect(creditsForCost(0.0001)).toBe(1);
    expect(creditsForCost(0.0001, 1.5, 2)).toBe(2);
  });

  it("gives bigger packs more credits per dollar", () => {
    expect(CREDIT_PACKS.map(packBonus)).toEqual([0, 200, 750]);
    const perDollar = CREDIT_PACKS.map((pack) => pack.credits / pack.usd);
    expect(perDollar).toEqual([...perDollar].sort((a, b) => a - b));
  });
});
