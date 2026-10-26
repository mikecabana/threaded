import { describe, expect, it } from "vitest";
import { performanceFacts, topicStats } from "@/lib/analysis/facts";
import { demoFeatures, generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { buildClassifyPrompt, normalizeTopic, readClassification } from "./classify-prompt";
import { voiceStats } from "./context";
import { assembleDna, buildDnaPrompt, DNA_SCHEMA_VERSION, dnaSamples, readDna } from "./dna-prompt";
import { mockClassification, mockDna } from "./mock-model";

const now = new Date("2026-10-20T19:30:00Z");
const persona = DEMO_PERSONAS.creator;
const data = generateDemoDataset(persona, now);
const features = demoFeatures(persona);

describe("classification", () => {
  it("numbers the posts and offers known topics", () => {
    const prompt = buildClassifyPrompt({ bio: "Indie dev", knownTopics: ["pricing", "AI"], posts: [" one ", "two"] });
    expect(prompt).toBe(
      [
        "Author's bio: Indie dev",
        "",
        "The author's existing topics (reuse when they fit): pricing, AI.",
        "",
        "Posts:",
        '[1] """one"""',
        '[2] """two"""',
      ].join("\n"),
    );
    expect(buildClassifyPrompt({ bio: "", knownTopics: [], posts: ["x"] })).toBe('Posts:\n[1] """x"""');
  });

  it("normalizes topics, keeping acronyms and names, and reusing known ones", () => {
    expect(normalizeTopic("#Remote Work.")).toBe("remote work");
    expect(normalizeTopic("AI tools")).toBe("AI tools");
    expect(normalizeTopic("TikTok growth")).toBe("TikTok growth");
    expect(normalizeTopic("Pricing", ["pricing"])).toBe("pricing");
    expect(normalizeTopic("one two three four")).toBe("one two three");
    expect(normalizeTopic("  ")).toBeNull();
  });

  it("maps answers back by number, first answer wins, out-of-range ignored", () => {
    const labels = readClassification(
      {
        posts: [
          { n: 2, format: "tip", topic: "Pricing", hookType: "how_to", tone: "earnest" },
          { n: 2, format: "list", topic: "other", hookType: "number", tone: "neutral" },
          { n: 9, format: "story", topic: "x", hookType: "confession", tone: "vulnerable" },
          { n: 1.5, format: "story", topic: "x", hookType: "confession", tone: "vulnerable" },
        ],
      },
      ["a", "b"],
    );
    expect([...labels]).toEqual([["b", { format: "tip", topic: "pricing", hookType: "how_to", tone: "earnest" }]]);
  });

  it("the test mock labels every numbered post", () => {
    const prompt = buildClassifyPrompt({ bio: "", knownTopics: [], posts: ["What do you think?", "Hot take: no"] });
    expect(mockClassification(prompt).posts.map((p) => [p.n, p.format])).toEqual([
      [1, "question"],
      [2, "hot_take"],
    ]);
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
