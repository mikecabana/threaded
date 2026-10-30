import { z } from "zod";

// Studio's progress timeline, shown while a batch is written: one line per
// step, the current one with a spinner and the finished ones saying what they
// did. Once the batch is checked, the ideas take its place. Studio sees three
// moments: the response starting (the server has read the author's posts and
// researched the topic by then), the ideas streaming in, and the final check.
// The steps follow those, and the server says what it read before writing in
// the x-threaded-context header, as counts only.

export const CONTEXT_HEADER = "x-threaded-context";

const contextSchema = z.object({
  /** The author's posts the prompt uses as examples. */
  posts: z.number().int().min(0),
  /** Whether the prompt had their Profile DNA. */
  dna: z.boolean(),
  /** What the topic's research read: null without a topic, or when the research failed. */
  research: z.object({ threads: z.number().int().min(0), web: z.number().int().min(0) }).nullable(),
});

export type BatchContext = z.infer<typeof contextSchema>;

export const contextHeader = (context: BatchContext) => JSON.stringify(context);

/** The header's counts, or null when it's missing (the demo) or can't be read. */
export function readContextHeader(value: string | null): BatchContext | null {
  if (!value) return null;
  try {
    const parsed = contextSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface ProgressStep {
  id: "context" | "research" | "write" | "check";
  state: "active" | "done";
  text: string;
}

export interface ProgressInput {
  phase: "streaming" | "finalizing" | "done" | "error";
  /** The topic researched before writing, or null when the batch has no research. */
  topic: string | null;
  /** Whether the research also reads Threads posts. */
  threadsSearch: boolean;
  /** Whether the response has started. */
  responded: boolean;
  context: BatchContext | null;
  shape: "post" | "thread";
  /** Ideas asked for. */
  count: number;
  /** Ideas streamed so far. */
  streamed: number;
  /** Ideas written, once writing has finished. */
  wrote: number | null;
  /** Only an account's ideas are checked and saved; the demo's aren't. */
  checks: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function readText(context: BatchContext | null): string {
  if (!context) return "Read your best posts";
  const dna = context.dna ? " and your Profile DNA" : "";
  if (context.posts === 0) return context.dna ? "Read your Profile DNA" : "Read your profile";
  return context.posts === 1 ? `Read your best post${dna}` : `Read your ${context.posts} best posts${dna}`;
}

function researchText(topic: string, research: BatchContext["research"]): string {
  if (!research) return `Couldn't look up “${topic}” this time`;
  const read = [
    research.threads > 0 ? `${plural(research.threads, "post")} on Threads` : null,
    research.web > 0 ? plural(research.web, "web page") : null,
  ].filter(Boolean);
  return read.length === 0
    ? `Looked up “${topic}”: nothing recent to add`
    : `Read ${read.join(" and ")} about “${topic}”`;
}

/**
 * The timeline's lines, in order. Only steps that have started are listed; a
 * step that was running when the batch failed is left off (the error says why),
 * and a finished batch has none: its ideas show instead.
 */
export function progressSteps(input: ProgressInput): ProgressStep[] {
  const { phase, topic } = input;
  if (phase === "done") return [];
  if (!input.responded) {
    if (phase !== "streaming") return [];
    const text = topic
      ? input.threadsSearch
        ? `Looking up “${topic}” on Threads and the web…`
        : `Checking the web for “${topic}”…`
      : "Reading your best posts…";
    return [{ id: topic ? "research" : "context", state: "active", text }];
  }

  const steps: ProgressStep[] = [{ id: "context", state: "done", text: readText(input.context) }];
  if (topic) steps.push({ id: "research", state: "done", text: researchText(topic, input.context?.research ?? null) });

  const noun = input.shape === "thread" ? "thread" : "idea";
  // A model may write more than it was asked for; the check keeps no more than that, so neither do the counts.
  const wrote = input.wrote === null ? null : Math.min(input.wrote, input.count);
  if (wrote !== null) {
    steps.push({ id: "write", state: "done", text: `Wrote ${plural(wrote, noun)}` });
  } else if (phase === "streaming") {
    const current = Math.min(Math.max(input.streamed, 1), input.count);
    steps.push({ id: "write", state: "active", text: `Writing ${noun} ${current} of ${input.count}…` });
  }

  if (input.checks && wrote !== null && phase === "finalizing") {
    const them = wrote === 1 ? "it" : "them";
    steps.push({ id: "check", state: "active", text: `Checking ${them} against your posts and voice settings…` });
  }
  return steps;
}
