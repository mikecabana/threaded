import "server-only";
import { gateway, generateText, stepCountIs } from "ai";
import { costUsd, SEARCH_USD } from "./cost";
import { gatewayCostUsd, type ResolvedModel } from "./models";
import {
  MAX_SEARCHES,
  type Research,
  type ResearchAuthor,
  readResearch,
  researchInstructions,
  researchPrompt,
  SEARCH_RESULTS,
  TOKENS_PER_PAGE,
} from "./research-prompt";

// Runs a topic's web research (./research-prompt.ts) on the research model,
// with the Gateway's Perplexity Search as a tool the model can call. The
// Gateway runs the search inside the call, so one call usually covers both
// the search and the brief; the step limit allows for providers that answer
// in a second step.

export interface ResearchRun {
  research: Research;
  /** What the research cost us in USD, searches included. */
  costUsd: number;
  /** Searches that ran (each one has a fee). */
  searches: number;
}

/** Researches a Studio topic. Never throws: without research, the batch is written without it. */
export async function researchTopic(input: {
  topic: string;
  author: ResearchAuthor;
  resolved: ResolvedModel;
  now: Date;
  signal?: AbortSignal;
}): Promise<ResearchRun | null> {
  const { resolved } = input;
  try {
    const result = await generateText({
      model: resolved.model,
      instructions: researchInstructions(input.now),
      prompt: researchPrompt(input.topic, input.author),
      tools: {
        web_search: gateway.tools.perplexitySearch({
          maxResults: SEARCH_RESULTS,
          maxTokensPerPage: TOKENS_PER_PAGE,
          maxTokens: SEARCH_RESULTS * TOKENS_PER_PAGE,
        }),
      },
      stopWhen: stepCountIs(MAX_SEARCHES + 1),
      maxOutputTokens: 400,
      providerOptions: resolved.providerOptions,
      abortSignal: input.signal,
    });
    const parts = result.steps.flatMap((step) => step.content);
    const research = readResearch(parts, result.text);
    const searches = parts.filter((part) => part.type === "tool-call").length;
    const gatewayIds = result.steps.map(
      (step) => (step.providerMetadata?.gateway as { generationId?: string } | undefined)?.generationId,
    );
    const cost =
      (await gatewayCostUsd(resolved, gatewayIds)) ??
      costUsd(resolved.entry, result.totalUsage.inputTokens ?? 0, result.totalUsage.outputTokens ?? 0) +
        searches * SEARCH_USD;
    return { research, costUsd: cost, searches };
  } catch (error) {
    if (!input.signal?.aborted) {
      console.error(`Web research failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}
