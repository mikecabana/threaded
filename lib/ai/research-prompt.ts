// Web research for Studio (docs/PLAN.md §5). Before writing about a topic that
// names something specific or recent (a tool, a release, an exploit, a
// person), a fast model searches the web through the AI Gateway and sums up
// what it finds, so the ideas are about the real thing instead of a guess
// from the author's past posts. Broad, timeless themes skip the search.

export const RESEARCH_VERSION = "research.v1";
/** The search tool's name in the call (the Gateway's Perplexity Search). */
export const SEARCH_TOOL = "web_search";
/** Results per search, and the tokens read from each page. */
export const SEARCH_RESULTS = 5;
export const TOKENS_PER_PAGE = 512;
/** Searches allowed per topic. */
export const MAX_SEARCHES = 2;
/** Sources kept for the writer and shown in Studio. */
export const MAX_SOURCES = 6;
/** The longest brief the writer is given, in characters. */
export const MAX_BRIEF = 1200;

const SKIP = "SKIP";
const NOTHING_FOUND = "NOTHING RELIABLE FOUND";

export interface ResearchSource {
  title: string;
  url: string;
  /** Publication or last-updated date, as the search reported it. */
  date: string | null;
}

export interface Research {
  version: string;
  /** What was searched for. Empty when the topic didn't need a search. */
  queries: string[];
  /** What the writer is told. Null when nothing was searched, or nothing reliable came back. */
  brief: string | null;
  sources: ResearchSource[];
}

export interface ResearchAuthor {
  username: string;
  biography: string;
  /** The author's topics (§4c), so an ambiguous name gets the meaning they'd care about. */
  topics: string[];
}

export function researchInstructions(now: Date): string {
  return [
    `You help a ghostwriter who writes Threads posts for one author. Today is ${now.toISOString().slice(0, 10)}.`,
    "",
    "You get a topic the author wants to post about. Decide whether the ghostwriter needs facts from the web to write about it well:",
    "- Search when the topic names something specific: a product, tool, library, company, person, event, release, vulnerability, law, trend or meme. Search too when it might be recent news, or when you don't recognise it.",
    `- Don't search for broad, timeless themes like "morning routines", "pricing advice" or "hiring". For those, reply with just ${SKIP}.`,
    "",
    `To search, call ${SEARCH_TOOL} with a short query, at most ${MAX_SEARCHES} times. Prefer recent results.`,
    "",
    "Then write a brief for the ghostwriter in at most 120 words: what the thing is, what happened and when (with dates), and what people are saying about it.",
    "Use only facts from the results: no opinions, and no advice on what to post.",
    `If the results don't clearly explain the topic, reply with just ${NOTHING_FOUND}.`,
  ].join("\n");
}

export function researchPrompt(topic: string, author: ResearchAuthor): string {
  const lines = [
    `Topic: ${topic}`,
    "",
    "The author, for context (it tells you which meaning of the topic they'd care about):",
  ];
  lines.push(author.biography ? `@${author.username}: ${author.biography}` : `@${author.username}`);
  if (author.topics.length) lines.push(`They usually post about: ${author.topics.join(", ")}.`);
  return lines.join("\n");
}

type Part = { type: string; toolName?: string; input?: unknown; output?: unknown };

const isWebUrl = (url: unknown): url is string => typeof url === "string" && /^https?:\/\//i.test(url);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The searches a research call made and the results it read, from its steps' content. */
export function readSearches(parts: readonly Part[]): { queries: string[]; sources: ResearchSource[] } {
  const queries: string[] = [];
  const sources: ResearchSource[] = [];
  for (const part of parts) {
    if (part.toolName !== SEARCH_TOOL) continue;
    if (part.type === "tool-call") {
      const query = (part.input as { query?: unknown } | undefined)?.query;
      queries.push(...(Array.isArray(query) ? query : [query]).map(text).filter(Boolean));
    }
    // A failed search comes back as { error, message } instead of results.
    const results = (part.output as { results?: unknown } | undefined)?.results;
    if (part.type !== "tool-result" || !Array.isArray(results)) continue;
    for (const result of results as Record<string, unknown>[]) {
      if (!isWebUrl(result.url) || sources.some((s) => s.url === result.url)) continue;
      const date = text(result.date) || text(result.lastUpdated);
      sources.push({ title: text(result.title) || new URL(result.url).hostname, url: result.url, date: date || null });
    }
  }
  return { queries, sources: sources.slice(0, MAX_SOURCES) };
}

/** What the writer gets from a research call: nothing unless it searched and found something reliable. */
export function readResearch(parts: readonly Part[], answer: string): Research {
  const { queries, sources } = readSearches(parts);
  const brief = answer.trim();
  const usable =
    queries.length > 0 && sources.length > 0 && brief !== "" && !brief.toUpperCase().includes(NOTHING_FOUND);
  return {
    version: RESEARCH_VERSION,
    queries,
    brief: usable && brief !== SKIP ? clip(brief, MAX_BRIEF) : null,
    sources: usable ? sources : [],
  };
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trimEnd()}…`;
}
