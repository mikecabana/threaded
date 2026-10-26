import { formatMetric } from "@/lib/format";
import { GOAL_META, type Goal } from "@/lib/goals";
import type { AccountDay, PostWithInsights } from "@/lib/threads/types";
import { type FactMetric, GOAL_METRICS, METRIC_PHRASE, MIN_FACT_POSTS, metricValue } from "./facts";
import { FORMAT_LABELS, type PostFeatures, type PostFormat } from "./formats";
import { engagementRate, goalScores, isSettled, median, outperformance } from "./metrics";
import { hourLabel, weekdayName, zonedParts } from "./time";

// The Insights page's numbers, and the plain-English line under each chart.
// Pure functions over the same dataset Home uses, so demo and real accounts
// get the same treatment.

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

/** "Oct 12" for a YYYY-MM-DD (UTC) day. */
export function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A post's opening, on one line, for chart annotations and sentences. */
export function snippet(text: string, max = 60): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// ── Trends ───────────────────────────────────────────────────────────────────

export interface TrendPost {
  id: string;
  text: string;
  viaThreaded: boolean;
}

export interface TrendPoint {
  /** YYYY-MM-DD, UTC. */
  date: string;
  value: number;
  /** Posts published that day: the chart's annotations. */
  posts: TrendPost[];
}

function postsByDay(posts: PostWithInsights[]): Map<string, TrendPost[]> {
  const byDay = new Map<string, TrendPost[]>();
  for (const p of posts) {
    const day = p.timestamp.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), { id: p.id, text: p.text, viaThreaded: Boolean(p.viaThreaded) }]);
  }
  return byDay;
}

/** Daily views, with each day's posts. */
export function viewsTrend(days: AccountDay[], posts: PostWithInsights[]): TrendPoint[] {
  const byDay = postsByDay(posts);
  return days.map((d) => ({ date: d.date, value: d.views, posts: byDay.get(d.date) ?? [] }));
}

/**
 * Daily follower counts from the first real snapshot on: Threads only reports
 * today's count, so earlier days can't be filled in.
 */
export function followersTrend(days: AccountDay[], posts: PostWithInsights[]): TrendPoint[] {
  const byDay = postsByDay(posts);
  const first = days.findIndex((d) => d.followersMeasured !== false);
  if (first < 0) return [];
  return days.slice(first).map((d) => ({ date: d.date, value: d.followersCount, posts: byDay.get(d.date) ?? [] }));
}

/** The post most likely behind a day's spike: that day's or the day before's, by views. */
function postBehind(date: string, posts: PostWithInsights[]): PostWithInsights | null {
  const dayBefore = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const candidates = posts.filter((p) => [date, dayBefore].includes(p.timestamp.slice(0, 10)));
  return candidates.sort((a, b) => b.insights.views - a.insights.views)[0] ?? null;
}

export function viewsLine(days: AccountDay[], posts: PostWithInsights[]): string {
  if (days.length < 7) return "Your daily views show up here after a week of data.";
  const recent = days.slice(-30);
  const before = days.slice(-60, -30);
  const total = sum(recent.map((d) => d.views));
  const previous = sum(before.map((d) => d.views));
  const parts = [`${formatMetric(total, "compact")} views in the last ${recent.length} days`];
  if (before.length >= 30 && previous > 0) {
    const change = (total - previous) / previous;
    if (Math.abs(change) < 0.05) parts.push(", about the same as the 30 days before");
    else
      parts.push(`, ${change > 0 ? "up" : "down"} ${formatMetric(Math.abs(change), "percent")} on the 30 days before`);
  }
  let line = `${parts.join("")}.`;
  const best = [...recent].sort((a, b) => b.views - a.views)[0];
  if (best && best.views > 0) {
    const post = postBehind(best.date, posts);
    line += ` Your best day was ${dayLabel(best.date)} (${formatMetric(best.views, "compact")} views)`;
    line += post ? `, after “${snippet(post.text, 50)}”.` : ".";
  }
  return line;
}

