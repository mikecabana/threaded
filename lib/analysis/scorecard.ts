import { similarity } from "@/lib/ai/postprocess";
import { median } from "./metrics";

// The suggestion scorecard (docs/PLAN.md §5, "Feedback loop"): how a post from
// Threaded did at 1 hour, 1 day and 3 days, against how the author's posts
// usually do at the same age. Views only, so every goal reads it the same way.
// Pure functions over metric snapshots.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface Checkpoint {
  id: "1h" | "24h" | "72h";
  hours: number;
  /** "1 hour", for sentences and screen readers. */
  label: string;
  /** "1h", for the chip. */
  short: string;
  /** A snapshot taken between these ages (in hours) counts as this checkpoint. */
  window: readonly [number, number];
}

/**
 * The publish workflow snapshots at +1h, +24h and +72h; the daily sync
 * measures every post from the last two weeks once a day, so a post written
 * elsewhere usually gets a reading in the 1-day and 3-day windows too.
 */
export const CHECKPOINTS: readonly Checkpoint[] = [
  { id: "1h", hours: 1, label: "1 hour", short: "1h", window: [0.5, 2] },
  { id: "24h", hours: 24, label: "1 day", short: "1d", window: [16, 36] },
  { id: "72h", hours: 72, label: "3 days", short: "3d", window: [54, 96] },
];

const AT_72H = CHECKPOINTS[2];

/** A draft that beats the author's usual by this much at 3 days is a winner. */
export const WINNER = 1.3;
/** Earlier posts measured at a checkpoint before it has a usual to compare with. */
export const MIN_BASELINE_POSTS = 3;
/** The usual is the median of up to this many earlier posts. */
const BASELINE_POSTS = 30;

export interface Snapshot {
  at: string;
  views: number;
}

export interface TrackedPost {
  id: string;
  postedAt: string;
  /** Snapshots from the post's first days, in any order. */
  snapshots: Snapshot[];
  /** The latest view count, used for the 3-day fallback. */
  latestViews?: number;
}

export interface Baseline {
  views: number;
  posts: number;
  /** "age": earlier posts at the same age. "settled": earlier posts' final views (3 days only). */
  basis: "age" | "settled";
}

export type Chip =
  | { checkpoint: Checkpoint; state: "pending"; dueAt: string }
  | { checkpoint: Checkpoint; state: "missed" }
  | { checkpoint: Checkpoint; state: "measured"; views: number; baseline: Baseline | null; multiplier: number | null };

/** One post on the scorecard. */
export interface ScorecardEntry {
  postId: string;
  text: string;
  permalink: string | null;
  postedAt: string;
  /** "threaded": published through Threaded. "matched": posted elsewhere, from a Studio draft. */
  source: "threaded" | "matched";
  chips: Chip[];
}

/** Whether a multiplier beats the usual as shown (to one decimal): 1.04× reads as 1.0×, not a win. */
export const beatsUsual = (multiplier: number) => Math.round(multiplier * 10) / 10 > 1;
/** Whether it's below the usual as shown. */
export const belowUsual = (multiplier: number) => Math.round(multiplier * 10) / 10 < 1;

const ageHours = (post: TrackedPost, at: string) => (Date.parse(at) - Date.parse(post.postedAt)) / HOUR_MS;

