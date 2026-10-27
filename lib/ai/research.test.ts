import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "./catalog";
import { buildContext } from "./context";
import { chargeBatch, RESEARCH_USAGE, researchCredits, SEARCH_USD } from "./cost";
import { createMockModel } from "./mock-model";
import type { ResolvedModel } from "./models";
import { buildInstructions, buildPrompt, PROMPT_VERSION } from "./prompt";
import { researchTopic } from "./research";
import {
  MAX_BRIEF,
  MAX_SOURCES,
  type Research,
  readResearch,
  readSearches,
  researchInstructions,
  researchPrompt,
} from "./research-prompt";
import { generateRequestSchema } from "./schemas";

const now = new Date("2026-10-27T12:00:00Z");
const [haiku, sonnet] = DEFAULT_CATALOG;
const author = { username: "maya.builds", biography: "Building Tidy", topics: ["shipping", "security"] };

const call = (query: unknown) => ({ type: "tool-call", toolName: "web_search", input: { query } });
const result = (results: unknown) => ({ type: "tool-result", toolName: "web_search", output: { id: "r", results } });
const hit = (n: number, extra: Record<string, unknown> = {}) => ({
  title: `Result ${n}`,
  url: `https://site${n}.example.com/a`,
  snippet: "…",
  date: "2026-10-20",
  ...extra,
});

describe("reading a research call", () => {
  it("collects the queries and the results, once each", () => {
    const { queries, sources } = readSearches([
      call("php2shell exploit"),
      result([hit(1), hit(2, { date: undefined, lastUpdated: "2026-10-22" })]),
      call(["php2shell patch", "php2shell cve"]),
      result([hit(1), hit(3, { title: "" }), { title: "Bad", url: "javascript:alert(1)" }]),
      { type: "text" },
    ]);
    expect(queries).toEqual(["php2shell exploit", "php2shell patch", "php2shell cve"]);
    expect(sources).toEqual([
      { title: "Result 1", url: "https://site1.example.com/a", date: "2026-10-20" },
      { title: "Result 2", url: "https://site2.example.com/a", date: "2026-10-22" },
      { title: "site3.example.com", url: "https://site3.example.com/a", date: "2026-10-20" },
    ]);
  });

  it("ignores failed searches and keeps a handful of sources", () => {
    const failed = { type: "tool-result", toolName: "web_search", output: { error: "timeout", message: "Timed out" } };
    expect(readSearches([call("x"), failed]).sources).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => hit(i));
    expect(readSearches([call("x"), result(many)]).sources).toHaveLength(MAX_SOURCES);
  });

  it("only briefs the writer when a search found something reliable", () => {
    const searched = [call("php2shell"), result([hit(1)])];
    expect(readResearch([], "SKIP")).toMatchObject({ queries: [], brief: null, sources: [] });
    expect(readResearch(searched, "NOTHING RELIABLE FOUND")).toMatchObject({
      queries: ["php2shell"],
      brief: null,
      sources: [],
    });
    expect(readResearch([call("php2shell"), result([])], "It's a PHP flaw.")).toMatchObject({ brief: null });
    expect(readResearch(searched, " It's a PHP flaw. ")).toMatchObject({
      brief: "It's a PHP flaw.",
      sources: [hit(1)].map(({ title, url, date }) => ({ title, url, date })),
    });

    const long = readResearch(searched, "word ".repeat(400)).brief ?? "";
    expect(long.length).toBeLessThanOrEqual(MAX_BRIEF + 1);
    expect(long.endsWith("word…")).toBe(true);
  });

  it("tells the researcher today's date and who the author is", () => {
    expect(researchInstructions(now)).toContain("Today is 2026-10-27.");
    expect(researchPrompt("php2shell", author)).toBe(
      [
        "Topic: php2shell",
        "",
        "The author, for context (it tells you which meaning of the topic they'd care about):",
        "@maya.builds: Building Tidy",
        "They usually post about: shipping, security.",
      ].join("\n"),
    );
  });
});

describe("research in the generation prompt", () => {
  const context = buildContext({
    goal: "engagement",
    profile: { username: "maya.builds", name: "Maya", biography: "" },
    posts: [],
    timeZone: "America/Toronto",
    now,
    topic: "php2shell",
  });
  const request = generateRequestSchema.parse({ goal: "engagement", topic: "php2shell" });
  const research = (brief: string | null, queries = ["php2shell exploit"]): Research => ({
    version: "research.v1",
    queries,
    brief,
    sources: [],
  });

  it("puts the brief right before the ask, with rules for using it", () => {
    const prompt = buildPrompt(request, context, research("php2shell is a PHP flaw disclosed on 20 October."));
    expect(prompt).toContain('What\'s happening with "php2shell", from a web search today:\nphp2shell is a PHP flaw');
    expect(prompt).toContain("don't claim the author made or did anything they don't say");
    expect(prompt.indexOf("php2shell is a PHP flaw")).toBeLessThan(prompt.indexOf("Write 3 new post ideas."));
  });

  it("says when the search found nothing, and stays quiet when there was no search", () => {
    expect(buildPrompt(request, context, research(null))).toContain(
      'A web search for "php2shell" found nothing reliable, so don\'t assume what it is.',
    );
    expect(buildPrompt(request, context, research(null, []))).not.toContain("web search");
    expect(buildPrompt(request, context)).not.toContain("web search");
  });

  it("never lets the writer guess at an unfamiliar name (v4)", () => {
    expect(PROMPT_VERSION).toBe("generate.v4");
    expect(buildInstructions(request)).toContain("Guessing what an unfamiliar name or term is");
  });
});

describe("research costs", () => {
  it("estimates a typical search well under the worst case it reserves", () => {
    expect(researchCredits(haiku, "typical")).toBe(2);
    expect(researchCredits(haiku, "max")).toBeGreaterThan(researchCredits(haiku, "typical"));
    expect(RESEARCH_USAGE.max.searches * SEARCH_USD).toBe(0.01);
  });

  it("charges for research only when a search ran, never past the reserve", () => {
    const research = { entry: haiku, costUsd: 0.008, searches: 1 };
    expect(chargeBatch({ entry: sonnet, costUsd: 0.012, reserved: 20 })).toBe(2);
    expect(chargeBatch({ entry: sonnet, costUsd: 0.012, research, reserved: 20 })).toBe(4);
    expect(chargeBatch({ entry: sonnet, costUsd: 0.012, research: { ...research, searches: 0 }, reserved: 20 })).toBe(
      2,
    );
    expect(chargeBatch({ entry: sonnet, costUsd: 0.012, research, reserved: 3 })).toBe(3);
  });
});

describe("researchTopic", () => {
  const resolved = (modelId = haiku.modelId): ResolvedModel => ({
    model: createMockModel(5, modelId, { task: "research" }),
    entry: haiku,
    billing: "credits",
    providerOptions: { gateway: {} },
    gateway: null,
  });

  it("searches, briefs and prices a specific topic", async () => {
    const run = await researchTopic({ topic: "php2shell", author, resolved: resolved(), now });
    expect(run?.searches).toBe(1);
    expect(run?.research.sources.map((s) => s.url)).toEqual([
      "https://news.example.com/php2shell",
      "https://blog.example.org/php2shell-explained",
    ]);
    // Without the Gateway's figure: 2,500 + 120 tokens on the fast tier, plus one search.
    expect(run?.costUsd).toBeCloseTo(0.0025 + 0.0006 + SEARCH_USD, 6);
  });

  it("returns nothing when the call fails, so the batch goes on without it", async () => {
    expect(await researchTopic({ topic: "fail", author, resolved: resolved(), now })).toBeNull();
  });
});
