import { type ScorecardEntry, scoreChips, scorecardLine, type TrackedPost } from "@/lib/analysis/scorecard";
import type { PostWithInsights } from "@/lib/threads/types";

// The demo's sample scorecard. Demo posts only have final numbers, so their
// first days follow a typical curve (most views arrive on day one), nudged per
// post so some start slow and finish strong, as real posts do.

const HOUR_MS = 3_600_000;
/** Share of a post's final views at each snapshot age (hours). */
const CURVE: [number, number][] = [
  [1, 0.1],
  [24, 0.7],
  [72, 0.92],
];

/** A stable 0.7–1.3 factor per post and snapshot (FNV-1a, then a final mix). */
function nudge(id: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x5bd1e995) >>> 0;
  h ^= h >>> 13;
  return 0.7 + (h % 1000) / 1666;
}

function tracked(post: PostWithInsights, now: Date): TrackedPost {
  const postedAt = Date.parse(post.timestamp);
  const snapshots = CURVE.flatMap(([hours, share], i) => {
    const at = postedAt + hours * HOUR_MS;
    if (at > now.getTime()) return [];
    const views = Math.round(post.insights.views * Math.min(1, share * nudge(post.id, i)));
    return [{ at: new Date(at).toISOString(), views }];
  });
  return { id: post.id, postedAt: post.timestamp, snapshots, latestViews: post.insights.views };
}

export function demoScorecard(posts: PostWithInsights[], now: Date, count = 3) {
  const history = posts.map((p) => tracked(p, now));
  const entries = [...posts]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, count)
    .map(
      (post): ScorecardEntry => ({
        postId: post.id,
        text: post.text,
        permalink: post.permalink || null,
        postedAt: post.timestamp,
        source: "threaded",
        chips: scoreChips(tracked(post, now), history, now),
      }),
    );
  return { entries, line: scorecardLine(entries) };
}