/** The post's snapshot closest to the checkpoint, if one falls in its window. */
export function readingAt(post: TrackedPost, checkpoint: Checkpoint): Snapshot | null {
  let best: Snapshot | null = null;
  let bestGap = Infinity;
  for (const snapshot of post.snapshots) {
    const age = ageHours(post, snapshot.at);
    if (age < checkpoint.window[0] || age > checkpoint.window[1]) continue;
    const gap = Math.abs(age - checkpoint.hours);
    if (gap < bestGap) {
      best = snapshot;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * The author's usual views at a checkpoint: the median over the (up to) 30
 * posts before this one that were measured at that age. At 3 days, posts
 * have collected most of their views, so until enough were measured at that
 * age, earlier posts' final counts stand in.
 */
export function baselineAt(
  checkpoint: Checkpoint,
  post: TrackedPost,
  history: TrackedPost[],
  now: Date,
): Baseline | null {
  const postedAt = Date.parse(post.postedAt);
  const before = history
    .filter((h) => h.id !== post.id && Date.parse(h.postedAt) < postedAt)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));

  const atAge = before.flatMap((h) => readingAt(h, checkpoint)?.views ?? []).slice(0, BASELINE_POSTS);
  if (atAge.length >= MIN_BASELINE_POSTS) return { views: median(atAge), posts: atAge.length, basis: "age" };

  if (checkpoint.id === AT_72H.id) {
    const settled = before
      .filter((h) => h.latestViews !== undefined && now.getTime() - Date.parse(h.postedAt) >= 72 * HOUR_MS)
      .slice(0, BASELINE_POSTS)
      .map((h) => h.latestViews as number);
    if (settled.length >= MIN_BASELINE_POSTS)
      return { views: median(settled), posts: settled.length, basis: "settled" };
  }
  return null;
}

/** The post's three chips: waiting, measured (against the usual when there is one), or missed. */
export function scoreChips(post: TrackedPost, history: TrackedPost[], now: Date): Chip[] {
  const postedAt = Date.parse(post.postedAt);
  return CHECKPOINTS.map((checkpoint): Chip => {
    const reading = readingAt(post, checkpoint);
    if (!reading) {
      if (now.getTime() < postedAt + checkpoint.window[1] * HOUR_MS) {
        return { checkpoint, state: "pending", dueAt: new Date(postedAt + checkpoint.hours * HOUR_MS).toISOString() };
      }
      return { checkpoint, state: "missed" };
    }
    const baseline = baselineAt(checkpoint, post, history, now);
    return {
      checkpoint,
      state: "measured",
      views: reading.views,
      baseline,
      multiplier: baseline && baseline.views > 0 ? reading.views / baseline.views : null,
    };
  });
}

/** Views against the usual at 3 days (what's stored as the suggestion's score), or null until then. */
export function scoreAt72h(post: TrackedPost, history: TrackedPost[], now: Date): number | null {
  const chip = scoreChips(post, history, now)[2];
  return chip.state === "measured" ? chip.multiplier : null;
}

/** The scorecard's one-line summary. */
export function scorecardLine(cards: { chips: Chip[] }[]): string {
  if (cards.length === 0) return "";
  // The latest checkpoint anything was scored at says the most.
  for (const checkpoint of [...CHECKPOINTS].reverse()) {
    const multipliers = cards.flatMap((card) =>
      card.chips.flatMap((chip) =>
        chip.checkpoint.id === checkpoint.id && chip.state === "measured" && chip.multiplier !== null
          ? [chip.multiplier]
          : [],
      ),
    );
    if (multipliers.length === 0) continue;
    const beat = multipliers.filter(beatsUsual).length;
    const at = `your usual views at ${checkpoint.label}`;
    if (multipliers.length === 1) {
      return beat ? `The one post scored so far beat ${at}.` : `The one post scored so far is below ${at}.`;
    }
    if (beat === multipliers.length) return beat === 2 ? `Both posts beat ${at}.` : `All ${beat} posts beat ${at}.`;
    return `${beat} of ${multipliers.length} posts beat ${at}.`;
  }
  return "Each post is compared with your usual views at 1 hour, 1 day and 3 days, once there's enough history.";
}

// ── Matching posts written elsewhere ─────────────────────────────────────────

/** How close a post must be to a draft to count as that draft, edits and all. */
export const MATCH_THRESHOLD = 0.5;
/** Drafts older than this when the post went out aren't considered. */
export const MATCH_DAYS = 30;

export interface Draft {
  id: string;
  text: string;
  createdAt: string;
}

export interface Match {
  postId: string;
  draftId: string;
  score: number;
}

/**
 * Pairs posts the author published themselves with the Studio drafts they
 * came from: the most similar draft written in the 30 days before the post.
 * Each draft and each post is used once, best pairs first.
 */
export function matchDrafts(posts: { id: string; text: string; postedAt: string }[], drafts: Draft[]): Match[] {
  const candidates: Match[] = [];
  for (const post of posts) {
    const postedAt = Date.parse(post.postedAt);
    for (const draft of drafts) {
      const createdAt = Date.parse(draft.createdAt);
      if (createdAt > postedAt || postedAt - createdAt > MATCH_DAYS * DAY_MS) continue;
      const score = similarity(post.text, draft.text);
      if (score >= MATCH_THRESHOLD) candidates.push({ postId: post.id, draftId: draft.id, score });
    }
  }
  const usedPosts = new Set<string>();
  const usedDrafts = new Set<string>();
  const matches: Match[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    if (usedPosts.has(candidate.postId) || usedDrafts.has(candidate.draftId)) continue;
    usedPosts.add(candidate.postId);
    usedDrafts.add(candidate.draftId);
    matches.push(candidate);
  }
  return matches;
}
