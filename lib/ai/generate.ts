import "server-only";
import { randomUUID } from "node:crypto";
import { createTextStreamResponse, Output, streamText, toTextStream } from "ai";
import { and, count, eq, gte } from "drizzle-orm";
import { maybeStartAutoRecharge } from "@/lib/billing/auto-recharge";
import {
  type Hold,
  InsufficientCreditsError,
  releaseCredits,
  reserveCredits,
  settleCredits,
} from "@/lib/billing/wallet";
import { loadProfileDataset } from "@/lib/data/dataset";
import { latestDna, loadPostFeatures } from "@/lib/data/intelligence";
import { getVoicePrefs } from "@/lib/data/settings";
import { db } from "@/lib/db";
import { generations, suggestions, threadsProfiles, workspaces } from "@/lib/db/schema";
import { winningDrafts } from "@/lib/publishing/scorecard";
import type { AccountIdentity } from "@/lib/session/identity";
import { buildContext } from "./context";
import {
  chargeBatch,
  costUsd,
  estimateTokens,
  maxCredits,
  outputTokenBudget,
  RESEARCH_BRIEF_TOKENS,
  reportedCostUsd,
  researchCredits,
} from "./cost";
import { type ByokFailure, byokFailure } from "./errors";
import { isAiConfigured, type ResolvedModel, resolveModel } from "./models";
import { postProcess } from "./postprocess";
import { buildInstructions, buildPrompt, PROMPT_VERSION } from "./prompt";
import { type ResearchRun, researchTopic } from "./research";
import { type GenerateRequest, type SuggestionBatch, suggestionBatchSchema } from "./schemas";
import { topicPosts } from "./threads-search";

export const RATE_LIMIT = { windowMs: 10 * 60_000, max: 10 };

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Usage = { inputTokens?: number; outputTokens?: number } | undefined;

type Outcome =
  | {
      kind: "ok";
      output: SuggestionBatch | undefined;
      usage: Usage;
      generationId: string | undefined;
      reportedCost: number | null;
    }
  | { kind: "failed"; error?: ByokFailure | null };

