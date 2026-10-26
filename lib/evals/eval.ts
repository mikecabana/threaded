import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import type { CatalogEntry } from "@/lib/ai/catalog";
import { buildContext } from "@/lib/ai/context";
import { costUsd, outputTokenBudget } from "@/lib/ai/cost";
import { PLAYBOOKS } from "@/lib/ai/playbooks";
import { DUPLICATE_THRESHOLD, postProcess, similarity } from "@/lib/ai/postprocess";
import { buildInstructions, buildPrompt, PROMPT_VERSION } from "@/lib/ai/prompt";
import { generateRequestSchema, type Suggestion, suggestionBatchSchema } from "@/lib/ai/schemas";
import { demoDna } from "@/lib/demo/dna";
import { demoFeatures, generateDemoDataset } from "@/lib/demo/generate";
import { DEMO_PERSONAS, type DemoPersonaId } from "@/lib/demo/personas";
import { GOAL_META, type Goal } from "@/lib/goals";
import { THREADS_MAX_LENGTH, threadsLength } from "@/lib/threads/length";

// The prompt/model evals (docs/PLAN.md §11): the demo personas go through the
// same context and prompt Studio uses, and the batch is scored. Length and
// repetition are measured; voice and goal fit are graded by a judge model
// that sees the author's real posts. Run before adding a model to the
// catalog (scripts/eval.ts, `pnpm eval`).

export type Pricing = Pick<CatalogEntry, "modelId" | "inputPrice" | "outputPrice">;

export interface EvalTarget {
  pricing: Pricing;
  model: LanguageModel;
}

export interface EvalCase {
  persona: DemoPersonaId;
  goal: Goal;
}

export interface CaseResult extends EvalCase {
  ideas: { text: string; voice: number; goalFit: number; note: string }[];
  /** Ideas Studio would have shown, after dropping ones too long or repeating a past post. */
  kept: number;
  requested: number;
  /** 0–100, from the judge's 1–5 grades. */
  voice: number;
  goalFit: number;
  /** Share of ideas within Threads' 500-character limit. */
  withinLimit: number;
  /** Share of ideas that repeat a past post or another idea in the batch. */
  repetition: number;
  costUsd: number;
  judgeCostUsd: number;
  ms: number;
  summary: string;
  error?: string;
}

export interface EvalReport {
  model: string;
  judge: string;
  promptVersion: string;
  startedAt: string;
  cases: CaseResult[];
  summary: {
    voice: number;
    goalFit: number;
    withinLimit: number;
    repetition: number;
    kept: number;
    costPerBatch: number;
    judgeCost: number;
    msPerBatch: number;
    failed: number;
  };
}

export const ALL_CASES: EvalCase[] = (Object.keys(DEMO_PERSONAS) as DemoPersonaId[]).flatMap((persona) =>
  (["followers", "views", "engagement"] as Goal[]).map((goal) => ({ persona, goal })),
);

export const judgeSchema = z.object({
  ideas: z.array(
    z.object({
      index: z.number().int().describe("The idea's number, from 1."),
      voice: z.number().int().describe("1–5: would their followers believe the author wrote it?"),
      goalFit: z.number().int().describe("1–5: how well it serves the goal for this author."),
      note: z.string().describe("Under 20 words: the main reason for the grades."),
    }),
  ),
  summary: z.string().describe("One sentence on the batch as a whole."),
});

export const JUDGE_INSTRUCTIONS = [
  "You grade ghostwritten Threads posts for one author, strictly and consistently.",
  "For each idea give two grades from 1 to 5:",
  "- voice: would the author's followers believe the author wrote it? Judge vocabulary, length, casing, emoji, rhythm and point of view against their real posts. 3 is passable, 5 is indistinguishable from their best.",
  "- goalFit: how well it serves the stated goal for this author's audience. 3 is plausible, 5 is exactly what the goal needs.",
  "Don't reward length or polish for its own sake. Penalize generic AI phrasing, invented facts and anything the author couldn't honestly post.",
].join("\n");

export function judgePrompt(input: { persona: DemoPersonaId; goal: Goal; ideas: string[]; now: Date }): string {
  const persona = DEMO_PERSONAS[input.persona];
  const posts = generateDemoDataset(persona, input.now).posts;
  const playbook = PLAYBOOKS[input.goal];
  return [
    `Author: ${persona.profile.name} (@${persona.profile.username}). Bio: ${persona.profile.biography}`,
    "",
    "Their real posts:",
    ...posts.slice(0, 12).map((p) => `- """${p.text}"""`),
    "",
    `Goal: ${GOAL_META[input.goal].label}. ${playbook.objective}`,
    "",
    "Ideas to grade:",
    ...input.ideas.map((text, i) => `${i + 1}. """${text}"""`),
  ].join("\n");
}

const toPercent = (grade: number) => Math.round(((Math.min(5, Math.max(1, grade)) - 1) / 4) * 100);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Share of ideas that repeat a past post or an earlier idea in the batch. */
export function repetitionShare(ideas: string[], pastPosts: string[]): number {
  if (ideas.length === 0) return 0;
  const repeats = ideas.filter((text, i) =>
    [...pastPosts, ...ideas.slice(0, i)].some((other) => similarity(text, other) >= DUPLICATE_THRESHOLD),
  );
  return repeats.length / ideas.length;
}

