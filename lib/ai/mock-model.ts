import { simulateReadableStream } from "ai";
import { Experimental_DecisionMockModelV4, MockLanguageModelV4 } from "ai/test";
import type { PostFormat } from "@/lib/analysis/formats";
import type { AiTask } from "./catalog";
import type { DnaOutput } from "./dna-prompt";
import { THREAD_RULES } from "./prompt";
import type { Suggestion } from "./schemas";
import type { TopicsOutput } from "./topics-prompt";

// Test-only stand-ins for real models (AI_MOCK=1). Studio's generations
// stream a fixed, valid batch of suggestions in small chunks, so the whole
// pipeline (reserve → stream → post-process → settle) runs without a
// provider. Everything else answers from what it's given: topics come from
// the posts' own words, the decision model (standing in for Jev) labels each
// post with simple rules, and the DNA cites real fact ids.

export const MOCK_SUGGESTIONS: Suggestion[] = [
  {
    text: "What's one habit that quietly made you better at your job this year?",
    parts: [],
    format: "question",
    hook: "Everyone has an answer, and it's flattering to share.",
    rationale: "Your questions get the most replies of anything you post.",
    goalFit: 91,
    bestSlot: { weekday: 2, hour: 9 },
  },
  {
    text: "Hot take: most productivity advice is just procrastination with better branding.",
    parts: [],
    format: "hot_take",
    hook: "A line people want to quote, agree or not.",
    rationale: "Contrarian one-liners travel furthest for you.",
    goalFit: 84,
    bestSlot: { weekday: 3, hour: 19 },
  },
  {
    text: "Three things I stopped doing this year:\n\n1. Checking email first thing\n2. Saying yes by default\n3. Working past 7pm",
    parts: [],
    format: "list",
    hook: "Lists promise quick value.",
    rationale: "Your lists get reposted more than your other formats.",
    goalFit: 78,
    bestSlot: { weekday: 4, hour: 12 },
  },
  {
    text: "Shipped the smallest possible version today. It already taught me more than a month of planning.",
    parts: [],
    format: "story",
    hook: "A tiny, relatable win.",
    rationale: "Short building stories land well with your audience.",
    goalFit: 72,
    bestSlot: { weekday: 1, hour: 17 },
  },
  {
    text: "Tip: write the announcement post before you build the feature. If it's boring, so is the feature.",
    parts: [],
    format: "tip",
    hook: "Useful in one sentence.",
    rationale: "Practical tips are your most saved posts.",
    goalFit: 69,
    bestSlot: { weekday: 5, hour: 9 },
  },
];

/** The rest of each mock idea when it's asked for a thread (lib/ai/prompt.ts THREAD_RULES). */
export const MOCK_THREAD_PARTS: string[][] = [
  ["Mine: a one-line plan before I open my inbox.", "Reply with yours. I'll share the best ones next week."],
  [
    "Most of it sells you a system for avoiding the work.",
    "The boring version works: fewer projects, one list, earlier nights.",
  ],
  ["Email first thing meant reacting all day.", "Saying yes by default filled my week with other people's priorities."],
  ["The plan said six weeks. The first users found the real problem on day two.", "Ship the small thing first."],
  ["If you can't make the post exciting, users won't be either.", "It takes ten minutes and saves a month."],
];

/** The mock's batch: single posts, or threads when the prompt asks for them. */
function mockBatch(prompt: string, count: number) {
  const thread = prompt.includes(THREAD_RULES[0]);
  return {
    suggestions: MOCK_SUGGESTIONS.slice(0, count).map((s, i) => ({ ...s, parts: thread ? MOCK_THREAD_PARTS[i] : [] })),
  };
}

