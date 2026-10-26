import "server-only";
import { experimental_decide, generateText, type JSONValue, Output } from "ai";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { PostFeatures } from "@/lib/analysis/formats";
import { db } from "@/lib/db";
import { postFeatures, posts, threadsProfiles, workspaces } from "@/lib/db/schema";
import { CLASSIFY_BATCH, MAX_POSTS } from "@/lib/sync/constants";
import { backgroundModel, logBackgroundFailure, logNoGateway } from "./background";
import {
  CLASSIFIER_MODEL,
  CLASSIFIER_VERSION,
  CLASSIFY_CONCURRENCY,
  classifyQuestions,
  FALLBACK_BELOW,
  mapLimit,
  readAnswers,
} from "./classify-questions";
import { isAiConfigured, resolveDecisionModel } from "./models";
import {
  buildTopicsPrompt,
  MIN_TOPIC_POSTS,
  readTopics,
  TOPIC_SAMPLE,
  TOPICS_INSTRUCTIONS,
  topicsNeedRefresh,
  topicsSchema,
} from "./topics-prompt";

const DAY_MS = 86_400_000;
/** "Recently labelled" for deciding whether the topic list still fits. */
const RECENT_DAYS = 60;
const hasText = sql`length(trim(${posts.text})) > 0`;
const labelledNow = and(eq(postFeatures.postId, posts.id), eq(postFeatures.version, CLASSIFIER_VERSION));

