import type { MetricFormat } from "@/lib/format";
import type { Goal } from "@/lib/goals";
import type { AccountDay, PostWithInsights } from "@/lib/threads/types";
import { engagements, goalScores, isSettled, median, outperformance } from "./metrics";
import { hourLabel, zonedParts, zonedTimeToUtc } from "./time";

const DAY_MS = 86_400_000;

export interface Kpi {
  id: KpiId;
  label: string;
  hint: string;
  value: number;
  format: MetricFormat;
  /** null when there's no comparable previous period. */
  delta: number | null;
  deltaKind: "percent" | "points" | "absolute";
  /** Oldest → newest, for the sparkline. */
  series: number[];
}

export type KpiId =
  | "views7d"
  | "followers"
  | "newFollowers7d"
  | "engagementRate"
  | "repliesPerPost"
  | "viewsPerPost"
  | "amplification";

/** Which KPIs lead for each goal; the first is the goal's north star. */
export const GOAL_KPIS: Record<Goal, KpiId[]> = {
  engagement: ["engagementRate", "repliesPerPost", "views7d", "followers"],
  views: ["views7d", "viewsPerPost", "amplification", "followers"],
  followers: ["newFollowers7d", "followers", "amplification", "views7d"],
};

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

function pctChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

function postsBetween(posts: PostWithInsights[], from: number, to: number) {
  return posts.filter((p) => {
    const t = Date.parse(p.timestamp);
    return t >= from && t < to;
  });
}

export function buildKpis(goal: Goal, posts: PostWithInsights[], days: AccountDay[], now: Date): Kpi[] {
  const last30 = days.slice(-30);
  const t = now.getTime();
  const recent = postsBetween(posts, t - 30 * DAY_MS, t);
  const previous = postsBetween(posts, t - 60 * DAY_MS, t - 30 * DAY_MS);
  const followersAt = (offsetFromEnd: number) => days.at(-1 - offsetFromEnd)?.followersCount ?? 0;

  const pooledRate = (list: PostWithInsights[]) => {
    const views = sum(list.map((p) => p.insights.views));
    return views > 0 ? sum(list.map((p) => engagements(p.insights))) / views : 0;
  };
  const meanReplies = (list: PostWithInsights[]) =>
    list.length ? sum(list.map((p) => p.insights.replies)) / list.length : 0;
  const amplified = (list: PostWithInsights[]) => sum(list.map((p) => p.insights.reposts + p.insights.quotes));

  const views7 = sum(days.slice(-7).map((d) => d.views));
  const viewsPrev7 = sum(days.slice(-14, -7).map((d) => d.views));
  const newFollowers7 = followersAt(0) - followersAt(7);
  const newFollowersPrev7 = followersAt(7) - followersAt(14);
  const previousRate = pooledRate(previous);

  const all: Record<KpiId, Kpi> = {
    views7d: {
      id: "views7d",
      label: "Views (7d)",
      hint: "Total views across your profile and posts, last 7 days.",
      value: views7,
      format: "compact",
      delta: pctChange(views7, viewsPrev7),
      deltaKind: "percent",
      series: last30.map((d) => d.views),
    },
    followers: {
      id: "followers",
      label: "Followers",
      hint: "Current followers, change over 30 days.",
      value: followersAt(0),
      format: "number",
      delta: days.length > 30 ? followersAt(0) - followersAt(30) : null,
      deltaKind: "absolute",
      series: last30.map((d) => d.followersCount),
    },
    newFollowers7d: {
      id: "newFollowers7d",
      label: "New followers (7d)",
      hint: "Net followers gained in the last 7 days.",
      value: newFollowers7,
      format: "number",
      delta: pctChange(newFollowers7, newFollowersPrev7),
      deltaKind: "percent",
      series: last30.map((d, i) => (i === 0 ? 0 : d.followersCount - last30[i - 1].followersCount)).slice(1),
    },
    engagementRate: {
      id: "engagementRate",
      label: "Engagement rate",
      hint: "Likes, replies, reposts and quotes per view, posts from the last 30 days.",
      value: pooledRate(recent),
      format: "percent",
      delta: previous.length ? pooledRate(recent) - previousRate : null,
      deltaKind: "points",
      series: last30.map((d) => (d.views > 0 ? (d.likes + d.replies + d.reposts + d.quotes) / d.views : 0)),
    },
    repliesPerPost: {
      id: "repliesPerPost",
      label: "Replies / post",
      hint: "Average replies per post, last 30 days.",
      value: meanReplies(recent),
      format: "decimal",
      delta: pctChange(meanReplies(recent), meanReplies(previous)),
      deltaKind: "percent",
      series: last30.map((d) => d.replies),
    },
    viewsPerPost: {
      id: "viewsPerPost",
      label: "Views / post",
      hint: "Median views per post, last 30 days.",
      value: median(recent.map((p) => p.insights.views)),
      format: "compact",
      delta: pctChange(median(recent.map((p) => p.insights.views)), median(previous.map((p) => p.insights.views))),
      deltaKind: "percent",
      series: [...posts]
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-30)
        .map((p) => p.insights.views),
    },
    amplification: {
      id: "amplification",
      label: "Reposts + quotes",
      hint: "How often people passed your posts on, last 30 days.",
      value: amplified(recent),
      format: "number",
      delta: pctChange(amplified(recent), amplified(previous)),
      deltaKind: "percent",
      series: last30.map((d) => d.reposts + d.quotes),
    },
  };

  return GOAL_KPIS[goal].map((id) => all[id]);
}

