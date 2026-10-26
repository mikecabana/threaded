import { describe, expect, it } from "vitest";
import { performanceFacts, topicStats } from "@/lib/analysis/facts";
import { demoFeatures, generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { classifyQuestions, mapLimit, readAnswers } from "./classify-questions";
import { voiceStats } from "./context";
import { assembleDna, buildDnaPrompt, DNA_SCHEMA_VERSION, dnaSamples, readDna } from "./dna-prompt";
import { createMockDecisionModel, mockDna, mockTopics } from "./mock-model";
import { buildTopicsPrompt, normalizeTopic, readTopics, topicsNeedRefresh } from "./topics-prompt";

const now = new Date("2026-10-20T19:30:00Z");
const persona = DEMO_PERSONAS.creator;
const data = generateDemoDataset(persona, now);
const features = demoFeatures(persona);

const TOPICS = [
  { name: "pricing", description: "What to charge and how" },
  { name: "shipping", description: "Releasing work" },
];

describe("classification questions", () => {
  it("asks format, hook and tone, plus the author's topics with a way out", () => {
    const questions = classifyQuestions(TOPICS) as Record<string, { criteria: unknown }>;
    expect(Object.keys(questions)).toEqual(["format", "hook", "tone", "topic"]);
    expect(questions.topic.criteria).toEqual({
      t1: "pricing: What to charge and how",
      t2: "shipping: Releasing work",
      other: "None of these",
    });
    expect(Object.keys(classifyQuestions([]))).toEqual(["format", "hook", "tone"]);
  });

  it("reads answers back into labels", () => {
    const choice = (c: string) => ({ type: "choice", choice: c });
    expect(
      readAnswers(
        { format: choice("tip"), hook: choice("how_to"), tone: choice("earnest"), topic: choice("t2") },
        TOPICS,
      ),
    ).toEqual({ format: "tip", topic: "shipping", hookType: "how_to", tone: "earnest" });
    // "other", refusals and unknown choices leave that label empty.
    expect(
      readAnswers(
        { format: choice("list"), hook: { type: "refusal" }, tone: choice("smug"), topic: choice("other") },
        TOPICS,
      ),
    ).toEqual({ format: "list", topic: null, hookType: null, tone: null });
    // Without a format there's nothing to store; the post stays pending.
    expect(readAnswers({ format: { type: "refusal" } }, TOPICS)).toBeNull();
    expect(readAnswers({ format: choice("poem") }, TOPICS)).toBeNull();
  });

  it("runs work a few at a time, keeping the order", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running--;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it("the test mock files a post under the topic it mentions", async () => {
    const model = createMockDecisionModel();
    const decide = (text: string) =>
      model.doDecide({ state: [{ type: "text", text }], questions: classifyQuestions(TOPICS) });
    expect((await decide("What should I charge? Pricing is hard.")).answers).toMatchObject({
      format: { choice: "question" },
      topic: { choice: "t1" },
    });
    expect((await decide("Hot take: nobody reads docs")).answers).toMatchObject({
      format: { choice: "hot_take" },
      topic: { choice: "other" },
    });
  });
});

describe("topic list", () => {
  it("numbers the sample and shows the topics so far", () => {
    expect(buildTopicsPrompt({ bio: "Indie dev", existing: TOPICS, posts: [" one ", "two"] })).toBe(
      [
        "Author's bio: Indie dev",
        "",
        "Their topics so far:",
        "- pricing: What to charge and how",
        "- shipping: Releasing work",
        "",
        "Posts:",
        '[1] """one"""',
        '[2] """two"""',
      ].join("\n"),
    );
    expect(buildTopicsPrompt({ bio: "", existing: [], posts: ["x"] })).toBe('Posts:\n[1] """x"""');
  });

  it("normalizes names, keeping acronyms and names like TikTok", () => {
    expect(normalizeTopic("#Remote Work.")).toBe("remote work");
    expect(normalizeTopic("AI tools")).toBe("AI tools");
    expect(normalizeTopic("TikTok growth")).toBe("TikTok growth");
    expect(normalizeTopic("one two three four")).toBe("one two three");
    expect(normalizeTopic("  ")).toBeNull();
  });

  it("keeps existing topics first and under their names, then adds new ones", () => {
    const list = readTopics(
      {
        topics: [
          { name: "Pricing", description: "Renamed by the model" },
          { name: "Design", description: " Interfaces " },
          { name: "design", description: "Duplicate" },
          { name: "  ", description: "Empty" },
        ],
      },
      TOPICS,
    );
    expect(list).toEqual([...TOPICS, { name: "design", description: "Interfaces" }]);
    const many = { topics: Array.from({ length: 20 }, (_, i) => ({ name: `topic ${i}`, description: "x" })) };
    expect(readTopics(many, [])).toHaveLength(12);
  });

  it("asks again when there's no list, or weekly when too many posts fit none", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const fresh = { list: TOPICS, updatedAt: "2026-10-25T12:00:00Z" };
    const stale = { list: TOPICS, updatedAt: "2026-10-18T12:00:00Z" };
    expect(topicsNeedRefresh(null, { labelled: 0, unfiled: 0 }, now)).toBe(true);
    expect(topicsNeedRefresh(fresh, { labelled: 20, unfiled: 20 }, now)).toBe(false);
    expect(topicsNeedRefresh(stale, { labelled: 20, unfiled: 4 }, now)).toBe(false);
    expect(topicsNeedRefresh(stale, { labelled: 20, unfiled: 5 }, now)).toBe(true);
    expect(topicsNeedRefresh(stale, { labelled: 4, unfiled: 4 }, now)).toBe(false);
  });

  it("the test mock names topics after the posts' words", () => {
    const prompt = buildTopicsPrompt({ bio: "", existing: [], posts: ["Shipping weekly", "Pricing is hard", "ok"] });
    expect(mockTopics(prompt).topics.map((t) => t.name)).toEqual(["shipping", "pricing"]);
  });
});

describe("Profile DNA", () => {
  const facts = performanceFacts(data.posts, features, now);
  const topics = topicStats(data.posts, features, now);
  const stats = voiceStats(data.posts);
  const samples = dnaSamples(data.posts).map((p) => ({ text: p.text, features: features.get(p.id) }));
  const prompt = buildDnaPrompt({ profile: persona.profile, stats, facts, topics, samples });

  it("gives the model numbered facts, topics and labelled samples", () => {
    expect(prompt).toContain("@maya.builds");
    expect(prompt).toContain(`F1 ${facts[0].text}`);
    expect(prompt).toMatch(/^- building: \d+ posts/m);
    expect(prompt).toMatch(/^1\. """[\s\S]+""" \((Question|Hot take|Story|List|Tip|Observation) · /m);
    expect(samples.length).toBeLessThanOrEqual(20);
    expect(new Set(samples.map((s) => s.text)).size).toBe(samples.length);
  });

  it("tells the model when there are no facts yet", () => {
    const bare = buildDnaPrompt({ profile: persona.profile, stats, facts: [], topics: [], samples: [] });
    expect(bare).toContain("Return no rewards or blind spots.");
  });

  it("keeps only claims that cite a real fact pointing the right way", () => {
    const up = facts.find((f) => f.multiplier > 1);
    const down = facts.find((f) => f.multiplier < 1);
    if (!up || !down) throw new Error("demo data should have both");
    const dna = assembleDna({
      output: {
        ...mockDna(prompt),
        signaturePhrases: ["Tidy", "a phrase nobody wrote"],
        rewards: [
          { fact: up.id.toLowerCase(), claim: "Your audience loves this." },
          { fact: up.id, claim: "Duplicate of the same fact." },
          { fact: down.id, claim: "Points the wrong way." },
          { fact: "F99", claim: "Cites nothing." },
        ],
        blindSpots: [{ fact: down.id, claim: "This lands softer." }],
        coreTopics: ["Building"],
      },
      facts,
      topics,
      stats,
      posts: data.posts,
    });
    expect(dna.schema).toBe(DNA_SCHEMA_VERSION);
    expect(dna.rewards).toEqual([
      { claim: "Your audience loves this.", fact: expect.objectContaining({ text: up.text }) },
    ]);
    expect(dna.blindSpots.map((b) => b.fact.text)).toEqual([down.text]);
    expect(dna.voice.signaturePhrases).toEqual(["Tidy"]);
    expect(dna.topics.find((t) => t.name === "building")?.core).toBe(true);
    expect(readDna(dna)).toBe(dna);
    expect(readDna({ schema: 0 })).toBeNull();
    expect(readDna(null)).toBeNull();
  });
});