/** Posts with text that the current classifier hasn't labelled yet, newest first. */
export async function pendingClassification(profileId: string, limit = MAX_POSTS): Promise<string[]> {
  const rows = await db()
    .select({ id: posts.id })
    .from(posts)
    .leftJoin(postFeatures, labelledNow)
    .where(and(eq(posts.profileId, profileId), isNull(postFeatures.postId), hasText))
    .orderBy(desc(posts.postedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

// ── Topics ───────────────────────────────────────────────────────────────────

/** Recent posts already labelled, and how many of them fit no topic. */
async function recentFiling(profileId: string, now: Date) {
  const [row] = await db()
    .select({ labelled: count(), unfiled: sql<number>`count(*) filter (where ${postFeatures.topic} is null)` })
    .from(postFeatures)
    .innerJoin(posts, labelledNow)
    .where(and(eq(posts.profileId, profileId), gte(posts.postedAt, new Date(now.getTime() - RECENT_DAYS * DAY_MS))));
  return { labelled: Number(row?.labelled ?? 0), unfiled: Number(row?.unfiled ?? 0) };
}

/** Posts for the model to name topics from: when refreshing, the ones that fit no topic come first. */
async function topicSample(profileId: string, refreshing: boolean): Promise<string[]> {
  const newest = await db()
    .select({ text: posts.text })
    .from(posts)
    .where(and(eq(posts.profileId, profileId), hasText))
    .orderBy(desc(posts.postedAt))
    .limit(TOPIC_SAMPLE);
  if (!refreshing) return newest.map((p) => p.text);
  const unfiled = await db()
    .select({ text: posts.text })
    .from(posts)
    .innerJoin(postFeatures, labelledNow)
    .where(and(eq(posts.profileId, profileId), isNull(postFeatures.topic)))
    .orderBy(desc(posts.postedAt))
    .limit(TOPIC_SAMPLE / 2);
  return [...new Set([...unfiled, ...newest].map((p) => p.text))].slice(0, TOPIC_SAMPLE);
}

export interface TopicsResult {
  topics: number;
  refreshed: boolean;
}

/**
 * Makes sure the author has a topic list for the classifier to choose from:
 * proposed by the fast model on the first sync, and refreshed (at most
 * weekly) when too many recent posts fit none of the topics. A refresh keeps
 * every existing topic, and posts that fit none get labelled again against
 * the new list. Never throws: without topics, posts are labelled without one.
 */
export async function refreshTopics(profileId: string, now = new Date()): Promise<TopicsResult> {
  try {
    const [profile] = await db()
      .select({ topics: threadsProfiles.topics, biography: threadsProfiles.biography })
      .from(threadsProfiles)
      .where(eq(threadsProfiles.id, profileId));
    const current = profile?.topics ?? null;
    const unchanged = { topics: current?.list.length ?? 0, refreshed: false };
    if (!profile || !topicsNeedRefresh(current, await recentFiling(profileId, now), now)) return unchanged;

    const sample = await topicSample(profileId, current !== null);
    if (sample.length < MIN_TOPIC_POSTS) return unchanged;
    const background = await backgroundModel(profileId, "classify");
    if (!background) return unchanged;
    const { resolved } = background;

    const existing = current?.list ?? [];
    const { output } = await generateText({
      model: resolved.model,
      instructions: TOPICS_INSTRUCTIONS,
      prompt: buildTopicsPrompt({ bio: profile.biography ?? "", existing, posts: sample }),
      output: Output.object({ schema: topicsSchema }),
      maxOutputTokens: 1_000,
      providerOptions: resolved.providerOptions,
    });
    const list = readTopics(output, existing);
    if (list.length === 0) return unchanged;
    await db()
      .update(threadsProfiles)
      .set({ topics: { list, updatedAt: now.toISOString() } })
      .where(eq(threadsProfiles.id, profileId));
    if (current && list.length > existing.length) {
      // Posts that fit no topic before get another chance against the new ones.
      await db()
        .delete(postFeatures)
        .where(
          and(
            eq(postFeatures.version, CLASSIFIER_VERSION),
            isNull(postFeatures.topic),
            inArray(
              postFeatures.postId,
              db().select({ id: posts.id }).from(posts).where(eq(posts.profileId, profileId)),
            ),
          ),
        );
    }
    return { topics: list.length, refreshed: true };
  } catch (error) {
    logBackgroundFailure("Topic list", profileId, error);
    return { topics: 0, refreshed: false };
  }
}

// ── Labels ───────────────────────────────────────────────────────────────────

export interface ClassifyResult {
  classified: number;
  /** False when no model was reachable or every call failed; the posts stay pending. */
  ok: boolean;
}

/**
 * Labels a batch of the profile's posts with Jev, one decision per post, ten
 * at a time. Answers Jev is unsure of are re-decided by the fast model
 * through the Gateway. Never throws: posts that fail stay pending for the
 * next sync.
 */
export async function classifyPosts(profileId: string, postIds: string[]): Promise<ClassifyResult> {
  const ids = postIds.slice(0, CLASSIFY_BATCH);
  if (ids.length === 0) return { classified: 0, ok: true };
  try {
    const [row] = await db()
      .select({ workspace: workspaces, topics: threadsProfiles.topics })
      .from(threadsProfiles)
      .innerJoin(workspaces, eq(workspaces.id, threadsProfiles.workspaceId))
      .where(eq(threadsProfiles.id, profileId));
    if (!row) return { classified: 0, ok: false };
    const ownKey = row.workspace.billingMode === "byok" && row.workspace.byokKeyEnc !== null;
    if (!ownKey && !isAiConfigured()) {
      logNoGateway("Classification");
      return { classified: 0, ok: false };
    }

    const resolved = await resolveDecisionModel({
      modelId: CLASSIFIER_MODEL,
      task: "classify",
      workspace: row.workspace,
    });
    const topics = row.topics?.list ?? [];
    const questions = classifyQuestions(topics);
    const unsure: Record<string, JSONValue> = topics.length
      ? {
          any: [
            { question: "format", confidenceBelow: FALLBACK_BELOW },
            { question: "topic", confidenceBelow: FALLBACK_BELOW },
          ],
        }
      : { question: "format", confidenceBelow: FALLBACK_BELOW };
    const providerOptions = {
      gateway: {
        ...resolved.gatewayOptions,
        // Unsure answers, and Jev being unavailable, go to the fast model.
        models: [{ model: resolved.fallbackModelId, when: unsure }, resolved.fallbackModelId],
      },
    };

    const rows = await db()
      .select({ id: posts.id, text: posts.text })
      .from(posts)
      .where(and(eq(posts.profileId, profileId), inArray(posts.id, ids), hasText));
    const batch = ids.flatMap((id) => rows.filter((r) => r.id === id));

    type Outcome = { postId: string; features: PostFeatures | null; model: string } | { error: unknown };
    const outcomes = await mapLimit(batch, CLASSIFY_CONCURRENCY, async (post): Promise<Outcome> => {
      try {
        const result = await experimental_decide({
          model: resolved.model,
          state: post.text,
          questions,
          providerOptions,
        });
        return {
          postId: post.id,
          features: readAnswers(result.answers, topics),
          model: result.response.modelId ?? CLASSIFIER_MODEL,
        };
      } catch (error) {
        return { error };
      }
    });

    const labelled = outcomes.flatMap((o) => ("features" in o && o.features ? [{ ...o, features: o.features }] : []));
    const failure = outcomes.find((o): o is { error: unknown } => "error" in o);
    if (labelled.length > 0) {
      await db()
        .insert(postFeatures)
        .values(
          labelled.map(({ postId, features, model }) => ({
            postId,
            version: CLASSIFIER_VERSION,
            format: features.format,
            topic: features.topic,
            hookType: features.hookType,
            tone: features.tone,
            model,
          })),
        )
        .onConflictDoNothing();
    }
    if (failure) logBackgroundFailure("Post classification", profileId, failure.error);
    return { classified: labelled.length, ok: labelled.length > 0 || !failure };
  } catch (error) {
    logBackgroundFailure("Post classification", profileId, error);
    return { classified: 0, ok: false };
  }
}
