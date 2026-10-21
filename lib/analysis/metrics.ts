import type { Goal } from "@/lib/goals";
import type { PostInsights, PostWithInsights } from "@/lib/threads/types";

// Social metrics are heavy-tailed, so everything here uses median/MAD rather
// than mean/stddev, and log-transforms view counts before scoring.

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median absolute deviation. */
export function mad(values: number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * How far `value` sits from the population's typical value, in robust units
 * (comparable to a z-score for normal data). 0 when the population has no spread.
 */
export function robustZ(value: number, population: number[]): number {
  const spread = mad(population);
  if (spread === 0) return 0;
  return (0.6745 * (value - median(population))) / spread;
}

function rate(numerator: number, views: number): number {
  return views > 0 ? numerator / views : 0;
}

export const engagements = (i: PostInsights) => i.likes + i.replies + i.reposts + i.quotes;
export const engagementRate = (i: PostInsights) => rate(engagements(i), i.views);
export const replyRate = (i: PostInsights) => rate(i.replies, i.views);
export const likeRate = (i: PostInsights) => rate(i.likes, i.views);
export const quoteRate = (i: PostInsights) => rate(i.quotes, i.views);
export const amplificationRate = (i: PostInsights) => rate(i.reposts + i.quotes + i.shares, i.views);

/** Posts younger than this are still collecting views and are left out of scoring. */
export const SETTLING_HOURS = 72;

export function isSettled(post: PostWithInsights, now: Date): boolean {
  return now.getTime() - Date.parse(post.timestamp) >= SETTLING_HOURS * 3_600_000;
}

type Component = { weight: number; value: (i: PostInsights) => number };

/**
 * Goal playbook scoring (docs/PLAN.md §4b). "More Followers" also has an
 * estimated follow-lift component from daily follower deltas; until Phase 2
 * computes it, the remaining weights are renormalized.
 */
export const GOAL_COMPONENTS: Record<Goal, Component[]> = {
  views: [
    { weight: 0.7, value: (i) => Math.log1p(i.views) },
    { weight: 0.3, value: amplificationRate },
  ],
  engagement: [
    { weight: 0.5, value: replyRate },
    { weight: 0.3, value: likeRate },
    { weight: 0.2, value: quoteRate },
  ],
  followers: [
    { weight: 0.4, value: amplificationRate },
    { weight: 0.3, value: (i) => Math.log1p(i.views) },
  ],
};

/** Goal score for each post, relative to the other posts in `posts`. */
export function goalScores(goal: Goal, posts: PostWithInsights[]): Map<string, number> {
  const components = GOAL_COMPONENTS[goal];
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const populations = components.map((c) => posts.map((p) => c.value(p.insights)));
  const scores = new Map<string, number>();
  for (const post of posts) {
    let score = 0;
    components.forEach((c, idx) => {
      score += (c.weight / totalWeight) * robustZ(c.value(post.insights), populations[idx]);
    });
    scores.set(post.id, score);
  }
  return scores;
}

/** Views relative to the median of the (up to) 30 posts published before it. */
export function outperformance(post: PostWithInsights, allPosts: PostWithInsights[]): number {
  const before = allPosts
    .filter((p) => p.timestamp < post.timestamp)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 30)
    .map((p) => p.insights.views);
  const baseline = median(before);
  return baseline > 0 ? post.insights.views / baseline : 1;
}
