import { featureLabel, GOAL_METRICS, performanceFacts } from "@/lib/analysis/facts";
import type { PostFeatures } from "@/lib/analysis/formats";
import { engagementRate, median } from "@/lib/analysis/metrics";
import { type RankedPost, rankHours, topPosts } from "@/lib/analysis/summary";
import { hourLabel } from "@/lib/analysis/time";
import { formatMetric } from "@/lib/format";
import type { Goal } from "@/lib/goals";
import type { PostWithInsights, ThreadsProfile } from "@/lib/threads/types";
import type { ProfileDna } from "./dna-prompt";

// Everything the writer should know about this author, distilled from their
// own posts, their labels and their Profile DNA. Pure functions, so they're
// easy to test and reason about.

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
  /** Plain-language facts for the goal, e.g. "Questions get 3.3× your typical reply rate (5 posts)." */
  insights: string[];
  /** The voice guide from Profile DNA, when there is one. */
  dna: VoiceGuide | null;
  /** The author's own topic closest to the one asked for, if any. */
  matchedTopic: string | null;
  /** How many exemplars are about the matched topic. */
  onTopicExemplars: number;
}

export interface VoiceGuide {
  postsAnalyzed: number;
  headline: string;
  descriptors: string[];
  signaturePhrases: string[];
  habits: string[];
  guide: string[];
  /** Claims with the measurement behind each. */
  rewards: string[];
  blindSpots: string[];
}

function share(posts: PostWithInsights[], test: (p: PostWithInsights) => boolean): number {
  return posts.length ? posts.filter(test).length / posts.length : 0;
}

export function voiceStats(posts: PostWithInsights[]): VoiceStats {
  return {
    posts: posts.length,
    medianLength: Math.round(median(posts.map((p) => p.text.length))),
    emojiShare: share(posts, (p) => EMOJI.test(p.text)),
    questionShare: share(posts, (p) => p.text.includes("?")),
    lowercaseShare: share(posts, (p) => /^[a-z]/.test(p.text)),
    lineBreakShare: share(posts, (p) => p.text.includes("\n")),
  };
}

/**
 * Facts the model can cite in its rationales: only differences the author's
 * own numbers show, on the metrics that matter for the goal.
 */
export function insightsFor(
  goal: Goal,
  posts: PostWithInsights[],
  features: ReadonlyMap<string, PostFeatures>,
  now: Date,
): string[] {
  const facts = performanceFacts(posts, features, now, { metrics: GOAL_METRICS[goal], limit: 6 }).map((f) => f.text);
  if (posts.length >= 5) {
    facts.push(
      `Typical engagement rate: ${formatMetric(median(posts.map((p) => engagementRate(p.insights))), "percent")}.`,
    );
  }
  return facts;
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*/gu) ?? [];
const STOP_WORDS = new Set("a an and about at for how in is it my of on our the to what why with your".split(" "));

/**
 * The author's topic that best matches what was asked for: an exact match,
 * else the most-used topic sharing a word with the request.
 */
export function matchTopic(requested: string | undefined, features: ReadonlyMap<string, PostFeatures>): string | null {
  const wanted = requested?.trim().toLowerCase();
  if (!wanted) return null;
  const counts = new Map<string, number>();
  for (const f of features.values()) if (f.topic) counts.set(f.topic, (counts.get(f.topic) ?? 0) + 1);
  const asked = new Set(words(wanted).filter((w) => w.length >= 2 && !STOP_WORDS.has(w)));
  const exact = (topic: string) => topic.toLowerCase() === wanted;
  const [best] = [...counts]
    .filter(([topic]) => exact(topic) || words(topic).some((w) => asked.has(w)))
    .sort((a, b) => Number(exact(b[0])) - Number(exact(a[0])) || b[1] - a[1]);
  return best?.[0] ?? null;
}

function summarize(post: PostWithInsights, features: PostFeatures | undefined): string {
  const i = post.insights;
  const numbers = `${formatMetric(i.views, "compact")} views, ${i.likes} likes, ${i.replies} replies, ${i.reposts + i.quotes} reposts/quotes`;
  const label = featureLabel(features);
  return label ? `${label}; ${numbers}` : numbers;
}

