import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { CLASSIFIER_VERSION } from "@/lib/ai/classify-prompt";
import { type ProfileDna, readDna } from "@/lib/ai/dna-prompt";
import type { HookType, PostFeatures, PostFormat, Tone } from "@/lib/analysis/formats";
import { db } from "@/lib/db";
import { postFeatures, posts, profileDna } from "@/lib/db/schema";

/** The current classifier's labels for a profile's posts (optionally only some of them). */
export async function loadPostFeatures(profileId: string, postIds?: string[]): Promise<Map<string, PostFeatures>> {
  if (postIds?.length === 0) return new Map();
  const rows = await db()
    .select({
      postId: postFeatures.postId,
      format: postFeatures.format,
      topic: postFeatures.topic,
      hookType: postFeatures.hookType,
      tone: postFeatures.tone,
    })
    .from(postFeatures)
    .innerJoin(posts, eq(posts.id, postFeatures.postId))
    .where(
      and(
        eq(posts.profileId, profileId),
        eq(postFeatures.version, CLASSIFIER_VERSION),
        postIds ? inArray(postFeatures.postId, postIds) : undefined,
      ),
    );
  return new Map(
    rows.map((r) => [
      r.postId,
      {
        format: r.format as PostFormat,
        topic: r.topic,
        hookType: r.hookType as HookType | null,
        tone: r.tone as Tone | null,
      },
    ]),
  );
}

export interface StoredDna {
  version: number;
  model: string;
  generatedAt: Date;
  dna: ProfileDna;
}

/** The profile's newest Profile DNA in the current shape, if any. */
export async function latestDna(profileId: string): Promise<StoredDna | null> {
  const [row] = await db()
    .select()
    .from(profileDna)
    .where(eq(profileDna.profileId, profileId))
    .orderBy(desc(profileDna.version))
    .limit(1);
  const dna = row ? readDna(row.data) : null;
  return row && dna ? { version: row.version, model: row.model, generatedAt: row.generatedAt, dna } : null;
}
