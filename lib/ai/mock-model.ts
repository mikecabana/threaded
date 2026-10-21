import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { Suggestion } from "./schemas";

// Test-only stand-in for a real model (AI_MOCK=1): streams a fixed, valid
// batch of suggestions in small chunks so the whole pipeline (reserve → stream
// → post-process → settle) runs without calling a provider.

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

/** `fail` makes the provider error before streaming anything, to test refunds. */
export function createMockModel(count = 3, modelId = "mock/model", { fail = false } = {}) {
  const json = JSON.stringify({ suggestions: MOCK_SUGGESTIONS.slice(0, count) });
  // ~24-character chunks, so the client sees a realistic stream.
  const deltas = json.match(/[\s\S]{1,24}/g) ?? [json];
  return new MockLanguageModelV4({
    provider: "mock",
    modelId,
    doStream: async () => {
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
