import { THREADS_MAX_LENGTH, threadsLength } from "@/lib/threads/length";

// Rules a post must meet before it's queued (shared by the composer and the
// server). ⚠ Topic-tag rules per Meta's docs as of Oct 2026: 1–50 characters,
// no periods or ampersands.

export const TOPIC_TAG_MAX = 50;
/** How far ahead a post can be scheduled. */
export const MAX_SCHEDULE_DAYS = 60;

export type DraftProblem = "empty" | "too_long" | "bad_topic";

export const DRAFT_PROBLEMS: Record<DraftProblem, string> = {
  empty: "Write something first.",
  too_long: `Threads allows ${THREADS_MAX_LENGTH} characters (emoji count as several).`,
  bad_topic: `Topic tags are up to ${TOPIC_TAG_MAX} characters, without periods or ampersands.`,
};

export function normalizeTopic(topic: string | null | undefined): string | null {
  const tag = (topic ?? "").trim().replace(/^#/, "");
  return tag === "" ? null : tag;
}

export function draftProblem(text: string, topic?: string | null): DraftProblem | null {
  if (text.trim() === "") return "empty";
  if (threadsLength(text) > THREADS_MAX_LENGTH) return "too_long";
  const tag = normalizeTopic(topic);
  if (tag && (tag.length > TOPIC_TAG_MAX || /[.&]/.test(tag))) return "bad_topic";
  return null;
}