export function followersLine(trend: TrendPoint[], posts: PostWithInsights[]): string {
  if (trend.length === 0) return "Follower counts show up here after your next sync.";
  const latest = trend[trend.length - 1];
  if (trend.length < 7) {
    return `${formatMetric(latest.value, "number")} followers. Threads only shares today's count, so we started tracking on ${dayLabel(trend[0].date)} and growth fills in day by day.`;
  }
  const window = trend.slice(-31);
  const change = latest.value - window[0].value;
  let line =
    change === 0
      ? `${formatMetric(latest.value, "number")} followers, level over the last ${window.length - 1} days.`
      : `${change > 0 ? "+" : "−"}${formatMetric(Math.abs(change), "number")} followers in the last ${window.length - 1} days, now ${formatMetric(latest.value, "number")}.`;
  let jump = { date: "", gain: 0 };
  for (let i = 1; i < window.length; i++) {
    const gain = window[i].value - window[i - 1].value;
    if (gain > jump.gain) jump = { date: window[i].date, gain };
  }
  if (jump.gain > 0) {
    const post = postBehind(jump.date, posts);
    line += ` The biggest jump, +${jump.gain}, came on ${dayLabel(jump.date)}`;
    line += post ? `, after “${snippet(post.text, 50)}”.` : ".";
  }
  return line;
}

// ── Best hours ───────────────────────────────────────────────────────────────

export interface HeatCell {
  /** 0 = Sunday, in the profile's timezone. */
  weekday: number;
  hour: number;
  posts: number;
  /** Mean goal score of the cell's posts, against the author's other posts. */
  score: number;
}

/** When the author's settled posts went out, by weekday and hour, and how they scored for the goal. */
export function weekHeatmap(goal: Goal, posts: PostWithInsights[], timeZone: string, now: Date): HeatCell[] {
  const settled = posts.filter((p) => isSettled(p, now));
  const scores = goalScores(goal, settled);
  const cells = new Map<string, { weekday: number; hour: number; scores: number[] }>();
  for (const post of settled) {
    const { weekday, hour } = zonedParts(new Date(post.timestamp), timeZone);
    const key = `${weekday}:${hour}`;
    const cell = cells.get(key) ?? { weekday, hour, scores: [] };
    cell.scores.push(scores.get(post.id) ?? 0);
    cells.set(key, cell);
  }
  return [...cells.values()].map(({ weekday, hour, scores: s }) => ({
    weekday,
    hour,
    posts: s.length,
    score: Math.round((sum(s) / s.length) * 100) / 100,
  }));
}

export function heatmapLine(goal: Goal, cells: HeatCell[]): string {
  const measured = sum(cells.map((c) => c.posts));
  if (measured < MIN_FACT_POSTS) return "Post a few more times and your best hours show up here.";
  const repeated = cells.filter((c) => c.posts >= 2).sort((a, b) => b.score - a.score);
  const best = repeated[0];
  const busiest = [...cells].sort((a, b) => b.posts - a.posts)[0];
  const goalName = GOAL_META[goal].label.toLowerCase();
  if (!best) {
    return `Based on ${measured} posts. You haven't posted at the same time twice yet, so there's no pattern for ${goalName} to read.`;
  }
  let line = `For ${goalName}, your posts do best ${weekdayName(best.weekday)} around ${hourLabel(best.hour)} (${best.posts} posts).`;
  if (busiest && (busiest.weekday !== best.weekday || busiest.hour !== best.hour)) {
    line += ` You post most often ${weekdayName(busiest.weekday)} around ${hourLabel(busiest.hour)}.`;
  }
  return line;
}

// ── Formats × topics ─────────────────────────────────────────────────────────

export interface MatrixCell {
  format: PostFormat;
  topic: string;
  posts: number;
  /** The cell's median on the goal's metric over the author's median; null without measured posts. */
  multiplier: number | null;
}

export interface FormatTopicMatrix {
  metric: FactMetric;
  formats: PostFormat[];
  topics: string[];
  cells: MatrixCell[];
}

