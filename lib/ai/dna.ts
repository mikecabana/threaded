import "server-only";
import { generateText } from "ai";
import { and, count, eq, sql } from "drizzle-orm";
import { performanceFacts, topicStats } from "@/lib/analysis/facts";
import { loadProfileDataset } from "@/lib/data/dataset";
import { latestDna, loadPostFeatures } from "@/lib/data/intelligence";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { INITIAL_HISTORY_DAYS } from "@/lib/sync/constants";
import { backgroundModel, logBackgroundFailure } from "./background";
import { voiceStats } from "./context";
import {
  assembleDna,
  buildDnaPrompt,
  DNA_INSTRUCTIONS,
  DNA_MAX_AGE_DAYS,
  dnaOutputSchema,
  dnaSamples,
  MIN_DNA_POSTS,
  type ProfileDna,
} from "./dna-prompt";
import { objectOutput } from "./structured";

const DAY_MS = 86_400_000;
/** Slack so a weekly rebuild doesn't slip a day when the daily cron runs a little early. */
const SLACK_MS = 2 * 3_600_000;

/** True when the profile has enough posts and no DNA from the last week. */
export async function dnaDue(profileId: string, now = new Date()): Promise<boolean> {
  const [{ total }] = await db()
    .select({ total: count() })
    .from(posts)
    .where(and(eq(posts.profileId, profileId), sql`length(trim(${posts.text})) > 0`));
  if (total < MIN_DNA_POSTS) return false;
  const latest = await latestDna(profileId);
  return !latest || now.getTime() - latest.generatedAt.getTime() >= DNA_MAX_AGE_DAYS * DAY_MS - SLACK_MS;
}

/** Stores the DNA as the profile's next version and returns that version number. */
async function saveDna(profileId: string, dna: ProfileDna, model: string, now: Date): Promise<number> {
  const result = await db().execute<{ version: number }>(sql`
    insert into profile_dna (profile_id, version, data, model, generated_at)
    select ${profileId}, coalesce(max(version), 0) + 1, ${JSON.stringify(dna)}::jsonb, ${model}, ${now.toISOString()}
    from profile_dna where profile_id = ${profileId}
    returning version`);
  return Number(result.rows[0].version);
}

export interface DnaResult {
  ok: boolean;
  version: number | null;
}

/**
 * Builds and stores a new Profile DNA from up to a year of posts and their
 * labels. Never throws: on failure the previous DNA (if any) stays in use and
 * the next sync tries again.
 */
export async function buildDna(profileId: string, now = new Date()): Promise<DnaResult> {
  try {
    const background = await backgroundModel(profileId, "dna");
    if (!background) return { ok: false, version: null };
    const { resolved, profile } = background;

    const author = {
      id: profile.id,
      username: profile.username,
      name: profile.name ?? profile.username,
      biography: profile.biography ?? "",
      profilePictureUrl: profile.profilePictureUrl,
      isVerified: profile.isVerified,
    };
    const dataset = await loadProfileDataset(author, now, { postDays: INITIAL_HISTORY_DAYS });
    const written = dataset.posts.filter((p) => p.text.trim().length > 0);
    if (written.length < MIN_DNA_POSTS) return { ok: false, version: null };

    const features = await loadPostFeatures(profileId);
    const facts = performanceFacts(written, features, now);
    const topics = topicStats(written, features, now);
    const stats = voiceStats(written);

    const { output } = await generateText({
      model: resolved.model,
      instructions: DNA_INSTRUCTIONS,
      prompt: buildDnaPrompt({
        profile: author,
        stats,
        facts,
        topics,
        samples: dnaSamples(written).map((p) => ({ text: p.text, features: features.get(p.id) })),
      }),
      output: objectOutput({ schema: dnaOutputSchema }),
      maxOutputTokens: 2_000,
      providerOptions: resolved.providerOptions,
    });
    const dna = assembleDna({ output, facts, topics, stats, posts: written });
    return { ok: true, version: await saveDna(profileId, dna, resolved.entry.modelId, now) };
  } catch (error) {
    logBackgroundFailure("Profile DNA", profileId, error);
    return { ok: false, version: null };
  }
}