function usage(input: number, output: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

/** Every prompt the mock received, newest last, so tests can see what a model would have been told. */
export const mockCalls: { task: AiTask; prompt: string }[] = [];

function record(task: AiTask, prompt: string) {
  mockCalls.push({ task, prompt });
  if (mockCalls.length > 50) mockCalls.shift();
}

type PromptMessage = { role: string; content: string | { type: string; text?: string }[] };

function promptText(prompt: PromptMessage[]): string {
  return prompt
    .map((m) => (typeof m.content === "string" ? m.content : m.content.map((part) => part.text ?? "").join("")))
    .join("\n");
}

function mockFormat(text: string): PostFormat {
  if (/^(hot take|unpopular opinion)/i.test(text)) return "hot_take";
  if (/\n\s*\d+[.)]/.test(text)) return "list";
  if (text.includes("?")) return "question";
  if (/^tip\b|\bhow to\b/i.test(text)) return "tip";
  if (/\b(I|I'm|my|we)\b/.test(text)) return "story";
  return "observation";
}

/** A post's topic, for the mock: its first word of six letters or more. */
const topicWord = (text: string) => text.toLowerCase().match(/[a-z]{6,}/)?.[0] ?? null;

/** Topics from a topics prompt: each numbered post's first long word, existing topics kept. */
export function mockTopics(prompt: string): TopicsOutput {
  const words = [...prompt.matchAll(/^\[\d+\] """([\s\S]*?)"""$/gm)].map(([, text]) => topicWord(text));
  const names = [...new Set(words.filter((w): w is string => w !== null))].slice(0, 8);
  return { topics: names.map((name) => ({ name, description: `Posts about ${name}` })) };
}

/** Every decision the mock made: the post's text and the questions asked. */
export const mockDecisions: { state: string; questions: string[] }[] = [];

type Criteria = Record<string, unknown>;

/**
 * Stands in for Jev: answers format, hook and tone with simple rules, and
 * picks the topic whose name appears in the post (else "other").
 */
export function createMockDecisionModel(modelId = "mock/decision", { fail = false } = {}) {
  return new Experimental_DecisionMockModelV4({
    provider: "mock",
    modelId,
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doDecide: async ({ state, questions }) => {
      const text = state.map((part) => ("text" in part ? part.text : JSON.stringify(part))).join("\n");
      mockDecisions.push({ state: text, questions: Object.keys(questions) });
      if (mockDecisions.length > 200) mockDecisions.shift();
      if (fail) throw new Error("Mock provider failure");
      const lower = text.toLowerCase();
      const topicCriteria = (questions.topic as { criteria?: Criteria } | undefined)?.criteria ?? {};
      const topic =
        Object.entries(topicCriteria).find(([, label]) => {
          const name = String(label).split(":")[0];
          return name !== "None of these" && lower.includes(name.toLowerCase());
        })?.[0] ?? "other";
      const answers: Record<string, { type: "choice"; choice: string }> = {
        format: { type: "choice", choice: mockFormat(text) },
        hook: { type: "choice", choice: text.trim().endsWith("?") ? "question" : "bold_claim" },
        tone: { type: "choice", choice: "neutral" },
        ...(questions.topic ? { topic: { type: "choice" as const, choice: topic } } : {}),
      };
      return {
        answers,
        usage: { inputTokens: 300, outputTokens: 20 },
        warnings: [],
        response: { modelId },
      };
    },
  });
}

/** A DNA built from the prompt: rewards cite the facts above 1×, blind spots the ones below. */
export function mockDna(prompt: string): DnaOutput {
  const facts = [...prompt.matchAll(/^(F\d+) .*?(?:(\d+(?:\.\d)?)×|almost no)/gm)].map(([, id, multiplier]) => ({
    id,
    multiplier: multiplier ? Number(multiplier) : 0,
  }));
  const topics = [...prompt.matchAll(/^- ([^:\n]+): \d+ posts/gm)].map(([, name]) => name);
  const firstPost = prompt.match(/^1\. """(\S+ \S+)/m)?.[1];
  return {
    headline: "You're at your best keeping it short and direct.",
    descriptors: ["direct", "plain-spoken", "curious"],
    signaturePhrases: [...(firstPost ? [firstPost] : []), "synergy at scale"],
    habits: ["Keeps posts short", "Rarely uses emoji"],
    guide: ["Lead with the point.", "Ask one real question at the end.", "Skip the hashtags."],
    rewards: facts
      .filter((f) => f.multiplier > 1)
      .slice(0, 2)
      .map((f) => ({ fact: f.id, claim: "Your audience shows up for this." })),
    blindSpots: facts
      .filter((f) => f.multiplier < 1)
      .slice(0, 1)
      .map((f) => ({ fact: f.id, claim: "This lands softer than the rest." })),
    coreTopics: topics.slice(0, 2),
  };
}

/** What the mock researcher says about the Threads posts in its prompt, if there are any. */
function mockThreadsSummary(prompt: string): string | null {
  const posts = prompt.match(/^\[\d+\] @/gm)?.length ?? 0;
  return posts
    ? `${posts} posts (mock summary): most warn people to patch, a few call it overblown. Nobody says what it took to patch.`
    : null;
}

/**
 * Topic research (./research-prompt.ts), with the Gateway's search run inside
 * the call as it is for real. Mock rules: a topic of plain lowercase words
 * ("morning routines") is a broad theme and skips the search; one with "zzz"
 * finds nothing reliable; one with "fail" makes the provider error. Threads
 * posts in the prompt get a summary.
 */
function mockResearch(prompt: string) {
  const topic = prompt.match(/^Topic: (.+)$/m)?.[1]?.trim() ?? "";
  const threads = mockThreadsSummary(prompt);
  if (/fail/i.test(topic)) throw new Error("Mock search failure");
  if (/^[a-z ]+$/.test(topic) && topic.includes(" ")) {
    return [{ type: "text" as const, text: threads ? `THREADS: ${threads}` : "SKIP" }];
  }
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const results = /zzz/i.test(topic)
    ? []
    : [
        {
          title: `${topic}: what happened this week`,
          url: `https://news.example.com/${slug}`,
          snippet: `Coverage of ${topic}.`,
          date: "2026-10-20",
        },
        {
          title: `Explainer: ${topic}`,
          url: `https://blog.example.org/${slug}-explained`,
          snippet: `What ${topic} is and why it matters.`,
          date: "2026-10-21",
        },
      ];
  return [
    {
      type: "tool-call" as const,
      toolCallId: "search-1",
      toolName: "web_search",
      input: JSON.stringify({ query: `${topic} news` }),
      providerExecuted: true,
    },
    {
      type: "tool-result" as const,
      toolCallId: "search-1",
      toolName: "web_search",
      result: { id: "mock-search", results },
    },
    {
      type: "text" as const,
      text: [
        `FACTS: ${
          results.length
            ? `${topic} is a security flaw disclosed on 2026-10-20 (mock brief). Patches shipped the next day.`
            : "NOTHING RELIABLE FOUND"
        }`,
        threads ? `THREADS: ${threads}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

/**
 * `fail` makes the provider error before answering, to test refunds and
 * failure handling.
 */
export function createMockModel(
  count = 3,
  modelId = "mock/model",
  { fail = false, task = "generate" }: { fail?: boolean; task?: AiTask } = {},
) {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (options) => {
      const prompt = promptText(options.prompt as PromptMessage[]);
      record(task, prompt);
      if (fail) throw new Error("Mock provider failure");
      if (task === "research") {
        return {
          content: mockResearch(prompt),
          finishReason: { unified: "stop", raw: undefined },
          usage: usage(2500, 120),
          warnings: [],
        };
      }
      const answer =
        task === "dna" ? mockDna(prompt) : task === "classify" ? mockTopics(prompt) : mockBatch(prompt, count);
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(1500, 300),
        warnings: [],
      };
    },
    doStream: async (options) => {
      const prompt = promptText(options.prompt as PromptMessage[]);
      record(task, prompt);
      if (fail) throw new Error("Mock provider failure");
      const json = JSON.stringify(mockBatch(prompt, count));
      // ~24-character chunks, so the client sees a realistic stream.
      const deltas = json.match(/[\s\S]{1,24}/g) ?? [json];
      return {
        stream: simulateReadableStream({
          initialDelayInMs: 50,
          chunkDelayInMs: 15,
          chunks: [
            { type: "text-start", id: "t" },
            ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: usage(1200, 400) },
          ],
        }),
      };
    },
  });
}

/**
 * The evals' judge (lib/evals/eval.ts): grades every numbered idea in the
 * prompt, a little lower for longer ones, so scores are deterministic.
 */
export function createMockJudgeModel(modelId = "mock/judge") {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (options) => {
      const prompt = promptText(options.prompt as PromptMessage[]);
      const ideas = [...prompt.matchAll(/^(\d+)\. """([\s\S]*?)"""$/gm)];
      const answer = {
        ideas: ideas.map(([, index, text]) => ({
          index: Number(index),
          voice: text.length > 200 ? 3 : 4,
          goalFit: 4,
          note: "Sounds like them.",
        })),
        summary: "A solid batch.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(2000, 200),
        warnings: [],
      };
    },
  });
}