/** How each format performs on each of the author's main topics, on the goal's lead metric. */
export function formatTopicMatrix(
  goal: Goal,
  posts: PostWithInsights[],
  features: ReadonlyMap<string, PostFeatures>,
  now: Date,
  maxTopics = 5,
): FormatTopicMatrix {
  const metric = GOAL_METRICS[goal][0];
  const labelled = posts.filter((p) => features.get(p.id)?.topic);
  const count = <T>(values: T[]) => {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const topics = count(labelled.map((p) => features.get(p.id)?.topic as string)).slice(0, maxTopics);
  const formats = count(labelled.map((p) => features.get(p.id)?.format as PostFormat));
  const baseline = median(posts.filter((p) => isSettled(p, now)).map((p) => metricValue(metric, p.insights)));

  const cells: MatrixCell[] = [];
  for (const format of formats) {
    for (const topic of topics) {
      const members = labelled.filter((p) => {
        const f = features.get(p.id);
        return f?.format === format && f.topic === topic;
      });
      if (members.length === 0) continue;
      const measured = members.filter((p) => isSettled(p, now)).map((p) => metricValue(metric, p.insights));
      cells.push({
        format,
        topic,
        posts: members.length,
        multiplier: measured.length && baseline > 0 ? Math.round((median(measured) / baseline) * 100) / 100 : null,
      });
    }
  }
  return { metric, formats: formats.filter((f) => cells.some((c) => c.format === f)), topics, cells };
}

const FORMAT_PLURAL: Record<PostFormat, string> = {
  hot_take: "Hot takes",
  question: "Questions",
  story: "Stories",
  list: "Lists",
  tip: "Tips",
  observation: "Observations",
  series: "Series posts",
};

export function matrixLine(matrix: FormatTopicMatrix): string {
  if (matrix.cells.length === 0)
    return "Formats and topics show up here once your posts are labelled, shortly after a sync.";
  const solid = matrix.cells.filter((c) => c.posts >= 2 && c.multiplier !== null);
  const best = [...solid].sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0))[0];
  const worst = [...solid].sort((a, b) => (a.multiplier ?? 0) - (b.multiplier ?? 0))[0];
  const baseline = METRIC_PHRASE[matrix.metric].baseline;
  if (!best || (best.multiplier ?? 0) < 1.3) {
    return `No format and topic pair stands out on ${baseline} yet. Keep mixing them; this fills in as you post.`;
  }
  let line = `${FORMAT_PLURAL[best.format]} about ${best.topic} do best: ${formatMetric(best.multiplier ?? 0, "multiplier")} ${baseline} (${best.posts} posts).`;
  if (worst && worst !== best && (worst.multiplier ?? 1) <= 0.77) {
    line += ` ${FORMAT_PLURAL[worst.format]} about ${worst.topic} lag at ${formatMetric(worst.multiplier ?? 0, "multiplier")}.`;
  }
  return line;
}

// ── Posts ────────────────────────────────────────────────────────────────────

export interface PostRow {
  id: string;
  text: string;
  timestamp: string;
  permalink: string;
  format: PostFormat | null;
  formatLabel: string | null;
  topic: string | null;
  views: number;
  likes: number;
  replies: number;
  /** Reposts plus quotes. */
  reposts: number;
  engagementRate: number;
  /** Views against the median of the 30 posts before it. */
  outperformance: number;
  /** Still collecting views (under 72 hours old). */
  settled: boolean;
  viaThreaded: boolean;
}

export function postRows(posts: PostWithInsights[], features: ReadonlyMap<string, PostFeatures>, now: Date): PostRow[] {
  return [...posts]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .map((p) => {
      const f = features.get(p.id);
      return {
        id: p.id,
        text: p.text,
        timestamp: p.timestamp,
        permalink: p.permalink,
        format: f?.format ?? null,
        formatLabel: f ? FORMAT_LABELS[f.format] : null,
        topic: f?.topic ?? null,
        views: p.insights.views,
        likes: p.insights.likes,
        replies: p.insights.replies,
        reposts: p.insights.reposts + p.insights.quotes,
        engagementRate: engagementRate(p.insights),
        outperformance: Math.round(outperformance(p, posts) * 10) / 10,
        settled: isSettled(p, now),
        viaThreaded: Boolean(p.viaThreaded),
      };
    });
}

export function postsLine(rows: PostRow[]): string {
  const settled = rows.filter((r) => r.settled);
  if (settled.length === 0) return "Your posts show up here, each against your usual numbers.";
  const top = [...settled].sort((a, b) => b.outperformance - a.outperformance)[0];
  const recent = settled.slice(0, 30);
  const beat = recent.filter((r) => r.outperformance > 1).length;
  let line = `Your standout got ${formatMetric(top.outperformance, "multiplier")} your usual views: “${snippet(top.text, 50)}”.`;
  if (recent.length >= 5) line += ` ${beat} of your last ${recent.length} posts beat your median.`;
  return line;
}
