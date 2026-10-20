import { createTextStreamResponse } from "ai";
import { DEMO_PERSONAS, type DemoPersonaId } from "@/lib/demo/personas";
import { GOALS } from "@/lib/goals";
import type { GenerateRequest, SuggestionBatch } from "./schemas";

/**
 * Demo visitors get the persona's hand-written ideas, streamed the same way a
 * real generation is, so Studio feels real without calling (or paying for) a
 * model. The active goal's ideas come first, topped up from the other goals.
 */
export function demoGenerationResponse(personaId: DemoPersonaId, request: GenerateRequest): Response {
  const persona = DEMO_PERSONAS[personaId];
  const ordered = [request.goal, ...GOALS.filter((g) => g !== request.goal)].flatMap((g) => persona.suggestions[g]);
  const batch: SuggestionBatch = {
    suggestions: ordered.slice(0, request.count).map((s) => ({
      text: s.text,
      format: s.format,
      hook: s.hook,
      rationale: s.rationale,
      goalFit: s.goalFit,
      bestSlot: s.bestSlot,
    })),
  };
  const chunks = JSON.stringify(batch).match(/[\s\S]{1,18}/g) ?? [];
  const stream = new ReadableStream<string>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
        await new Promise((resolve) => setTimeout(resolve, 18));
      }
      controller.close();
    },
  });
  return createTextStreamResponse({ stream, headers: { "x-threaded-demo": "1", "cache-control": "no-store" } });
}
