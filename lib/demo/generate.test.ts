import { describe, expect, it } from "vitest";
import { replyRate } from "@/lib/analysis/metrics";
import { bestTimeToPost, buildKpis, topPosts } from "@/lib/analysis/summary";
import { GOALS } from "@/lib/goals";
import { fitsThreads } from "@/lib/threads/length";
import { DEMO_HISTORY_DAYS, generateDemoDataset } from "./generate";
import { DEMO_PERSONA_IDS, DEMO_PERSONAS } from "./personas";

const now = new Date("2026-10-20T19:30:00Z");

describe.each(DEMO_PERSONA_IDS)("demo persona %s", (id) => {
  const persona = DEMO_PERSONAS[id];
  const data = generateDemoDataset(persona, now);

  it("is deterministic for a given moment", () => {
    expect(generateDemoDataset(persona, now)).toEqual(data);
  });

  it("has a full history of complete days ending yesterday", () => {
    expect(data.days).toHaveLength(DEMO_HISTORY_DAYS);
    expect(data.days.at(-1)?.date).toBe("2026-10-19");
    expect(data.days.every((d) => d.views > 0)).toBe(true);
  });

  it("only has posts in the past, newest first", () => {
    expect(data.posts).toHaveLength(persona.posts.length);
    for (const post of data.posts) expect(Date.parse(post.timestamp)).toBeLessThan(now.getTime());
    const sorted = [...data.posts].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    expect(data.posts).toEqual(sorted);
  });

  it("grows followers overall", () => {
    expect(data.profile.followersCount).toBeGreaterThan(persona.followersStart);
  });

  it("gets more replies on questions than on other formats", () => {
    const formatOf = new Map(persona.posts.map((seed) => [seed.text, seed.format]));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const questions = data.posts.filter((p) => formatOf.get(p.text) === "question");
    const others = data.posts.filter((p) => formatOf.get(p.text) !== "question");
    expect(mean(questions.map((p) => replyRate(p.insights)))).toBeGreaterThan(
      mean(others.map((p) => replyRate(p.insights))),
    );
  });

  it("produces KPIs, top posts and a best time for every goal", () => {
    for (const goal of GOALS) {
      const kpis = buildKpis(goal, data.posts, data.days, now);
      expect(kpis).toHaveLength(4);
      for (const kpi of kpis) {
        expect(Number.isFinite(kpi.value)).toBe(true);
        expect(kpi.series.length).toBeGreaterThan(1);
      }
      expect(topPosts(goal, data.posts, now)).toHaveLength(3);
      expect(bestTimeToPost(goal, data.posts, persona.timezone, now)).not.toBeNull();
    }
  });

  it("keeps all sample copy within Threads' length limit", () => {
    const texts = [
      ...persona.posts.map((p) => p.text),
      ...GOALS.flatMap((g) => persona.suggestions[g].map((s) => s.text)),
      persona.upNext.text,
    ];
    for (const text of texts) expect(fitsThreads(text)).toBe(true);
  });
});