/** What the call cost in USD: the Gateway's figure when it gave one, else tokens × catalog price. */
function actualCostUsd(resolved: ResolvedModel, reported: number | null, usage: Usage) {
  return reported ?? costUsd(resolved.entry, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
}

/** The model for a topic's research, or null when the catalog has none (the batch goes ahead without it). */
async function researchModel(workspace: typeof workspaces.$inferSelect): Promise<ResolvedModel | null> {
  try {
    return await resolveModel({ task: "research", workspace });
  } catch (error) {
    console.warn(`Topic research skipped: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Runs one Studio generation and returns the streaming response. The response
 * streams the model's JSON as it's written; it closes only after the batch has
 * been post-processed, stored and billed, so the client can fetch the final
 * suggestions (with ids) as soon as the stream ends.
 *
 * With a topic, research runs first (./research.ts): recent popular Threads
 * posts on it (./threads-search.ts) and, when it names something specific, a
 * web search. What they show goes into the prompt, and the ideas mustn't
 * repeat those posts any more than the author's own.
 *
 * Billing: the worst-case cost is reserved up front, and the actual cost is
 * charged only if at least one idea survives. Failures and cancellations are
 * refunded in full.
 */
export async function startGeneration(input: {
  identity: AccountIdentity;
  request: GenerateRequest;
  signal?: AbortSignal;
  now?: Date;
}): Promise<Response> {
  const { identity, request } = input;
  const now = input.now ?? new Date();

  const [row] = await db()
    .select({ workspace: workspaces, profile: threadsProfiles })
    .from(threadsProfiles)
    .innerJoin(workspaces, eq(workspaces.id, threadsProfiles.workspaceId))
    .where(eq(threadsProfiles.id, identity.profileId));
  if (!row) return json(404, { error: "profile_not_found" });

  const [{ recent }] = await db()
    .select({ recent: count() })
    .from(generations)
    .where(
      and(
        eq(generations.profileId, identity.profileId),
        gte(generations.createdAt, new Date(now.getTime() - RATE_LIMIT.windowMs)),
      ),
    );
  if (recent >= RATE_LIMIT.max) return json(429, { error: "rate_limited" });

  const { workspace, profile } = row;
  const ownKey = workspace.billingMode === "byok" && workspace.byokKeyEnc !== null;
  if (!ownKey && !isAiConfigured()) return json(503, { error: "ai_unavailable" });
  const resolved = await resolveModel({ task: "generate", workspace, requestedModelId: request.modelId });
  const topic = request.topic?.trim() || null;
  const researcher = topic ? await researchModel(workspace) : null;
  const threadsProfile = {
    id: profile.id,
    username: profile.username,
    name: profile.name ?? profile.username,
    biography: profile.biography ?? "",
    profilePictureUrl: profile.profilePictureUrl,
    isVerified: profile.isVerified,
  };
  const [dataset, features, stored, winners, voice] = await Promise.all([
    loadProfileDataset(threadsProfile, now),
    loadPostFeatures(profile.id),
    latestDna(profile.id),
    winningDrafts(profile.id),
    getVoicePrefs(identity.userId),
  ]);
  const context = buildContext({
    goal: request.goal,
    profile: threadsProfile,
    posts: dataset.posts,
    timeZone: profile.timezone,
    now,
    features,
    dna: stored?.dna ?? null,
    topic: request.topic,
    winners,
  });
  const instructions = buildInstructions(request, voice);
  const maxOutputTokens = outputTokenBudget(request.count, request.shape);

  const generationId = randomUUID();
  await db().insert(generations).values({
    id: generationId,
    profileId: profile.id,
    userId: identity.userId,
    goal: request.goal,
    model: resolved.entry.modelId,
    promptVersion: PROMPT_VERSION,
    steer: request,
    billingMode: resolved.billing,
  });

  let hold: Hold | null = null;
  if (resolved.billing === "credits") {
    try {
      // The research brief isn't written yet, so the reserve allows for the longest one.
      const inputTokens =
        estimateTokens(instructions + buildPrompt(request, context)) + (researcher ? RESEARCH_BRIEF_TOKENS : 0);
      const needed =
        maxCredits(resolved.entry, inputTokens, maxOutputTokens) +
        (researcher ? researchCredits(researcher.entry, "max") : 0);
      hold = await reserveCredits(workspace.id, needed, generationId);
    } catch (error) {
      await db().update(generations).set({ status: "failed" }).where(eq(generations.id, generationId));
      if (error instanceof InsufficientCreditsError) {
        // With auto-recharge on, a top-up starts now so the next try works.
        const recharging = await maybeStartAutoRecharge(workspace.id);
        return json(402, { error: "insufficient_credits", needed: error.needed, balance: error.balance, recharging });
      }
      throw error;
    }
  }

  // Research runs before the stream starts: Studio says it's looking the topic up until the response arrives.
  const theirPosts =
    researcher && topic
      ? await topicPosts({ profileId: profile.id, username: profile.username, topic, now, signal: input.signal })
      : [];
  const run: ResearchRun | null =
    researcher && topic
      ? await researchTopic({
          topic,
          posts: theirPosts,
          author: {
            username: profile.username,
            biography: profile.biography ?? "",
            topics: profile.topics?.list.map((t) => t.name) ?? [],
          },
          resolved: researcher,
          now,
          signal: input.signal,
        })
      : null;
  if (run && researcher) {
    await db()
      .update(generations)
      .set({
        research: { ...run.research, model: researcher.entry.modelId, searches: run.searches, costUsd: run.costUsd },
      })
      .where(eq(generations.id, generationId))
      // Credits are on hold now: a failed write mustn't stop the batch that settles them.
      .catch((error) => console.error(`Storing research for generation ${generationId} failed`, error));
  }
  const prompt = buildPrompt(request, context, run?.research);

  // Their posts are only held here, to drop ideas that echo them.
  const pastPosts = [...dataset.posts.map((p) => p.text), ...theirPosts.map((p) => p.text)];
  let settled = false;
  let markDone!: () => void;
  const done = new Promise<void>((resolve) => {
    markDone = resolve;
  });

  async function finish(outcome: Outcome) {
    if (settled) return;
    settled = true;
    try {
      const processed =
        outcome.kind === "ok" && outcome.output
          ? postProcess(outcome.output.suggestions, pastPosts, request.count, voice, request.shape)
          : null;
      if (!processed || processed.kept.length === 0) {
        await db()
          .update(generations)
          .set({
            status: processed ? "done" : "failed",
            dropped: processed?.dropped.length ?? 0,
            error: outcome.kind === "failed" ? (outcome.error ?? null) : null,
          })
          .where(eq(generations.id, generationId));
        if (hold) await releaseCredits(hold);
        return;
      }
      const ok = outcome as Extract<Outcome, { kind: "ok" }>;
      const ideasCost = actualCostUsd(resolved, ok.reportedCost, ok.usage);
      const cost = ideasCost + (run?.costUsd ?? 0);
      const charged = hold
        ? chargeBatch({
            entry: resolved.entry,
            costUsd: ideasCost,
            research:
              run && researcher
                ? {
                    entry: researcher.entry,
                    costUsd: run.costUsd,
                    searches: run.searches,
                    threadsPosts: run.threadsPosts,
                  }
                : null,
            reserved: hold.amount,
          })
        : 0;
      await db()
        .insert(suggestions)
        .values(
          processed.kept.map((s) => ({
            generationId,
            text: s.text,
            seriesParts: s.parts,
            format: s.format,
            hook: s.hook,
            rationale: s.rationale,
            goalFit: s.goalFit,
            bestSlot: s.bestSlot,
          })),
        );
      await db()
        .update(generations)
        .set({
          status: "done",
          dropped: processed.dropped.length,
          usage: ok.usage ?? null,
          gatewayGenerationId: ok.generationId ?? null,
          costUsd: cost.toFixed(6),
          creditsCharged: charged,
        })
        .where(eq(generations.id, generationId));
      if (hold) {
        await settleCredits(hold, charged);
        await maybeStartAutoRecharge(workspace.id);
      }
    } catch (error) {
      console.error(`Finishing generation ${generationId} failed`, error);
      await db()
        .update(generations)
        .set({ status: "failed" })
        .where(eq(generations.id, generationId))
        .catch(() => {});
      if (hold) await releaseCredits(hold).catch(() => {});
    } finally {
      markDone();
    }
  }

  const result = streamText({
    model: resolved.model,
    instructions,
    prompt,
    output: Output.object({ schema: suggestionBatchSchema }),
    maxOutputTokens,
    providerOptions: resolved.providerOptions,
    abortSignal: input.signal,
    onEnd: async (event) => {
      const gateway = event.providerMetadata?.gateway as { generationId?: string } | undefined;
      await finish({
        kind: "ok",
        output: event.output as SuggestionBatch | undefined,
        usage: event.totalUsage as Usage,
        generationId: gateway?.generationId,
        reportedCost: reportedCostUsd(event.providerMetadata),
      });
    },
    onError: async ({ error }) => {
      console.error(`Generation ${generationId} failed`, error);
      await finish({ kind: "failed", error: resolved.billing === "byok" ? byokFailure(error) : null });
    },
    onAbort: async () => {
      await finish({ kind: "failed" });
    },
  });

  const text = toTextStream({ stream: result.stream });
  const body = new ReadableStream<string>({
    async start(controller) {
      const reader = text.getReader();
      try {
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          controller.enqueue(value);
        }
      } catch (error) {
        await finish({ kind: "failed" });
        controller.error(error);
        return;
      }
      // Hold the response open until the batch is stored and billed.
      await done;
      controller.close();
    },
  });

  return createTextStreamResponse({
    stream: body,
    headers: { "x-generation-id": generationId, "cache-control": "no-store" },
  });
}
