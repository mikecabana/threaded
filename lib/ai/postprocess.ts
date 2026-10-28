import { MAX_SERIES_PARTS } from "@/lib/publishing/draft";
import { THREADS_MAX_LENGTH, THREADS_MAX_LINKS, threadsLength, threadsLinkCount } from "@/lib/threads/length";
import type { IdeaShape, Suggestion } from "./schemas";
import { bannedWordIn, hasEmoji, type VoicePrefs } from "./voice";

// Model output is a draft: enforce what the schema can't (length, ranges) and
// drop ideas that repeat the author's own posts, the Threads posts research
// read on the topic, or each other, and ideas that break the author's voice
// settings (a banned word, or emoji when they've turned emoji off). A thread
// is checked post by post, and dropped whole if any of its posts fails.

export type DropReason = "too_long" | "too_many_links" | "duplicate" | "empty" | "banned_word" | "emoji";

export interface ProcessedBatch {
  kept: Suggestion[];
  dropped: { text: string; reason: DropReason }[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(text: string): Set<string> {
  const s = ` ${normalize(text)} `;
  const grams = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) grams.add(s.slice(i, i + 3));
  return grams;
}

/** Jaccard similarity of character trigrams: 1 = identical, ~0 = unrelated. */
export function similarity(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)));

const tidy = (text: string) => text.trim().replace(/\n{3,}/g, "\n\n");

/**
 * Keeps at most `limit` ideas; extras past the limit aren't counted as
 * dropped. Single-post ideas lose any parts the model added anyway.
 */
export function postProcess(
  suggestions: Suggestion[],
  pastPosts: string[],
  limit = Infinity,
  voice: VoicePrefs = {},
  shape: IdeaShape = "post",
): ProcessedBatch {
  const kept: Suggestion[] = [];
  const dropped: ProcessedBatch["dropped"] = [];
  for (const raw of suggestions) {
    if (kept.length >= limit) break;
    const text = tidy(raw.text);
    const parts =
      shape === "thread"
        ? (raw.parts ?? [])
            .map(tidy)
            .filter(Boolean)
            .slice(0, MAX_SERIES_PARTS - 1)
        : [];
    const posts = [text, ...parts];
    if (!text) {
      dropped.push({ text, reason: "empty" });
    } else if (posts.some((post) => threadsLength(post) > THREADS_MAX_LENGTH)) {
      dropped.push({ text, reason: "too_long" });
    } else if (posts.some((post) => threadsLinkCount(post) > THREADS_MAX_LINKS)) {
      dropped.push({ text, reason: "too_many_links" });
    } else if (posts.some((post) => bannedWordIn(post, voice.bannedWords ?? []))) {
      dropped.push({ text, reason: "banned_word" });
    } else if (voice.emoji === "none" && posts.some(hasEmoji)) {
      dropped.push({ text, reason: "emoji" });
    } else if (
      [...pastPosts, ...kept.map((k) => k.text)].some((other) => similarity(text, other) >= DUPLICATE_THRESHOLD)
    ) {
      dropped.push({ text, reason: "duplicate" });
    } else {
      kept.push({
        ...raw,
        text,
        parts,
        hook: raw.hook.trim(),
        rationale: raw.rationale.trim(),
        goalFit: clamp(Number.isFinite(raw.goalFit) ? raw.goalFit : 50, 0, 100),
        bestSlot: {
          weekday: ((Math.round(raw.bestSlot.weekday) % 7) + 7) % 7,
          hour: ((Math.round(raw.bestSlot.hour) % 24) + 24) % 24,
        },
      });
    }
  }
  return { kept, dropped };
}
