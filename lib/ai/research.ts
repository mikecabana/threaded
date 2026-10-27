import "server-only";
import { gateway, generateText, stepCountIs } from "ai";
import { costUsd, RESEARCH_OUTPUT_TOKENS, reportedCostUsd, SEARCH_USD } from "./cost";
import type { ResolvedModel } from "./models";
import {
  MAX_SEARCHES,
  type Research,
  type ResearchAuthor,
  readResearch,
  researchInstructions,
  researchPrompt,
  SEARCH_RESULTS,
  type ThreadsPost,
  TOKENS_PER_PAGE,
} from "./research-prompt";

// Runs a topic's research (./research-prompt.ts) on the research model: it
// reads the Threads posts found for the topic (./threads-search.ts) and can
// call the Gateway's Perplexity Search as a tool. The Gateway runs the search
// inside the call, so one call usually covers both the search and the brief;
// the step limit allows for providers that answer in a second step.

export interface ResearchRun {
  research: Research;
  /** What the research cost us in USD, searches included. */
  costUsd: number;
  /** Searches that ran (each one has a fee). */
  searches: number;
  /** Threads posts the researcher read. */
  threadsPosts: number;
}

/** Researches a Studio topic. Never throws: without research, the batch is written without it. */
export async function researchTopic(input: {
  topic: string;
  author: ResearchAuthor;
  /** Recent popular Threads posts on the topic, if any. */
  posts?: readonly ThreadsPost[];
  resolved: ResolvedModel;
  now: Date;
  signal?: AbortSignal;
}): Promise<ResearchRun | null> {
  const { resolved } = input;
  const posts = input.posts ?? [];
  try {
    const result = await generateText({
      model: resolved.model,
      instructions: researchInstructions(input.now),
      prompt: researchPrompt(input.topic, input.author, posts),
      tools: {
        web_search: gateway.tools.perplexitySearch({
          maxResults: SEARCH_RESULTS,
          maxTokensPerPage: TOKENS_PER_PAGE,
          maxTokens: SEARCH_RESULTS * TOKENS_PER_PAGE,
        }),
      },
      stopWhen: stepCountIs(MAX_SEARCHES + 1),
      maxOutputTokens: RESEARCH_OUTPUT_TOKENS,
      providerOptions: resolved.providerOptions,
      abortSignal: input.signal,
    });
    const parts = result.steps.flatMap((step) => step.content);
    const research = readResearch(parts, result.text, posts);
    const searches = parts.filter((part) => part.type === "tool-call").length;
    // The Gateway reports each step's cost, searches included; without it, tokens at catalog prices plus the fee.
    const reported = result.steps.map((step) => reportedCostUsd(step.providerMetadata));
    const cost = reported.every((usd) => usd !== null)
      ? reported.reduce((sum: number, usd) => sum + (usd ?? 0), 0)
      : costUsd(resolved.entry, result.totalUsage.inputTokens ?? 0, result.totalUsage.outputTokens ?? 0) +
        searches * SEARCH_USD;
    return { research, costUsd: cost, searches, threadsPosts: posts.length };
  } catch (error) {
    if (!input.signal?.aborted) {
      console.error(`Topic research failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}
