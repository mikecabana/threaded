import type { HookType, PostFeatures, PostFormat, Tone } from "@/lib/analysis/formats";
import type { ProfileTopics } from "@/lib/db/schema";

// Post classification (docs/PLAN.md §4c). Jev, a decision model, answers a
// few multiple-choice questions about one post at a time: its format, hook,
// tone and topic. It can't invent labels, so the topic choices are the
// author's own topic list, proposed once by a fast model (./topics-prompt.ts).
// Labels are stored per post and classifier version, so a post is classified
// once per version.

/** Bump to re-classify every post (old labels stay, keyed by version). v1: a fast LLM, 20 posts per call. */
export const CLASSIFIER_VERSION = 2;
/** TypeSafe AI's Jev, through AI Gateway. */
export const CLASSIFIER_MODEL = "typesafe-ai/jev";
/** Answers less sure than this (on any question) are re-decided by the fast model, through the Gateway. */
export const FALLBACK_BELOW = 0.4;
/** Posts decided at once. */
export const CLASSIFY_CONCURRENCY = 10;

export const FORMAT_CRITERIA: Record<PostFormat, string> = {
  hot_take: "A strong or contrarian opinion",
  question: "Mainly asks the audience something",
  story: "Something that happened, told personally",
  list: "Several items or steps",
  tip: "One practical piece of advice",
  observation: "A remark, update or reflection",
  series: "Explicitly part of a numbered series",
};

export const HOOK_CRITERIA: Record<HookType, string> = {
  question: "Opens with a question",
  bold_claim: "Opens with a bold or surprising claim",
  number: "Opens with a figure or a count",
  story_opener: "Drops straight into a moment",
  how_to: "Opens by promising how to do something",
  confession: "Opens with an admission",
  callout: "Addresses the reader directly",
  observation: "Opens with a plain observation",
};

export const TONE_CRITERIA: Record<Tone, string> = {
  playful: "Light, funny or teasing",
  earnest: "Sincere and straightforward",
  contrarian: "Pushes against a common view",
  analytical: "Reasoned, data or argument driven",
  vulnerable: "Personal and exposed",
  celebratory: "Sharing a win or good news",
  frustrated: "Annoyed or venting",
  neutral: "Matter-of-fact",
};

const OTHER = "other";
const topicKey = (index: number) => `t${index + 1}`;

/** The questions asked about every post. Without a topic list, topic isn't asked. */
export function classifyQuestions(topics: ProfileTopics["list"]) {
  const base = {
    format: { type: "choice", instructions: "What kind of Threads post is this?", criteria: FORMAT_CRITERIA },
    hook: { type: "choice", instructions: "How does the first line try to grab attention?", criteria: HOOK_CRITERIA },
    tone: { type: "choice", instructions: "What is the tone of the post?", criteria: TONE_CRITERIA },
  } as const;
  if (topics.length === 0) return base;
  const criteria: Record<string, string> = Object.fromEntries(
    topics.map((t, i) => [topicKey(i), `${t.name}: ${t.description}`]),
  );
  criteria[OTHER] = "None of these";
  return { ...base, topic: { type: "choice", instructions: "What is the post mainly about?", criteria } } as const;
}

type Answer = { type: "choice"; choice: string } | { type: string };

const chosen = (answer: Answer | undefined) =>
  answer?.type === "choice" ? (answer as { choice: string }).choice : null;

/**
 * Labels from Jev's answers. A refused or unknown format means no labels at
 * all (the post stays pending); "other" and refusals elsewhere leave that
 * label empty.
 */
export function readAnswers(answers: Record<string, Answer>, topics: ProfileTopics["list"]): PostFeatures | null {
  const format = chosen(answers.format);
  if (!format || !(format in FORMAT_CRITERIA)) return null;
  const hook = chosen(answers.hook);
  const tone = chosen(answers.tone);
  const topic = chosen(answers.topic);
  const topicIndex = topic && topic !== OTHER ? topics.findIndex((_, i) => topicKey(i) === topic) : -1;
  return {
    format: format as PostFormat,
    topic: topicIndex >= 0 ? topics[topicIndex].name : null,
    hookType: hook && hook in HOOK_CRITERIA ? (hook as HookType) : null,
    tone: tone && tone in TONE_CRITERIA ? (tone as Tone) : null,
  };
}

/** Runs `work` over `items`, at most `limit` at a time, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
