import { describe, expect, it } from "vitest";
import type { PostWithInsights } from "@/lib/threads/types";
import { engagementRate, goalScores, isSettled, mad, median, outperformance, robustZ } from "./metrics";

function post(id: string, hoursAgo: number, insights: Partial<PostWithInsights["insights"]>): PostWithInsights {
  return {
    id,
    text: id,
    timestamp: new Date(Date.UTC(2026, 9, 20, 12) - hoursAgo * 3_600_000).toISOString(),
    mediaType: "TEXT_POST",
    permalink: "",
    isQuotePost: false,
    topicTag: null,
    insights: { views: 1000, likes: 40, replies: 5, reposts: 2, quotes: 1, shares: 1, ...insights },
  };
}

describe("robust statistics", () => {
  it("computes median for odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("computes the median absolute deviation", () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });

  it("is unmoved by a single outlier", () => {
    const population = [100, 110, 90, 105, 95, 100_000];
    expect(robustZ(105, population)).toBeLessThan(1);
    expect(robustZ(100_000, population)).toBeGreaterThan(100);
  });

  it("returns 0 when there is no spread", () => {
    expect(robustZ(5, [5, 5, 5])).toBe(0);
  });
});

describe("rates", () => {
  it("guards against zero views", () => {
    expect(engagementRate({ views: 0, likes: 3, replies: 0, reposts: 0, quotes: 0, shares: 0 })).toBe(0);
  });

  it("counts likes, replies, reposts and quotes", () => {
    expect(engagementRate({ views: 200, likes: 10, replies: 5, reposts: 3, quotes: 2, shares: 9 })).toBe(0.1);
  });
});

describe("goalScores", () => {
  const posts = [
    post("chatty", 100, { replies: 60 }),
    post("viral", 100, { views: 20_000, reposts: 40, quotes: 20 }),
    post("plain-a", 100, {}),
    post("plain-b", 100, { views: 1100 }),
    post("plain-c", 100, { views: 900 }),
  ];

  it("ranks the reply-heavy post first for engagement", () => {
    const scores = goalScores("engagement", posts);
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
    expect(best).toBe("chatty");
  });

  it("ranks the high-reach post first for views and followers", () => {
    for (const goal of ["views", "followers"] as const) {
      const scores = goalScores(goal, posts);
      const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
      expect(best).toBe("viral");
    }
  });
});

describe("outperformance and settling", () => {
  it("compares views with the median of earlier posts", () => {
    const history = [post("a", 300, { views: 100 }), post("b", 200, { views: 300 }), post("c", 100, { views: 400 })];
    expect(outperformance(history[2], history)).toBe(2);
    expect(outperformance(history[0], history)).toBe(1);
  });

  it("treats posts younger than 72h as still settling", () => {
    const now = new Date(Date.UTC(2026, 9, 20, 12));
    expect(isSettled(post("fresh", 10, {}), now)).toBe(false);
    expect(isSettled(post("old", 80, {}), now)).toBe(true);
  });
});
