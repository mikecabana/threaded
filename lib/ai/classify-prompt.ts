import { z } from "zod";
import { HOOK_TYPES, POST_FORMATS, type PostFeatures, TONES } from "@/lib/analysis/formats";

export { CLASSIFY_BATCH } from "@/lib/sync/constants";

// Post classification (docs/PLAN.md §4c): a fast model labels each post's
// format, topic, hook and tone, 20 posts per call. Labels are stored per post
// and version, so a post is only ever classified once per version.

/** Bump to re-classify every post (old labels stay, keyed by version). */
export const CLASSIFIER_VERSION = 1;
export const CLASSIFY_PROMPT_VERSION = "classify.v1";
/** The author's existing topics offered for reuse, so labels stay consistent across batches. */
export const KNOWN_TOPICS_LIMIT = 30;

export const classificationSchema = z.object({
  posts: z.array(
    z.object({
      n: z.number().describe("The post's number from the list."),
      format: z.enum(POST_FORMATS),
      topic: z.string().describe("What the post is about in 1 to 3 lowercase words, e.g. 'pricing' or 'remote work'."),
      hookType: z.enum(HOOK_TYPES),
      tone: z.enum(TONES),
    }),
  ),
});

export type Classification = z.infer<typeof classificationSchema>;

export const CLASSIFY_INSTRUCTIONS = [
  "You label Threads posts for an analytics tool. For every numbered post, return its number as `n` and:",
  "- format: hot_take (a strong or contrarian opinion), question (mainly asks the audience something), story (something that happened, told personally), list (several items or steps), tip (one practical piece of advice), observation (a remark, update or reflection), series (explicitly part of a numbered series).",
  "- topic: the subject in 1 to 3 lowercase words. Keep acronyms and names as written (AI, Next.js). Reuse one of the author's existing topics whenever it fits; only invent a new one for a genuinely new subject. Prefer broad topics ('pricing', not 'pricing page copy').",
  "- hookType: how the first line grabs attention: question, bold_claim, number (a figure or count), story_opener (drops into a moment), how_to, confession, callout (addresses the reader directly), observation.",
  "- tone: playful, earnest, contrarian, analytical, vulnerable, celebratory, frustrated or neutral.",
  "Label every post, even very short ones. Return exactly one entry per post.",
].join("\n");

export function buildClassifyPrompt(input: { bio: string; knownTopics: string[]; posts: string[] }): string {
  const lines: string[] = [];
  if (input.bio) lines.push(`Author's bio: ${input.bio}`, "");
  if (input.knownTopics.length) {
    lines.push(`The author's existing topics (reuse when they fit): ${input.knownTopics.join(", ")}.`, "");
  }
  lines.push("Posts:");
  for (const [i, text] of input.posts.entries()) lines.push(`[${i + 1}] """${text.trim()}"""`);
  return lines.join("\n");
}

const keepsCase = (word: string) =>
  (/^[A-Z0-9][A-Z0-9.&+-]{1,5}$/.test(word) && /[A-Z]/.test(word)) || /[a-z][A-Z]/.test(word);

/** Acronyms and names like "TikTok" stay as written; everything else is lowercased, at most three words. */
export function normalizeTopic(raw: string, knownTopics: string[] = []): string | null {
  const words = raw
    .replace(/^#+/, "")
    .replace(/[“”"'.,;:!?]+$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => (keepsCase(word) ? word : word.toLowerCase()));
  const topic = words.join(" ").slice(0, 40).trim();
  if (!topic) return null;
  return knownTopics.find((known) => known.toLowerCase() === topic.toLowerCase()) ?? topic;
}

/**
 * Maps the model's answer back onto the batch: one set of labels per post it
 * actually numbered, first answer wins. Posts it skipped stay unlabelled and are
 * picked up by the next run.
 */
export function readClassification(
  output: Classification,
  postIds: string[],
  knownTopics: string[] = [],
): Map<string, PostFeatures> {
  const labelled = new Map<string, PostFeatures>();
  for (const item of output.posts) {
    const id = Number.isInteger(item.n) ? postIds[item.n - 1] : undefined;
    if (!id || labelled.has(id)) continue;
    labelled.set(id, {
      format: item.format,
      topic: normalizeTopic(item.topic, knownTopics),
      hookType: item.hookType,
      tone: item.tone,
    });
  }
  return labelled;
}