export function voiceGuide(dna: ProfileDna): VoiceGuide {
  return {
    postsAnalyzed: dna.postsAnalyzed,
    headline: dna.headline,
    descriptors: dna.voice.descriptors,
    signaturePhrases: dna.voice.signaturePhrases,
    habits: dna.voice.habits,
    guide: dna.guide,
    rewards: dna.rewards.map((r) => `${r.claim} (${r.fact.text.replace(/\.$/, "")})`),
    blindSpots: dna.blindSpots.map((b) => `${b.claim} (${b.fact.text.replace(/\.$/, "")})`),
  };
}

/** Studio drafts that beat the author's usual at 3 days (lib/publishing/scorecard.ts). */
export interface WinningDraft {
  postId: string;
  /** Views against the usual at 3 days. */
  score: number;
}

/** Winners pinned among the exemplars, at most. */
const MAX_WINNER_EXEMPLARS = 2;

/**
 * Best exemplars for the goal. With a matched topic, up to three come from
 * that topic, but only from the author's better half: a weak post on the
 * right topic is still a weak example. Then up to two of Studio's own drafts
 * that beat the author's usual, so what worked feeds the next batch.
 */
function pickExemplars(
  ranked: RankedPost[],
  features: ReadonlyMap<string, PostFeatures>,
  topic: string | null,
  winners: PostWithInsights[],
  count = 5,
): { exemplars: PostWithInsights[]; onTopic: number } {
  const betterHalf = ranked.slice(0, Math.ceil(ranked.length / 2)).map((r) => r.post);
  const onTopic = topic ? betterHalf.filter((p) => features.get(p.id)?.topic === topic).slice(0, 3) : [];
  // A winner can still be settling (it's scored from 54 hours), so it isn't necessarily ranked.
  const pinned = winners.filter((p) => !onTopic.includes(p)).slice(0, MAX_WINNER_EXEMPLARS);
  const first = [...onTopic, ...pinned];
  return {
    exemplars: [...first, ...ranked.map((r) => r.post).filter((p) => !first.includes(p))].slice(0, count),
    onTopic: onTopic.length,
  };
}

export function buildContext(input: {
  goal: Goal;
  profile: GenerationContext["profile"];
  posts: PostWithInsights[];
  timeZone: string;
  now: Date;
  features?: ReadonlyMap<string, PostFeatures>;
  dna?: ProfileDna | null;
  /** What the user asked to write about. */
  topic?: string;
  winners?: readonly WinningDraft[];
}): GenerationContext {
  const { goal, posts, timeZone, now } = input;
  const features = input.features ?? new Map<string, PostFeatures>();
  const winners = input.winners ?? [];
  const ranked = topPosts(goal, posts, now, posts.length);
  const matchedTopic = matchTopic(input.topic, features);
  const won = new Map(winners.map((w) => [w.postId, w.score]));
  const winningPosts = winners.flatMap((w) => posts.find((p) => p.id === w.postId) ?? []);
  const { exemplars, onTopic } = pickExemplars(ranked, features, matchedTopic, winningPosts);
  const dna = input.dna ? voiceGuide(input.dna) : null;
  // Facts the voice guide already states aren't repeated.
  const stated = new Set([...(input.dna?.rewards ?? []), ...(input.dna?.blindSpots ?? [])].map((c) => c.fact.text));
  return {
    profile: input.profile,
    voice: voiceStats(posts),
    exemplars: exemplars.map((post) => {
      const summary = summarize(post, features.get(post.id));
      const score = won.get(post.id);
      return {
        text: post.text,
        summary: score
          ? `${summary}; drafted in Threaded, ${formatMetric(score, "multiplier")} their usual views at 3 days`
          : summary,
      };
    }),
    weakest: ranked.length >= 8 ? ranked.slice(-3).map(({ post }) => post.text) : [],
    recent: [...posts]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 15)
      .map((p) => p.text),
    bestHours: rankHours(goal, posts, timeZone, now)
      .slice(0, 3)
      .map((h) => hourLabel(h.hour)),
    insights: insightsFor(goal, posts, features, now).filter((fact) => !stated.has(fact)),
    dna,
    matchedTopic,
    onTopicExemplars: onTopic,
  };
}
