import "server-only";
import { generateText, Output } from "ai";
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { postFeatures, posts } from "@/lib/db/schema";
import { MAX_POSTS } from "@/lib/sync/constants";
import { backgroundModel, logBackgroundFailure } from "./background";
import {
  buildClassifyPrompt,
  CLASSIFIER_VERSION,
  CLASSIFY_BATCH,
  CLASSIFY_INSTRUCTIONS,
  classificationSchema,
  KNOWN_TOPICS_LIMIT,
  readClassification,
} from "./classify-prompt";

const hasText = sql`length(trim(${posts.text})) > 0`;

/** Posts with text that the current classifier hasn't labelled yet, newest first. */
export async function pendingClassification(profileId: string, limit = MAX_POSTS): Promise<string[]> {
  const rows = await db()
    .select({ id: posts.id })
    .from(posts)
    .leftJoin(postFeatures, and(eq(postFeatures.postId, posts.id), eq(postFeatures.version, CLASSIFIER_VERSION)))
    .where(and(eq(posts.profileId, profileId), isNull(postFeatures.postId), hasText))
    .orderBy(desc(posts.postedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** The author's topics so far, most used first, offered to the model for reuse. */
async function topicsInUse(profileId: string): Promise<string[]> {
  const rows = await db()
    .select({ topic: postFeatures.topic, uses: count() })
    .from(postFeatures)
    .innerJoin(posts, eq(posts.id, postFeatures.postId))
    .where(
      and(eq(posts.profileId, profileId), eq(postFeatures.version, CLASSIFIER_VERSION), isNotNull(postFeatures.topic)),
    )
    .groupBy(postFeatures.topic)
    .orderBy(desc(count()), postFeatures.topic)
    .limit(KNOWN_TOPICS_LIMIT);
  return rows.map((r) => r.topic as string);
}

export interface ClassifyResult {
  classified: number;
  /** False when no model was reachable or the call failed; the posts stay pending. */
  ok: boolean;
}

/**
 * Labels one batch (up to 20) of the profile's posts in a single model call
 * and stores the labels. Never throws: a failure leaves the posts pending for
 * the next sync.
 */
export async function classifyPosts(profileId: string, postIds: string[]): Promise<ClassifyResult> {
  const ids = postIds.slice(0, CLASSIFY_BATCH);
  if (ids.length === 0) return { classified: 0, ok: true };
  try {
    const background = await backgroundModel(profileId, "classify");
    if (!background) return { classified: 0, ok: false };
    const { resolved, profile } = background;

    const rows = await db()
      .select({ id: posts.id, text: posts.text })
      .from(posts)
      .where(and(eq(posts.profileId, profileId), inArray(posts.id, ids), hasText));
    const batch = ids.flatMap((id) => rows.filter((r) => r.id === id));
    if (batch.length === 0) return { classified: 0, ok: true };
    const knownTopics = await topicsInUse(profileId);

    const { output } = await generateText({
      model: resolved.model,
      instructions: CLASSIFY_INSTRUCTIONS,
      prompt: buildClassifyPrompt({ bio: profile.biography ?? "", knownTopics, posts: batch.map((p) => p.text) }),
      output: Output.object({ schema: classificationSchema }),
      maxOutputTokens: 200 + 60 * batch.length,
      providerOptions: resolved.providerOptions,
    });
    const labels = readClassification(
      output,
      batch.map((p) => p.id),
      knownTopics,
    );
    if (labels.size > 0) {
      await db()
        .insert(postFeatures)
        .values(
          [...labels].map(([postId, f]) => ({
            postId,
            version: CLASSIFIER_VERSION,
            format: f.format,
            topic: f.topic,
            hookType: f.hookType,
            tone: f.tone,
            model: resolved.entry.modelId,
          })),
        )
        .onConflictDoNothing();
    }
    return { classified: labels.size, ok: true };
  } catch (error) {
    logBackgroundFailure("Post classification", profileId, error);
    return { classified: 0, ok: false };
  }
}
