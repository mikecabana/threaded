import { describe, expect, it } from "vitest";
import { demoFeatures, generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import type { PostWithInsights } from "@/lib/threads/types";
import { factText, featureLabel, MIN_FACT_POSTS, performanceFacts, subjectPhrase, topicStats } from "./facts";

const now = new Date("2026-10-20T19:30:00Z");
const persona = DEMO_PERSONAS.creator;
const data = generateDemoDataset(persona, now);
const features = demoFeatures(persona);

function post(id: string, text: string, views: number, replies: number, daysAgo = 10): PostWithInsights {
  return {
    id,
    text,
    timestamp: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
    mediaType: "TEXT_POST",
    permalink: "",
    isQuotePost: false,
    topicTag: null,
    insights: { views, likes: 0, replies, reposts: 0, quotes: 0, shares: 0 },
  };
}

describe("performance facts", () => {
  const facts = performanceFacts(data.posts, features, now);

  it("finds what the demo data was built to show", () => {
    // The indie-hacker persona's questions draw far more replies than its other posts.
    const questions = facts.find((f) => f.subject.kind === "format" && f.subject.value === "question");
    expect(questions?.metric).toMatch(/replies|engagement/);
    expect(questions?.multiplier).toBeGreaterThan(1.3);
    expect(questions?.text).toMatch(/^Questions get \d+(\.\d)?× your typical (reply|engagement) rate \(\d+ posts\)\.$/);
  });

  it("numbers the facts and keeps at most two per subject", () => {
    expect(facts.map((f) => f.id)).toEqual(facts.map((_, i) => `F${i + 1}`));
    const perSubject = new Map<string, number>();
    for (const f of facts) {
      const key = `${f.subject.kind}:${f.subject.value}`;
      perSubject.set(key, (perSubject.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perSubject.values())).toBeLessThanOrEqual(2);
    expect(facts.every((f) => f.multiplier >= 1.3 || f.multiplier <= 1 / 1.3)).toBe(true);
  });

  it("still finds trait facts without any classification", () => {
    const traitsOnly = performanceFacts(data.posts, new Map(), now);
    expect(traitsOnly.length).toBeGreaterThan(0);
    expect(traitsOnly.every((f) => f.subject.kind === "trait")).toBe(true);
  });

  it("says nothing from too few posts, or from posts still settling", () => {
    const few = data.posts.slice(0, MIN_FACT_POSTS - 1);
    expect(performanceFacts(few, features, now)).toEqual([]);
    const fresh = data.posts.map((p) => ({ ...p, timestamp: now.toISOString() }));
    expect(performanceFacts(fresh, features, now)).toEqual([]);
  });

  it("needs three posts on each side of a comparison", () => {
    // Two link posts with huge views: not enough to claim anything about links.
    const posts = [
      post("a", "see https://x.y", 50_000, 0),
      post("b", "see https://x.y", 60_000, 0),
      ...Array.from({ length: 10 }, (_, i) => post(`p${i}`, "plain post", 1000 + i, 1)),
    ];
    const found = performanceFacts(posts, new Map(), now, { metrics: ["views"] });
    expect(found.some((f) => f.subject.kind === "trait" && f.subject.value === "link")).toBe(false);
  });

  it("phrases each kind of subject and near-zero results", () => {
    expect(subjectPhrase({ kind: "hook", value: "bold_claim" })).toBe("Posts that open with a bold claim");
    expect(subjectPhrase({ kind: "tone", value: "playful" })).toBe("Playful posts");
    expect(subjectPhrase({ kind: "topic", value: "pricing" })).toBe("Posts about pricing");
    expect(factText({ kind: "trait", value: "link" }, "replies", 0.05, 6)).toBe(
      "Posts with a link get almost no replies (6 posts).",
    );
    expect(factText({ kind: "format", value: "hot_take" }, "views", 2.84, 9)).toBe(
      "Hot takes get 2.8× your median views (9 posts).",
    );
  });
});

describe("topic stats", () => {
  it("ranks topics by how often they come up, with how they perform", () => {
    const topics = topicStats(data.posts, features, now);
    expect(topics.length).toBeGreaterThan(1);
    expect(topics[0].posts).toBeGreaterThanOrEqual(topics[1].posts);
    expect(topics.reduce((sum, t) => sum + t.share, 0)).toBeLessThanOrEqual(1.01);
    expect(topics.every((t) => ["low", "medium", "high"].includes(t.confidence))).toBe(true);
    expect(topicStats(data.posts, new Map(), now)).toEqual([]);
  });

  it("labels a post's features", () => {
    expect(featureLabel({ format: "hot_take", topic: "pricing", hookType: null, tone: null })).toBe(
      "Hot take · pricing",
    );
    expect(featureLabel(undefined)).toBeNull();
  });
});
