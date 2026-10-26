import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AiTask } from "./catalog";
import type { Classification } from "./classify-prompt";
import type { DnaOutput } from "./dna-prompt";
import type { Suggestion } from "./schemas";

// Test-only stand-in for a real model (AI_MOCK=1). Studio's generations
// stream a fixed, valid batch of suggestions in small chunks, so the whole
// pipeline (reserve → stream → post-process → settle) runs without a
// provider. Classification and Profile DNA answer from the prompt itself:
// every numbered post gets plausible labels, and the DNA cites real fact ids.

export const MOCK_SUGGESTIONS: Suggestion[] = [
  {
    text: "What's one habit that quietly made you better at your job this year?",
    format: "question",
    hook: "Everyone has an answer, and it's flattering to share.",
    rationale: "Your questions get the most replies of anything you post.",
    goalFit: 91,
    bestSlot: { weekday: 2, hour: 9 },
  },
  {
    text: "Hot take: most productivity advice is just procrastination with better branding.",
    format: "hot_take",
    hook: "A line people want to quote, agree or not.",
    rationale: "Contrarian one-liners travel furthest for you.",
    goalFit: 84,
    bestSlot: { weekday: 3, hour: 19 },
  },
  {
    text: "Three things I stopped doing this year:\n\n1. Checking email first thing\n2. Saying yes by default\n3. Working past 7pm",
    format: "list",
    hook: "Lists promise quick value.",
    rationale: "Your lists get reposted more than your other formats.",
    goalFit: 78,
    bestSlot: { weekday: 4, hour: 12 },
  },
  {
    text: "Shipped the smallest possible version today. It already taught me more than a month of planning.",
    format: "story",
    hook: "A tiny, relatable win.",
    rationale: "Short building stories land well with your audience.",
    goalFit: 72,
    bestSlot: { weekday: 1, hour: 17 },
  },
  {
    text: "Tip: write the announcement post before you build the feature. If it's boring, so is the feature.",
    format: "tip",
    hook: "Useful in one sentence.",
    rationale: "Practical tips are your most saved posts.",
    goalFit: 69,
    bestSlot: { weekday: 5, hour: 9 },
  },
];

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

function mockFormat(text: string): Classification["posts"][number]["format"] {
  if (/^(hot take|unpopular opinion)/i.test(text)) return "hot_take";
  if (/\n\s*\d+[.)]/.test(text)) return "list";
  if (text.includes("?")) return "question";
  if (/^tip\b|\bhow to\b/i.test(text)) return "tip";
  if (/\b(I|I'm|my|we)\b/.test(text)) return "story";
  return "observation";
}

/** Labels every numbered post in a classification prompt: topic is its first long word. */
export function mockClassification(prompt: string): Classification {
  const posts = [...prompt.matchAll(/^\[(\d+)\] """([\s\S]*?)"""$/gm)].map(([, n, text]) => {
    const word = text.toLowerCase().match(/[a-z]{6,}/)?.[0] ?? "life";
    return {
      n: Number(n),
      format: mockFormat(text),
      topic: word,
      hookType: text.trim().endsWith("?") ? ("question" as const) : ("bold_claim" as const),
      tone: "neutral" as const,
    };
  });
  return { posts };
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

/**
 * `fail` makes the provider error before answering, to test refunds and
 * failure handling.
 */
export function createMockModel(
  count = 3,
  modelId = "mock/model",
  { fail = false, task = "generate" }: { fail?: boolean; task?: AiTask } = {},
) {
  const json = JSON.stringify({ suggestions: MOCK_SUGGESTIONS.slice(0, count) });
  // ~24-character chunks, so the client sees a realistic stream.
  const deltas = json.match(/[\s\S]{1,24}/g) ?? [json];
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doGenerate: async (options) => {
      const prompt = promptText(options.prompt as PromptMessage[]);
      record(task, prompt);
      if (fail) throw new Error("Mock provider failure");
      const answer =
        task === "dna" ? mockDna(prompt) : task === "classify" ? mockClassification(prompt) : { suggestions: [] };
      return {
        content: [{ type: "text", text: JSON.stringify(answer) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(1500, 300),
        warnings: [],
      };
    },
    doStream: async (options) => {
      record(task, promptText(options.prompt as PromptMessage[]));
      if (fail) throw new Error("Mock provider failure");
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
