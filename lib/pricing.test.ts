import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, creditsForCost, creditsToUsd } from "./pricing";

describe("credit pricing", () => {
  it("charges cost × markup in whole credits, rounding up", () => {
    expect(creditsForCost(0.04)).toBe(6);
    expect(creditsForCost(0.041)).toBe(7);
  });

  it("applies the minimum charge", () => {
    expect(creditsForCost(0.0001)).toBe(1);
    expect(creditsForCost(0.0001, 1.5, 2)).toBe(2);
  });

  it("prices packs at one cent per credit", () => {
    for (const pack of CREDIT_PACKS) expect(creditsToUsd(pack.credits)).toBe(pack.usd);
  });
});
