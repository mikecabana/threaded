import { describe, expect, it } from "vitest";
import { createMockJudgeModel, createMockModel, MOCK_SUGGESTIONS } from "@/lib/ai/mock-model";
import { PROMPT_VERSION } from "@/lib/ai/prompt";
import { ALL_CASES, formatComparison, judgePrompt, repetitionShare, runCase, runEval } from "./eval";

const now = new Date("2026-10-20T19:30:00Z");
const target = { pricing: { modelId: "mock/model", inputPrice: 3, outputPrice: 15 }, model: createMockModel(5) };
const judge = { pricing: { modelId: "mock/judge", inputPrice: 5, outputPrice: 25 }, model: createMockJudgeModel() };

describe("evals", () => {
  it("covers every persona and goal", () => {
    expect(ALL_CASES).toHaveLength(9);
  });

  it("generates a batch as Studio would, then measures and grades it", async () => {
    const result = await runCase({ persona: "creator", goal: "engagement" }, target, judge, { now });
    expect(result.error).toBeUndefined();
    expect(result.ideas.map((i) => i.text)).toEqual(MOCK_SUGGESTIONS.slice(0, 5).map((s) => s.text));
    // The mock judge gives 4/5 (75) for voice, 3/5 for longer ideas, and 4/5 for goal fit.
    expect(result.goalFit).toBe(75);
    expect(result.voice).toBeGreaterThan(50);
    expect(result.withinLimit).toBe(1);
    expect(result.repetition).toBe(0);
    expect(result.kept).toBe(5);
    // Mock usage: 1,500 in / 300 out at $3/$15 per million, and 2,000 / 200 for the judge at $5/$25.
    expect(result.costUsd).toBeCloseTo(0.009, 6);
    expect(result.judgeCostUsd).toBeCloseTo(0.015, 6);
  });

  it("sums up a run, and records failures instead of stopping", async () => {
    const failing = { ...target, model: createMockModel(5, "mock/model", { fail: true }) };
    const cases = ALL_CASES.slice(0, 2);
    const ok = await runEval(target, judge, { cases, now });
    expect(ok).toMatchObject({ model: "mock/model", judge: "mock/judge", promptVersion: PROMPT_VERSION });
    expect(ok.summary).toMatchObject({ goalFit: 75, failed: 0, withinLimit: 1 });
    expect(ok.summary.costPerBatch).toBeCloseTo(0.009, 6);

    const bad = await runEval(failing, judge, { cases, now });
    expect(bad.summary.failed).toBe(2);
    expect(bad.cases[0].error).toMatch(/Mock provider failure/);
    expect(formatComparison([ok, bad])).toMatch(/^Model\s+Voice\s+Goal fit/);
  });

  it("measures repetition against past posts and within the batch", () => {
    expect(repetitionShare(["Ship it today.", "Totally different idea here."], ["Ship it today!"])).toBe(0.5);
    expect(repetitionShare(["Same thought, twice.", "Same thought, twice!"], [])).toBe(0.5);
    expect(repetitionShare([], [])).toBe(0);
  });

  it("shows the judge the author's real posts and the goal", () => {
    const prompt = judgePrompt({ persona: "expert", goal: "followers", ideas: ["One", "Two"], now });
    expect(prompt).toContain("Their real posts:");
    expect(prompt).toContain("Goal: More Followers.");
    expect(prompt).toMatch(/1\. """One"""\n2\. """Two"""$/);
  });
});