export interface RankedPost {
  post: PostWithInsights;
  score: number;
  outperformance: number;
}

/** Best settled posts for the goal, scored against each other. */
export function topPosts(goal: Goal, posts: PostWithInsights[], now: Date, limit = 3): RankedPost[] {
  const settled = posts.filter((p) => isSettled(p, now));
  const scores = goalScores(goal, settled);
  return settled
    .map((post) => ({ post, score: scores.get(post.id) ?? 0, outperformance: outperformance(post, posts) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface BestTime {
  hour: number;
  day: "today" | "tomorrow";
  label: string;
  /** When the slot starts, UTC ISO. */
  startsAt: string;
}

function slotLabel(hour: number): string {
  const [start, startSuffix] = hourLabel(hour).split(" ");
  const end = hourLabel(hour + 1);
  return end.endsWith(startSuffix) ? `${start}–${end}` : `${hourLabel(hour)}–${end}`;
}

/**
 * The hour (in the profile's timezone) whose posts score best for the goal.
 * Prefers one of the top three hours if it's still ahead today, otherwise the
 * best hour tomorrow. Hours need at least two posts to count.
 */
export function bestTimeToPost(goal: Goal, posts: PostWithInsights[], timeZone: string, now: Date): BestTime | null {
  const settled = posts.filter((p) => isSettled(p, now));
  const scores = goalScores(goal, settled);
  const byHour = new Map<number, number[]>();
  for (const post of settled) {
    const { hour } = zonedParts(new Date(post.timestamp), timeZone);
    byHour.set(hour, [...(byHour.get(hour) ?? []), scores.get(post.id) ?? 0]);
  }
  const ranked = [...byHour.entries()]
    .filter(([, s]) => s.length >= 2)
    .map(([hour, s]) => ({ hour, score: sum(s) / s.length }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;

  const local = zonedParts(now, timeZone);
  const today = ranked.slice(0, 3).find((r) => r.hour > local.hour);
  const pick = today ?? ranked[0];
  const day = today ? local : zonedParts(new Date(now.getTime() + DAY_MS), timeZone);
  const startsAt = zonedTimeToUtc(
    { year: day.year, month: day.month, day: day.day, hour: pick.hour, minute: 0 },
    timeZone,
  );
  return {
    hour: pick.hour,
    day: today ? "today" : "tomorrow",
    label: slotLabel(pick.hour),
    startsAt: startsAt.toISOString(),
  };
}
