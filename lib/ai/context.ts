import { engagementRate, replyRate } from "@/lib/analysis/metrics";
import { rankHours, topPosts } from "@/lib/analysis/summary";
import { hourLabel } from "@/lib/analysis/time";
import { formatMetric } from "@/lib/format";
import type { Goal } from "@/lib/goals";
import type { PostWithInsights, ThreadsProfile } from "@/lib/threads/types";

// Everything the writer should know about this author, distilled from their
// own posts. Pure functions, so they're easy to test and reason about.

const EMOJI = /\p{Extended_Pictographic}/u;

export interface VoiceStats {
  posts: number;
  medianLength: number;
  emojiShare: number;
  questionShare: number;
  lowercaseShare: number;
  lineBreakShare: number;
}

export interface GenerationContext {
  profile: Pick<ThreadsProfile, "username" | "name" | "biography">;
  voice: VoiceStats;
  /** Best posts for the goal, with the numbers that made them work. */
  exemplars: { text: string; summary: string }[];
  /** Weakest posts for the goal: patterns to avoid. */
  weakest: string[];
  /** Recent posts, so suggestions don't repeat them. */
  recent: string[];
  bestHours: string[];
  /** Plain-language facts, e.g. "Questions get 2.9× the replies of other posts." */
  insights: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function share(posts: PostWithInsights[], test: (p: PostWithInsights) => boolean): number {
  return posts.length ? posts.filter(test).length / posts.length : 0;
}

export function voiceStats(posts: PostWithInsights[]): VoiceStats {
  return {
    posts: posts.length,
    medianLength: median(posts.map((p) => p.text.length)),
    emojiShare: share(posts, (p) => EMOJI.test(p.text)),
    questionShare: share(posts, (p) => p.text.includes("?")),
    lowercaseShare: share(posts, (p) => /^[a-z]/.test(p.text)),
    lineBreakShare: share(posts, (p) => p.text.includes("\n")),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Facts the model can cite in its rationales. Only claims the data supports. */
export function insightsFor(posts: PostWithInsights[]): string[] {
  const facts: string[] = [];
  const questions = posts.filter((p) => p.text.includes("?"));
  const others = posts.filter((p) => !p.text.includes("?"));
  if (questions.length >= 3 && others.length >= 3) {
    const ratio =
      mean(questions.map((p) => replyRate(p.insights))) / (mean(others.map((p) => replyRate(p.insights))) || 1);
    if (ratio >= 1.3) facts.push(`Questions get ${formatMetric(ratio, "multiplier")} the replies of other posts.`);
    if (ratio <= 0.77) facts.push("Questions get fewer replies than statements for this author.");
  }
  const short = posts.filter((p) => p.text.length <= 140);
  const long = posts.filter((p) => p.text.length > 140);
  if (short.length >= 3 && long.length >= 3) {
    const ratio = median(short.map((p) => p.insights.views)) / (median(long.map((p) => p.insights.views)) || 1);
    if (ratio >= 1.3)
      facts.push(`Short posts (≤140 characters) get ${formatMetric(ratio, "multiplier")} the views of longer ones.`);
    if (ratio <= 0.77) facts.push(`Longer posts get ${formatMetric(1 / ratio, "multiplier")} the views of short ones.`);
  }
  if (posts.length >= 5) {
    facts.push(
      `Typical engagement rate: ${formatMetric(median(posts.map((p) => engagementRate(p.insights))), "percent")}.`,
    );
  }
  return facts;
}

function summarize(post: PostWithInsights): string {
  const i = post.insights;
  return `${formatMetric(i.views, "compact")} views, ${i.likes} likes, ${i.replies} replies, ${i.reposts + i.quotes} reposts/quotes`;
}

export function buildContext(input: {
  goal: Goal;
  profile: GenerationContext["profile"];
  posts: PostWithInsights[];
  timeZone: string;
  now: Date;
}): GenerationContext {
  const { goal, posts, timeZone, now } = input;
  const ranked = topPosts(goal, posts, now, posts.length);
  return {
    profile: input.profile,
    voice: voiceStats(posts),
    exemplars: ranked.slice(0, 5).map(({ post }) => ({ text: post.text, summary: summarize(post) })),
    weakest: ranked.length >= 8 ? ranked.slice(-3).map(({ post }) => post.text) : [],
    recent: [...posts]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 15)
      .map((p) => p.text),
    bestHours: rankHours(goal, posts, timeZone, now)
      .slice(0, 3)
      .map((h) => hourLabel(h.hour)),
    insights: insightsFor(posts),
  };
}
