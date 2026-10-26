import { formatMetric } from "@/lib/format";
import type { Goal } from "@/lib/goals";
import type { PostInsights, PostWithInsights } from "@/lib/threads/types";
import { FORMAT_LABELS, HOOK_LABELS, type HookType, type PostFeatures, type PostFormat, type Tone } from "./formats";
import { amplificationRate, engagementRate, isSettled, median, replyRate } from "./metrics";

// What the author's own numbers say works, as checkable facts: "Hot takes get
// 2.8× your median views (9 posts)." Profile DNA and the generation prompt
// only make claims that point at one of these, so every number shown to the
// user or the model comes from here, never from a model.

export type FactMetric = "views" | "replies" | "engagement" | "amplification";

export type Trait = "question" | "short" | "long" | "link" | "media" | "emoji";

export type FactSubject =
  | { kind: "format"; value: PostFormat }
  | { kind: "topic"; value: string }
  | { kind: "hook"; value: HookType }
  | { kind: "tone"; value: Tone }
  | { kind: "trait"; value: Trait };

export interface Fact {
  /** Stable within one list ("F1", "F2", …), so a model can cite it. */
  id: string;
  subject: FactSubject;
  metric: FactMetric;
  /** The group's median over the author's overall median. */
  multiplier: number;
  /** Posts in the group. */
  posts: number;
  text: string;
}

/** Fewer settled posts than this and the numbers say nothing reliable. */
export const MIN_FACT_POSTS = 10;
/** A group needs this many posts, and so does everything outside it. */
const MIN_GROUP = 3;
/** Differences smaller than this (either way) aren't worth stating. */
const NOTABLE = 1.3;
const EMOJI = /\p{Extended_Pictographic}/u;
const SHORT_POST = 140;

const METRIC_VALUE: Record<FactMetric, (i: PostInsights) => number> = {
  views: (i) => i.views,
  replies: replyRate,
  engagement: engagementRate,
  amplification: amplificationRate,
};

/** A post's value on one metric (views, or a per-view rate). */
export const metricValue = (metric: FactMetric, insights: PostInsights) => METRIC_VALUE[metric](insights);

export const METRIC_PHRASE: Record<FactMetric, { baseline: string; noun: string }> = {
  views: { baseline: "your median views", noun: "views" },
  replies: { baseline: "your typical reply rate", noun: "replies" },
  engagement: { baseline: "your typical engagement rate", noun: "engagement" },
  amplification: { baseline: "your typical repost rate", noun: "reposts" },
};

/** The metrics that matter for each goal, most important first. */
export const GOAL_METRICS: Record<Goal, FactMetric[]> = {
  views: ["views", "amplification"],
  engagement: ["replies", "engagement"],
  followers: ["amplification", "views"],
};

const FORMAT_PLURALS: Record<PostFormat, string> = {
  hot_take: "Hot takes",
  question: "Questions",
  story: "Stories",
  list: "Lists",
  tip: "Tips",
  observation: "Observations",
  series: "Series posts",
};

const TRAIT_PHRASES: Record<Trait, string> = {
  question: "Posts that ask a question",
  short: `Short posts (${SHORT_POST} characters or less)`,
  long: `Longer posts (over ${SHORT_POST} characters)`,
  link: "Posts with a link",
  media: "Posts with an image or video",
  emoji: "Posts with emoji",
};

/** How a fact's subject reads at the start of a sentence. */
export function subjectPhrase(subject: FactSubject): string {
  switch (subject.kind) {
    case "format":
      return FORMAT_PLURALS[subject.value];
    case "topic":
      return `Posts about ${subject.value}`;
    case "hook":
      return `Posts that ${HOOK_LABELS[subject.value].replace(/^Opens/, "open").toLowerCase()}`;
    case "tone":
      return `${subject.value[0].toUpperCase()}${subject.value.slice(1)} posts`;
    case "trait":
      return TRAIT_PHRASES[subject.value];
  }
}

export function factText(subject: FactSubject, metric: FactMetric, multiplier: number, posts: number): string {
  const { baseline, noun } = METRIC_PHRASE[metric];
  const claim =
    multiplier < 0.15 ? `get almost no ${noun}` : `get ${formatMetric(multiplier, "multiplier")} ${baseline}`;
  return `${subjectPhrase(subject)} ${claim} (${posts} posts).`;
}

