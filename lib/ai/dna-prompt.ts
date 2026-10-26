import { z } from "zod";
import { type Fact, featureLabel, type TopicStat } from "@/lib/analysis/facts";
import type { PostFeatures } from "@/lib/analysis/formats";
import type { PostWithInsights, ThreadsProfile } from "@/lib/threads/types";
import type { VoiceStats } from "./context";

// Profile DNA (docs/PLAN.md §4c): a mid-tier model reads the author's posts
// and the facts their numbers support, and writes a voice guide plus what
// their audience rewards. The model never states a number: every claim cites a
// fact id, and the stored claim carries that fact, so what the user sees
// (and what the writer is told) is always our measurement.

/** Bump when ProfileDna's shape changes; older rows are then treated as missing and rebuilt. */
export const DNA_SCHEMA_VERSION = 1;
export const DNA_PROMPT_VERSION = "dna.v1";
/** Fewer posts than this and there's no voice to learn yet (cold start, §4c). */
export const MIN_DNA_POSTS = 10;
/** Rebuilt weekly. */
export const DNA_MAX_AGE_DAYS = 7;

const claimSchema = z.object({
  fact: z.string().describe("The id of the fact this is based on, e.g. F3."),
  claim: z.string().describe('The point in plain words, to the author ("you"), with no numbers.'),
});

export const dnaOutputSchema = z.object({
  headline: z
    .string()
    .describe(
      'One short sentence to the author about their strongest trait, e.g. "You\'re at your best being direct."',
    ),
  descriptors: z.array(z.string()).describe("3 to 5 words or short phrases for the voice, e.g. 'dry humour'."),
  signaturePhrases: z
    .array(z.string())
    .describe("Up to 5 phrases or openers the author really repeats, copied exactly. Empty if none stand out."),
  habits: z
    .array(z.string())
    .describe("3 to 6 concrete writing habits: casing, emoji, punctuation, line breaks, length."),
  guide: z.array(z.string()).describe("4 to 8 short imperative rules for a ghostwriter to sound like this author."),
  rewards: z.array(claimSchema).describe("2 to 4 things the audience rewards, each based on a fact above 1×."),
  blindSpots: z
    .array(claimSchema)
    .describe("1 or 2 patterns that underperform, each based on a fact below 1×, framed as an opportunity."),
  coreTopics: z.array(z.string()).describe("The 2 to 5 topics from the list that define this author."),
});

export type DnaOutput = z.infer<typeof dnaOutputSchema>;

export interface DnaClaim {
  claim: string;
  /** The measurement behind the claim, copied from our own facts. */
  fact: Omit<Fact, "id">;
}

/** What's stored in profile_dna.data. */
export interface ProfileDna {
  schema: typeof DNA_SCHEMA_VERSION;
  promptVersion: string;
  postsAnalyzed: number;
  headline: string;
  voice: { descriptors: string[]; signaturePhrases: string[]; habits: string[] };
  /** Rules for the ghostwriter. */
  guide: string[];
  rewards: DnaClaim[];
  blindSpots: DnaClaim[];
  topics: (TopicStat & { core: boolean })[];
  stats: VoiceStats;
}