/** One persona and goal: generate a batch as Studio would, then measure and grade it. */
export async function runCase(
  testCase: EvalCase,
  target: EvalTarget,
  judge: EvalTarget,
  options: { count?: number; now?: Date } = {},
): Promise<CaseResult> {
  const now = options.now ?? new Date();
  const count = options.count ?? 5;
  const persona = DEMO_PERSONAS[testCase.persona];
  const data = generateDemoDataset(persona, now);
  const request = generateRequestSchema.parse({ goal: testCase.goal, count });
  const context = buildContext({
    goal: testCase.goal,
    profile: persona.profile,
    posts: data.posts,
    timeZone: persona.timezone,
    now,
    features: demoFeatures(persona),
    dna: demoDna(persona, data, now),
  });
  const started = Date.now();
  const empty = { ideas: [], kept: 0, voice: 0, goalFit: 0, withinLimit: 0, repetition: 0, judgeCostUsd: 0 };
  try {
    const generated = await generateText({
      model: target.model,
      instructions: buildInstructions(request),
      prompt: buildPrompt(request, context),
      output: Output.object({ schema: suggestionBatchSchema }),
      maxOutputTokens: outputTokenBudget(count),
    });
    const ms = Date.now() - started;
    const cost = costUsd(target.pricing, generated.usage.inputTokens ?? 0, generated.usage.outputTokens ?? 0);
    const ideas: Suggestion[] = generated.output.suggestions.slice(0, count);
    const texts = ideas.map((s) => s.text.trim());
    const pastPosts = data.posts.map((p) => p.text);

    const graded = await generateText({
      model: judge.model,
      instructions: JUDGE_INSTRUCTIONS,
      prompt: judgePrompt({ ...testCase, ideas: texts, now }),
      output: Output.object({ schema: judgeSchema }),
      maxOutputTokens: 1_500,
    });
    const judgeCostUsd = costUsd(judge.pricing, graded.usage.inputTokens ?? 0, graded.usage.outputTokens ?? 0);
    const grades = new Map(graded.output.ideas.map((g) => [g.index, g]));
    const scored = texts.map((text, i) => {
      const grade = grades.get(i + 1);
      return { text, voice: grade?.voice ?? 1, goalFit: grade?.goalFit ?? 1, note: grade?.note ?? "Not graded." };
    });

    return {
      ...testCase,
      ideas: scored,
      kept: postProcess(ideas, pastPosts, count).kept.length,
      requested: count,
      voice: Math.round(mean(scored.map((s) => toPercent(s.voice)))),
      goalFit: Math.round(mean(scored.map((s) => toPercent(s.goalFit)))),
      withinLimit: texts.length ? texts.filter((t) => threadsLength(t) <= THREADS_MAX_LENGTH).length / texts.length : 0,
      repetition: repetitionShare(texts, pastPosts),
      costUsd: cost,
      judgeCostUsd,
      ms,
      summary: graded.output.summary,
    };
  } catch (error) {
    return {
      ...testCase,
      ...empty,
      requested: count,
      costUsd: 0,
      ms: Date.now() - started,
      summary: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Every case for one model, a few at a time. */
export async function runEval(
  target: EvalTarget,
  judge: EvalTarget,
  options: {
    cases?: EvalCase[];
    count?: number;
    now?: Date;
    concurrency?: number;
    onCase?: (r: CaseResult) => void;
  } = {},
): Promise<EvalReport> {
  const cases = options.cases ?? ALL_CASES;
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const index = next++;
      results[index] = await runCase(cases[index], target, judge, options);
      options.onCase?.(results[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 3, cases.length) }, worker));

  const ok = results.filter((r) => !r.error);
  return {
    model: target.pricing.modelId,
    judge: judge.pricing.modelId,
    promptVersion: PROMPT_VERSION,
    startedAt,
    cases: results,
    summary: {
      voice: Math.round(mean(ok.map((r) => r.voice))),
      goalFit: Math.round(mean(ok.map((r) => r.goalFit))),
      withinLimit: mean(ok.map((r) => r.withinLimit)),
      repetition: mean(ok.map((r) => r.repetition)),
      kept: mean(ok.map((r) => r.kept / r.requested)),
      costPerBatch: mean(ok.map((r) => r.costUsd)),
      judgeCost: ok.reduce((sum, r) => sum + r.judgeCostUsd, 0),
      msPerBatch: Math.round(mean(ok.map((r) => r.ms))),
      failed: results.length - ok.length,
    },
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 4 : 3)}`;

/** The reports side by side, one row per model. */
export function formatComparison(reports: EvalReport[]): string {
  const header = [
    "Model",
    "Voice",
    "Goal fit",
    "Within limit",
    "Repeats",
    "Kept",
    "Cost/batch",
    "Time/batch",
    "Failed",
  ];
  const rows = reports.map((r) => [
    r.model,
    String(r.summary.voice),
    String(r.summary.goalFit),
    pct(r.summary.withinLimit),
    pct(r.summary.repetition),
    pct(r.summary.kept),
    usd(r.summary.costPerBatch),
    `${(r.summary.msPerBatch / 1000).toFixed(1)}s`,
    String(r.summary.failed),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}
