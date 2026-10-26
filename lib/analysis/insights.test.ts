import { describe, expect, it } from "vitest";
import { demoFeatures, generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import type { AccountDay, PostWithInsights } from "@/lib/threads/types";
import {
  dayLabel,
  followersLine,
  followersTrend,
  formatTopicMatrix,
  heatmapLine,
  matrixLine,
  postRows,
  postsLine,
  snippet,
  viewsLine,
  viewsTrend,
  weekHeatmap,
} from "./insights";

const now = new Date("2026-10-20T19:30:00Z");
const persona = DEMO_PERSONAS.creator;
const data = generateDemoDataset(persona, now);
const features = demoFeatures(persona);

function day(date: string, views: number, followersCount: number, followersMeasured = true): AccountDay {
  return { date, views, likes: 0, replies: 0, reposts: 0, quotes: 0, followersCount, followersMeasured };
}

describe("trends", () => {
  it("attaches each day's posts to the views series", () => {
    const trend = viewsTrend(data.days, data.posts);
    expect(trend).toHaveLength(data.days.length);
    const withPosts = trend.filter((p) => p.posts.length > 0);
    expect(withPosts.length).toBeGreaterThan(5);
    const post = data.posts.find((p) => p.timestamp.slice(0, 10) === withPosts[0].date);
    expect(withPosts[0].posts.map((p) => p.id)).toContain(post?.id);
  });

  it("says how views moved and which day stood out", () => {
    expect(viewsLine(data.days, data.posts)).toMatch(
      /^[\d.,k]+ views in the last 30 days, (up|down) [\d.]+% on the 30 days before\. Your best day was \w{3} \d{1,2} \([\d.,k]+ views\)/,
    );
    expect(viewsLine(data.days.slice(0, 3), data.posts)).toBe("Your daily views show up here after a week of data.");
  });

  it("starts followers at the first real snapshot, never backdated", () => {
    const days = [day("2026-10-01", 10, 500, false), day("2026-10-02", 10, 500, false), day("2026-10-03", 10, 510)];
    expect(followersTrend(days, []).map((p) => p.date)).toEqual(["2026-10-03"]);
    expect(followersLine(followersTrend(days, []), [])).toBe(
      "510 followers. Threads only shares today's count, so we started tracking on Oct 3 and growth fills in day by day.",
    );
    expect(followersTrend([day("2026-10-01", 1, 1, false)], [])).toEqual([]);
  });

  it("names the follower jump and the post behind it", () => {
    const trend = followersTrend(data.days, data.posts);
    const line = followersLine(trend, data.posts);
    expect(line).toMatch(/^[+−][\d,]+ followers in the last 30 days, now [\d,]+\. The biggest jump, \+\d+, came on/);
  });
});

describe("best hours", () => {
  const cells = weekHeatmap("engagement", data.posts, persona.timezone, now);

  it("buckets settled posts by weekday and hour in the author's timezone", () => {
    const settled = data.posts.filter((p) => now.getTime() - Date.parse(p.timestamp) >= 72 * 3_600_000);
    expect(cells.reduce((n, c) => n + c.posts, 0)).toBe(settled.length);
    expect(cells.every((c) => c.weekday >= 0 && c.weekday <= 6 && c.hour >= 0 && c.hour <= 23)).toBe(true);
  });

  it("names the best repeated slot, or says there's no pattern yet", () => {
    expect(heatmapLine("engagement", cells)).toMatch(
      /^For more engagement, your posts do best \w{3} around \d{1,2} [AP]M/,
    );
    expect(heatmapLine("engagement", cells.slice(0, 2))).toBe(
      "Post a few more times and your best hours show up here.",
    );
    const scattered = Array.from({ length: 10 }, (_, i) => ({ weekday: i % 7, hour: i, posts: 1, score: i }));
    expect(heatmapLine("views", scattered)).toMatch(/haven't posted at the same time twice/);
  });
});

describe("formats × topics", () => {
  it("compares each format and topic on the goal's lead metric", () => {
    const matrix = formatTopicMatrix("engagement", data.posts, features, now);
    expect(matrix.metric).toBe("replies");
    expect(matrix.topics.length).toBeGreaterThan(1);
    expect(matrix.topics.length).toBeLessThanOrEqual(5);
    expect(matrix.cells.every((c) => matrix.formats.includes(c.format) && matrix.topics.includes(c.topic))).toBe(true);
    expect(matrix.cells.reduce((n, c) => n + c.posts, 0)).toBeLessThanOrEqual(data.posts.length);
    expect(matrixLine(matrix)).toMatch(/(do best|stands out)/);
  });

  it("waits for labels", () => {
    const empty = formatTopicMatrix("views", data.posts, new Map(), now);
    expect(empty.cells).toEqual([]);
    expect(matrixLine(empty)).toMatch(/once your posts are labelled/);
  });
});

describe("posts", () => {
  it("lists posts newest first with their labels and numbers", () => {
    const rows = postRows(data.posts, features, now);
    expect(rows).toHaveLength(data.posts.length);
    expect(rows[0].timestamp >= rows[1].timestamp).toBe(true);
    expect(rows.some((r) => r.formatLabel && r.topic)).toBe(true);
    expect(rows.every((r) => r.engagementRate >= 0 && r.outperformance >= 0)).toBe(true);
    expect(postsLine(rows)).toMatch(/^Your standout got [\d.]+× your usual views: “/);
    expect(postsLine([])).toBe("Your posts show up here, each against your usual numbers.");
  });

  it("formats days and snippets", () => {
    expect(dayLabel("2026-10-03")).toBe("Oct 3");
    expect(snippet("one\n\ntwo   three", 40)).toBe("one two three");
    expect(snippet("x".repeat(80), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

it("handles a post with no metrics yet", () => {
  const fresh: PostWithInsights = {
    ...data.posts[0],
    id: "fresh",
    timestamp: now.toISOString(),
    insights: { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 },
  };
  const rows = postRows([fresh], new Map(), now);
  expect(rows[0]).toMatchObject({ settled: false, engagementRate: 0, format: null });
});
