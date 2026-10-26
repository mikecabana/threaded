import { z } from "zod";
import type { ProfileTopics } from "@/lib/db/schema";

// The author's topics: a fast model reads a sample of their posts and names
// the subjects they keep coming back to. Jev then files each post under one of
// them (./classify-questions.ts). The list is refreshed weekly when too many
// posts fit none of its topics.

export const TOPICS_PROMPT_VERSION = "topics.v1";
export const MAX_TOPICS = 12;
/** Posts the model reads to propose topics. */
export const TOPIC_SAMPLE = 60;
/** Fewer posts with text than this and there's nothing to name yet. */
export const MIN_TOPIC_POSTS = 3;
/** Refresh at most weekly, and only when this share of recently labelled posts fit no topic. */
export const TOPICS_MAX_AGE_DAYS = 7;
export const UNFILED_SHARE = 0.25;
/** …out of at least this many recently labelled posts. */
export const MIN_RECENT_LABELLED = 8;

export const topicsSchema = z.object({
  topics: z.array(
    z.object({
      name: z.string().describe("1 to 3 lowercase words, e.g. 'pricing' or 'remote work'."),
      description: z.string().describe("What counts as this topic, in one short phrase."),
    }),
  ),
});

export type TopicsOutput = z.infer<typeof topicsSchema>;

export const TOPICS_INSTRUCTIONS = [
  "You name the recurring subjects of one Threads author's posts, for an analytics tool that files each post under one of them.",
  "- Return 4 to 12 topics that together cover most of the posts.",
  "- Keep them broad and distinct: 'pricing', not 'pricing page copy'; never two topics that overlap.",
  "- Names are 1 to 3 lowercase words. Keep acronyms and names as written (AI, TikTok).",
  "- When the author already has topics, keep every one that still fits under the same name, and only add topics for subjects the list misses.",
].join("\n");

export function buildTopicsPrompt(input: { bio: string; existing: ProfileTopics["list"]; posts: string[] }): string {
  const lines: string[] = [];
  if (input.bio) lines.push(`Author's bio: ${input.bio}`, "");
  if (input.existing.length) {
    lines.push("Their topics so far:", ...input.existing.map((t) => `- ${t.name}: ${t.description}`), "");
  }
  lines.push("Posts:");
  for (const [i, text] of input.posts.entries()) lines.push(`[${i + 1}] """${text.trim()}"""`);
  return lines.join("\n");
}

const keepsCase = (word: string) =>
  (/^[A-Z0-9][A-Z0-9.&+-]{1,5}$/.test(word) && /[A-Z]/.test(word)) || /[a-z][A-Z]/.test(word);

/** Acronyms and names like "TikTok" stay as written; everything else is lowercased, at most three words. */
export function normalizeTopic(raw: string): string | null {
  const topic = raw
    .replace(/^#+/, "")
    .replace(/[“”"'.,;:!?]+$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => (keepsCase(word) ? word : word.toLowerCase()))
    .join(" ")
    .slice(0, 40)
    .trim();
  return topic || null;
}

/**
 * The new list: existing topics first (so their names never change), then new
 * ones, without duplicates, capped at MAX_TOPICS.
 */
export function readTopics(output: TopicsOutput, existing: ProfileTopics["list"]): ProfileTopics["list"] {
  const list = [...existing];
  const seen = new Set(existing.map((t) => t.name.toLowerCase()));
  for (const topic of output.topics) {
    const name = normalizeTopic(topic.name);
    const description = topic.description.trim().slice(0, 120);
    if (!name || seen.has(name.toLowerCase()) || list.length >= MAX_TOPICS) continue;
    seen.add(name.toLowerCase());
    list.push({ name, description: description || name });
  }
  return list;
}

/**
 * Whether to ask for topics again: none yet, or (at most weekly) when too many
 * recently labelled posts fit none of them.
 */
export function topicsNeedRefresh(
  topics: ProfileTopics | null,
  recent: { labelled: number; unfiled: number },
  now: Date,
): boolean {
  if (!topics || topics.list.length === 0) return true;
  const age = now.getTime() - Date.parse(topics.updatedAt);
  if (age < TOPICS_MAX_AGE_DAYS * 86_400_000) return false;
  return recent.labelled >= MIN_RECENT_LABELLED && recent.unfiled / recent.labelled >= UNFILED_SHARE;
}
