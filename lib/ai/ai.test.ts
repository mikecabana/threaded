import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { creditsForCost } from "@/lib/pricing";
import { type CatalogEntry, DEFAULT_CATALOG, pickModel, sameTierFallbacks } from "./catalog";
import { buildContext, insightsFor, voiceStats } from "./context";
import { chargeCredits, costUsd, maxCredits } from "./cost";
import { byokFailure, gatewayStatus } from "./errors";
import { MOCK_SUGGESTIONS } from "./mock-model";
import { DUPLICATE_THRESHOLD, postProcess, similarity } from "./postprocess";
import { buildInstructions, buildPrompt } from "./prompt";
import { generateRequestSchema, suggestionBatchSchema } from "./schemas";

const now = new Date("2026-10-20T19:30:00Z");
const persona = DEMO_PERSONAS.creator;
const data = generateDemoDataset(persona, now);

describe("catalog", () => {
  const entries = DEFAULT_CATALOG.filter((m) => m.tasks.includes("generate"));

  it("honours an allowed pick, otherwise falls back to the task default", () => {
    expect(pickModel(entries, "generate", "anthropic/claude-opus-5.5").modelId).toBe("anthropic/claude-opus-5.5");
    expect(pickModel(entries, "generate", "someone/unlisted").modelId).toBe("anthropic/claude-sonnet-5.5");
    expect(pickModel(entries, "generate").modelId).toBe("anthropic/claude-sonnet-5.5");
  });

  it("only falls back within the same tier", () => {
    const extra: CatalogEntry = { ...entries[1], modelId: "other/balanced", label: "Other" };
    expect(sameTierFallbacks([...entries, extra], entries[1])).toEqual(["other/balanced"]);
    expect(sameTierFallbacks(entries, entries[0])).toEqual([]);
  });
});

describe("cost", () => {
  const sonnet = DEFAULT_CATALOG[1];

  it("prices tokens per million", () => {
    expect(costUsd(sonnet, 1_000_000, 0)).toBe(3);
    expect(costUsd(sonnet, 2000, 1000)).toBeCloseTo(0.021);
  });

  it("reserves the worst case and charges no more than that", () => {
    const reserve = maxCredits(sonnet, 2000, 2000);
    expect(reserve).toBe(creditsForCost(costUsd(sonnet, 2400, 2000), sonnet.markup));
    expect(chargeCredits(sonnet, 0.01, reserve)).toBe(2);
    expect(chargeCredits(sonnet, 100, reserve)).toBe(reserve);
  });
});

describe("post-processing", () => {
  it("scores near-duplicates high and unrelated text low", () => {
    expect(similarity("Ship it today.", "ship it today!")).toBe(1);
    expect(similarity("Pricing page changes that moved our conversion", "My solo dev stack in 2026")).toBeLessThan(0.2);
  });

  it("drops overlong posts and repeats of past posts or of each other", () => {
    const base = MOCK_SUGGESTIONS[0];
    const { kept, dropped } = postProcess(
      [
        { ...base, text: "x".repeat(501) },
        { ...base, text: persona.posts[1].text },
        { ...base, text: "A brand new idea about habits" },
        { ...base, text: "A brand new idea about habits!" },
        { ...base, text: "   " },
      ],
      persona.posts.map((p) => p.text),
    );
    expect(kept.map((k) => k.text)).toEqual(["A brand new idea about habits"]);
    expect(dropped.map((d) => d.reason)).toEqual(["too_long", "duplicate", "duplicate", "empty"]);
    expect(DUPLICATE_THRESHOLD).toBeGreaterThan(0.5);
  });

  it("clamps scores and time slots into range", () => {
    const { kept } = postProcess([{ ...MOCK_SUGGESTIONS[1], goalFit: 140.6, bestSlot: { weekday: 9, hour: -1 } }], []);
    expect(kept[0].goalFit).toBe(100);
    expect(kept[0].bestSlot).toEqual({ weekday: 2, hour: 23 });
  });
});

describe("context and prompt", () => {
  const context = buildContext({
    goal: "engagement",
    profile: persona.profile,
    posts: data.posts,
    timeZone: persona.timezone,
    now,
  });

  it("summarizes the author's voice", () => {
    const voice = voiceStats(data.posts);
    expect(voice.posts).toBe(20);
    // Five of the indie-hacker persona's twenty posts ask a question.
    expect(voice.questionShare).toBe(5 / 20);
    expect(voice.medianLength).toBeGreaterThan(80);
  });

  it("only states insights the data supports", () => {
    // In the demo data, questions clearly out-reply statements.
    expect(insightsFor(data.posts).some((f) => f.startsWith("Questions get"))).toBe(true);
    expect(insightsFor([])).toEqual([]);
  });

  it("feeds the best and recent posts into the prompt", () => {
    expect(context.exemplars).toHaveLength(5);
    expect(context.recent).toHaveLength(15);
    const prompt = buildPrompt(
      generateRequestSchema.parse({ goal: "engagement", topic: "pricing", count: 3 }),
      context,
    );
    expect(prompt).toContain("@maya.builds");
    expect(prompt).toContain("Topic: pricing.");
    expect(prompt).toContain("Write 3 new post ideas.");
    expect(prompt).toContain(context.exemplars[0].text);
    expect(prompt).not.toMatch(/\n\n\n/);
  });

  it("states the goal, tone and rules", () => {
    const instructions = buildInstructions(generateRequestSchema.parse({ goal: "views", spice: "spicy" }));
    expect(instructions).toContain("More Views");
    expect(instructions).toContain("contrarian");
    expect(instructions).toContain("Never make up numbers");
  });

  it("handles an author with no posts yet", () => {
    const empty = buildContext({ goal: "followers", profile: persona.profile, posts: [], timeZone: "UTC", now });
    expect(buildPrompt(generateRequestSchema.parse({ goal: "followers" }), empty)).toContain("hasn't posted yet");
  });
});

describe("schemas", () => {
  it("accepts the mock batch and applies request defaults", () => {
    expect(suggestionBatchSchema.parse({ suggestions: MOCK_SUGGESTIONS }).suggestions).toHaveLength(5);
    expect(generateRequestSchema.parse({ goal: "views" })).toMatchObject({ spice: "bold", format: "any", count: 3 });
    expect(() => generateRequestSchema.parse({ goal: "views", count: 9 })).toThrow();
  });
});

describe("own-key errors", () => {
  const withStatus = (statusCode: number) => Object.assign(new Error("Gateway request failed"), { statusCode });

  it("finds the Gateway status inside wrapped errors", () => {
    expect(gatewayStatus(withStatus(401))).toBe(401);
    expect(gatewayStatus({ lastError: { cause: withStatus(402) } })).toBe(402);
    expect(gatewayStatus({ errors: [new Error("x"), withStatus(403)] })).toBe(403);
    expect(gatewayStatus(new Error("no status"))).toBeNull();
  });

  it("maps failures the user can fix", () => {
    expect(byokFailure(withStatus(401))).toBe("byok_key_invalid");
    expect(byokFailure(withStatus(403))).toBe("byok_key_invalid");
    expect(byokFailure(withStatus(402))).toBe("byok_no_balance");
    expect(byokFailure(new Error("Insufficient funds on this team"))).toBe("byok_no_balance");
    expect(byokFailure(withStatus(500))).toBeNull();
  });
});
