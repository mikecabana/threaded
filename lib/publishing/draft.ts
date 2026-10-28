import { THREADS_MAX_LENGTH, THREADS_MAX_LINKS, threadsLength, threadsLinkCount } from "@/lib/threads/length";

// Rules a post must meet before it's queued (shared by the composer and the
// server). Topic tags per Meta's docs: 1–50 characters, no periods or
// ampersands.

export const TOPIC_TAG_MAX = 50;
/** How far ahead a post can be scheduled. */
export const MAX_SCHEDULE_DAYS = 60;
/** Posts in a series, the first one included. */
export const MAX_SERIES_PARTS = 10;

export type DraftProblem = "empty" | "too_long" | "too_many_links" | "bad_topic";

export const DRAFT_PROBLEMS: Record<DraftProblem, string> = {
  empty: "Write something first.",
  too_long: `Threads allows ${THREADS_MAX_LENGTH} characters (emoji count as several).`,
  too_many_links: `Threads rejects posts with more than ${THREADS_MAX_LINKS} links.`,
  bad_topic: `Topic tags are up to ${TOPIC_TAG_MAX} characters, without periods or ampersands.`,
};

export function normalizeTopic(topic: string | null | undefined): string | null {
  const tag = (topic ?? "").trim().replace(/^#/, "");
  return tag === "" ? null : tag;
}

/**
 * The first problem in a series and which part has it (1 is the first post).
 * The topic tag goes on the first post only.
 */
export function seriesProblem(texts: readonly string[], topic?: string | null) {
  for (const [index, text] of texts.entries()) {
    const problem = draftProblem(text, index === 0 ? topic : null);
    if (problem) return { problem, part: index + 1 };
  }
  return null;
}

export function draftProblem(text: string, topic?: string | null): DraftProblem | null {
  if (text.trim() === "") return "empty";
  if (threadsLength(text) > THREADS_MAX_LENGTH) return "too_long";
  if (threadsLinkCount(text) > THREADS_MAX_LINKS) return "too_many_links";
  const tag = normalizeTopic(topic);
  if (tag && (tag.length > TOPIC_TAG_MAX || /[.&]/.test(tag))) return "bad_topic";
  return null;
}