function traitsOf(post: PostWithInsights): Trait[] {
  const traits: Trait[] = [post.text.length <= SHORT_POST ? "short" : "long"];
  if (post.text.includes("?")) traits.push("question");
  if (/https?:\/\//i.test(post.text)) traits.push("link");
  if (post.mediaType !== "TEXT_POST") traits.push("media");
  if (EMOJI.test(post.text)) traits.push("emoji");
  return traits;
}

function subjectsOf(post: PostWithInsights, features: PostFeatures | undefined): FactSubject[] {
  const subjects: FactSubject[] = traitsOf(post).map((value) => ({ kind: "trait", value }));
  if (features) {
    subjects.push({ kind: "format", value: features.format });
    if (features.topic) subjects.push({ kind: "topic", value: features.topic });
    if (features.hookType) subjects.push({ kind: "hook", value: features.hookType });
    if (features.tone && features.tone !== "neutral") subjects.push({ kind: "tone", value: features.tone });
  }
  return subjects;
}

const keyOf = (subject: FactSubject) => `${subject.kind}:${subject.value}`;
/** Short and long are two sides of one comparison: state only the stronger. */
const familyOf = (subject: FactSubject) =>
  subject.kind === "trait" && (subject.value === "short" || subject.value === "long") ? "trait:length" : keyOf(subject);
/** On a tie, the more specific subject wins ("Questions" over "Posts that ask a question"). */
const KIND_ORDER: Record<FactSubject["kind"], number> = { format: 0, hook: 1, topic: 2, tone: 3, trait: 4 };

/**
 * Notable differences in how the author's posts perform, strongest first.
 * Only settled posts count, groups need at least three posts on each side, and
 * a subject gets at most two facts (its strongest metrics).
 */
export function performanceFacts(
  posts: PostWithInsights[],
  features: ReadonlyMap<string, PostFeatures>,
  now: Date,
  { metrics = Object.keys(METRIC_VALUE) as FactMetric[], limit = 16 }: { metrics?: FactMetric[]; limit?: number } = {},
): Fact[] {
  const settled = posts.filter((p) => isSettled(p, now));
  if (settled.length < MIN_FACT_POSTS) return [];

  const groups = new Map<string, { subject: FactSubject; posts: PostWithInsights[] }>();
  for (const post of settled) {
    for (const subject of subjectsOf(post, features.get(post.id))) {
      const key = keyOf(subject);
      const group = groups.get(key) ?? { subject, posts: [] };
      group.posts.push(post);
      groups.set(key, group);
    }
  }

  const baselines = new Map(metrics.map((m) => [m, median(settled.map((p) => METRIC_VALUE[m](p.insights)))]));
  const found: (Omit<Fact, "id"> & { strength: number; members: string })[] = [];
  for (const { subject, posts: members } of groups.values()) {
    if (members.length < MIN_GROUP || settled.length - members.length < MIN_GROUP) continue;
    for (const metric of metrics) {
      const baseline = baselines.get(metric) ?? 0;
      if (baseline <= 0) continue;
      const multiplier = median(members.map((p) => METRIC_VALUE[metric](p.insights))) / baseline;
      if (multiplier < NOTABLE && multiplier > 1 / NOTABLE) continue;
      found.push({
        subject,
        metric,
        multiplier: Math.round(multiplier * 100) / 100,
        posts: members.length,
        text: factText(subject, metric, multiplier, members.length),
        // A small edge on many posts can beat a big one on three.
        strength: Math.abs(Math.log(Math.max(multiplier, 0.05))) * Math.sqrt(members.length),
        members: members
          .map((p) => p.id)
          .sort()
          .join(),
      });
    }
  }

  const perSubject = new Map<string, number>();
  const stated = new Set<string>();
  return found
    .sort((a, b) => b.strength - a.strength || KIND_ORDER[a.subject.kind] - KIND_ORDER[b.subject.kind])
    .filter((fact) => {
      // The same posts under two names (every question is also a post that asks one) say one thing.
      const sameGroup = `${fact.metric}|${fact.members}`;
      const sameFamily = `${fact.metric}|${familyOf(fact.subject)}`;
      const key = keyOf(fact.subject);
      if (stated.has(sameGroup) || stated.has(sameFamily) || (perSubject.get(key) ?? 0) >= 2) return false;
      stated.add(sameGroup);
      stated.add(sameFamily);
      perSubject.set(key, (perSubject.get(key) ?? 0) + 1);
      return true;
    })
    .slice(0, limit)
    .map(({ strength: _, members: __, ...fact }, i) => ({ id: `F${i + 1}`, ...fact }));
}

export interface TopicStat {
  name: string;
  posts: number;
  /** Share of the author's classified posts. */
  share: number;
  /** Median views over the author's median (1 when there's no baseline). */
  viewsMultiplier: number;
  engagementMultiplier: number;
  /** How much to trust the multipliers, from the number of posts. */
  confidence: "low" | "medium" | "high";
}

/** The author's topics by how often they post about them, with how each performs. */
export function topicStats(
  posts: PostWithInsights[],
  features: ReadonlyMap<string, PostFeatures>,
  now: Date,
  limit = 8,
): TopicStat[] {
  const classified = posts.filter((p) => features.get(p.id)?.topic);
  if (classified.length === 0) return [];
  const settled = posts.filter((p) => isSettled(p, now));
  const viewsBaseline = median(settled.map((p) => p.insights.views));
  const engagementBaseline = median(settled.map((p) => engagementRate(p.insights)));

  const byTopic = new Map<string, PostWithInsights[]>();
  for (const post of classified) {
    const topic = features.get(post.id)?.topic as string;
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), post]);
  }
  const ratio = (value: number, baseline: number) => (baseline > 0 ? Math.round((value / baseline) * 100) / 100 : 1);

  return [...byTopic.entries()]
    .map(([name, members]) => {
      const measured = members.filter((p) => isSettled(p, now));
      return {
        name,
        posts: members.length,
        share: Math.round((members.length / classified.length) * 100) / 100,
        viewsMultiplier: measured.length ? ratio(median(measured.map((p) => p.insights.views)), viewsBaseline) : 1,
        engagementMultiplier: measured.length
          ? ratio(median(measured.map((p) => engagementRate(p.insights))), engagementBaseline)
          : 1,
        confidence: (measured.length >= 8
          ? "high"
          : measured.length >= 4
            ? "medium"
            : "low") as TopicStat["confidence"],
      };
    })
    .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Labels for a post's features, for prompts: "Hot take · pricing". */
export function featureLabel(features: PostFeatures | undefined): string | null {
  if (!features) return null;
  return [FORMAT_LABELS[features.format], features.topic].filter(Boolean).join(" · ");
}