export const DNA_INSTRUCTIONS = [
  "You are a writing coach. You study one Threads author's posts and the facts their numbers support, then write their Profile DNA: a voice guide a ghostwriter can follow, and what their audience rewards.",
  "",
  "Rules:",
  "- Be specific to this author. Quote their real habits; never give generic social-media advice.",
  "- Never write a number in a claim. Each reward and blind spot cites one fact by id, and the app shows the figure.",
  "- Rewards cite facts above 1×; blind spots cite facts below 1×. If no fact fits, return fewer items.",
  "- Signature phrases must be copied exactly from the posts and appear more than once. Leave the list empty if none do.",
  '- Write to the author as "you", warmly and plainly.',
].join("\n");

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function buildDnaPrompt(input: {
  profile: Pick<ThreadsProfile, "name" | "username" | "biography">;
  stats: VoiceStats;
  facts: Fact[];
  topics: TopicStat[];
  /** Best-performing first, then recent ones. */
  samples: { text: string; features?: PostFeatures }[];
}): string {
  const { profile, stats } = input;
  const lines = [`Author: ${profile.name} (@${profile.username})`];
  if (profile.biography) lines.push(`Bio: ${profile.biography}`);
  lines.push(
    "",
    `Measured habits, from ${stats.posts} posts: typical length ${stats.medianLength} characters; ` +
      `${pct(stats.emojiShare)} use emoji; ${pct(stats.questionShare)} ask a question; ` +
      `${pct(stats.lowercaseShare)} start in lowercase; ${pct(stats.lineBreakShare)} use line breaks.`,
    "",
  );
  if (input.topics.length) {
    lines.push("Topics:");
    for (const t of input.topics) {
      lines.push(
        `- ${t.name}: ${t.posts} posts, ${t.viewsMultiplier}× median views, ${t.engagementMultiplier}× engagement`,
      );
    }
    lines.push("");
  }
  if (input.facts.length) {
    lines.push("Facts from their numbers (cite by id):");
    for (const fact of input.facts) lines.push(`${fact.id} ${fact.text}`);
  } else {
    lines.push("Facts from their numbers: none yet (too few measured posts). Return no rewards or blind spots.");
  }
  lines.push("", "Their posts, best-performing first:");
  for (const [i, sample] of input.samples.entries()) {
    const label = featureLabel(sample.features);
    lines.push(`${i + 1}. """${sample.text.trim()}"""${label ? ` (${label})` : ""}`);
  }
  return lines.join("\n");
}

/** Posts for the model to read: the best by views, then the most recent, no repeats. */
export function dnaSamples(posts: PostWithInsights[], best = 12, recent = 8): PostWithInsights[] {
  const byViews = [...posts].sort((a, b) => b.insights.views - a.insights.views).slice(0, best);
  const latest = [...posts]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .filter((p) => !byViews.includes(p))
    .slice(0, recent);
  return [...byViews, ...latest].filter((p) => p.text.trim().length > 0);
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const clean = (items: string[], max: number, maxLength: number) =>
  [...new Set(items.map((item) => item.trim()).filter((item) => item && item.length <= maxLength))].slice(0, max);

/**
 * Turns the model's answer into stored DNA, keeping only what checks out:
 * claims must cite a real fact pointing the right way, and signature phrases
 * must really appear in at least two of the author's posts.
 */
export function assembleDna(input: {
  output: DnaOutput;
  facts: Fact[];
  topics: TopicStat[];
  stats: VoiceStats;
  posts: PostWithInsights[];
}): ProfileDna {
  const { output, facts } = input;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const claims = (items: DnaOutput["rewards"], keep: (f: Fact) => boolean, max: number): DnaClaim[] => {
    const used = new Set<string>();
    const result: DnaClaim[] = [];
    for (const item of items) {
      const fact = byId.get(item.fact.trim().toUpperCase());
      const claim = item.claim.trim();
      if (!fact || !keep(fact) || used.has(fact.id) || !claim || claim.length > 200) continue;
      used.add(fact.id);
      const { id: _, ...measured } = fact;
      result.push({ claim, fact: measured });
    }
    return result.slice(0, max);
  };
  const texts = input.posts.map((p) => squash(p.text));
  const repeated = (phrase: string) => texts.filter((t) => t.includes(squash(phrase))).length >= 2;
  const core = new Set(output.coreTopics.map((t) => t.trim().toLowerCase()));

  return {
    schema: DNA_SCHEMA_VERSION,
    promptVersion: DNA_PROMPT_VERSION,
    postsAnalyzed: input.posts.length,
    headline: output.headline.trim().slice(0, 140),
    voice: {
      descriptors: clean(output.descriptors, 5, 40),
      signaturePhrases: clean(output.signaturePhrases, 5, 60).filter(repeated),
      habits: clean(output.habits, 6, 160),
    },
    guide: clean(output.guide, 8, 200),
    rewards: claims(output.rewards, (f) => f.multiplier > 1, 4),
    blindSpots: claims(output.blindSpots, (f) => f.multiplier < 1, 2),
    topics: input.topics.map((t) => ({ ...t, core: core.has(t.name.toLowerCase()) })),
    stats: input.stats,
  };
}

/** Stored DNA, if it's in the current shape. */
export function readDna(data: unknown): ProfileDna | null {
  return data && typeof data === "object" && (data as ProfileDna).schema === DNA_SCHEMA_VERSION
    ? (data as ProfileDna)
    : null;
}
