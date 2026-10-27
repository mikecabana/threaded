import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createGateway } from "ai";
import { DEFAULT_CATALOG } from "@/lib/ai/catalog";
import { createMockJudgeModel, createMockModel } from "@/lib/ai/mock-model";
import type { DemoPersonaId } from "@/lib/demo/personas";
import { ALL_CASES, type EvalReport, type EvalTarget, formatComparison, type Pricing, runEval } from "@/lib/evals/eval";
import type { Goal } from "@/lib/goals";

// `pnpm eval`: the prompt/model evals (lib/evals/eval.ts). Needs
// AI_GATEWAY_API_KEY; `--mock` runs the whole harness on stand-in models.
//
//   pnpm eval                                  Studio's default model, judged by the best-tier model
//   pnpm eval --model anthropic/claude-haiku-5.5,anthropic/claude-sonnet-5.5
//   pnpm eval --judge openai/gpt-6 --personas creator --goals views --count 3

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    judge: { type: "string" },
    personas: { type: "string" },
    goals: { type: "string" },
    count: { type: "string", default: "5" },
    out: { type: "string", default: "evals/results" },
    mock: { type: "boolean", default: false },
  },
});

const defaultFor = (tier: "balanced" | "best") =>
  DEFAULT_CATALOG.find((m) => (tier === "balanced" ? m.defaultFor.includes("generate") : m.tier === "best"))?.modelId;
const models = (values.model ?? defaultFor("balanced") ?? "").split(",").filter(Boolean);
const judgeId = values.judge ?? defaultFor("best") ?? "";
const list = (raw: string | undefined) => raw?.split(",").filter(Boolean);
const personas = list(values.personas) as DemoPersonaId[] | undefined;
const goals = list(values.goals) as Goal[] | undefined;
const cases = ALL_CASES.filter(
  (c) => (!personas || personas.includes(c.persona)) && (!goals || goals.includes(c.goal)),
);
const count = Number(values.count);

async function pricingFor(ids: string[]): Promise<Map<string, Pricing>> {
  const prices = new Map<string, Pricing>(
    DEFAULT_CATALOG.map((m) => [
      m.modelId,
      { modelId: m.modelId, inputPrice: m.inputPrice, outputPrice: m.outputPrice },
    ]),
  );
  if (values.mock) return prices;
  // Live prices from the Gateway, which also covers models not in the catalog yet.
  const { models: live } = await gateway().getAvailableModels();
  for (const model of live) {
    if (!ids.includes(model.id) || !model.pricing) continue;
    const perMillion = (perToken: string) => Number(perToken) * 1_000_000;
    prices.set(model.id, {
      modelId: model.id,
      inputPrice: perMillion(model.pricing.input),
      outputPrice: perMillion(model.pricing.output),
    });
  }
  return prices;
}

function gateway() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    console.error("Set AI_GATEWAY_API_KEY to run evals against real models, or pass --mock.");
    process.exit(1);
  }
  return createGateway({ apiKey });
}

function target(id: string, prices: Map<string, Pricing>, role: "model" | "judge"): EvalTarget {
  const pricing = prices.get(id);
  if (!pricing) {
    console.error(`The Gateway doesn't list ${id}. Check the id against the Gateway's model list.`);
    process.exit(1);
  }
  if (values.mock) {
    return { pricing, model: role === "judge" ? createMockJudgeModel(id) : createMockModel(count, id) };
  }
  return { pricing, model: gateway()(id) };
}

async function main() {
  if (cases.length === 0 || models.length === 0 || !judgeId) {
    console.error("Nothing to run: check --model, --personas and --goals.");
    process.exit(1);
  }
  const prices = await pricingFor([...models, judgeId]);
  const judge = target(judgeId, prices, "judge");
  mkdirSync(values.out, { recursive: true });

  const reports: EvalReport[] = [];
  for (const id of models) {
    console.log(`\n${id}: ${cases.length} batches of ${count}, judged by ${judgeId}`);
    const report = await runEval(target(id, prices, "model"), judge, {
      cases,
      count,
      onCase: (r) =>
        console.log(
          r.error
            ? `  ✗ ${r.persona} · ${r.goal}: ${r.error}`
            : `  ✓ ${r.persona} · ${r.goal}: voice ${r.voice}, goal fit ${r.goalFit}, kept ${r.kept}/${r.requested}`,
        ),
    });
    const file = `${values.out}/${report.startedAt.replace(/[:.]/g, "-")}-${id.replace(/[^\w.-]+/g, "_")}.json`;
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`  Report: ${file}`);
    reports.push(report);
  }

  const judgeTotal = reports.reduce((sum, r) => sum + r.summary.judgeCost, 0);
  console.log(`\n${formatComparison(reports)}\n`);
  console.log("Voice and goal fit are 0–100 from the judge's 1–5 grades. Cost is per batch, on the Gateway's prices.");
  console.log(`Judging cost $${judgeTotal.toFixed(3)} in total.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
