import type { PostFeatures, PostFormat } from "@/lib/analysis/formats";
import { utcDay, zonedParts, zonedTimeToUtc } from "@/lib/analysis/time";
import type { AccountDay, PostInsights, PostWithInsights, ThreadsProfile } from "@/lib/threads/types";
import type { DemoPersona } from "./personas";

// Turns a persona's hand-written posts into a realistic 60-day history.
// Randomness is seeded per persona, and dates are anchored to "today", so the
// demo always looks current and is identical for everyone on a given day.

export const DEMO_HISTORY_DAYS = 60;
const DAY_MS = 86_400_000;

export interface DemoDataset {
  profile: ThreadsProfile & { followersCount: number };
  posts: PostWithInsights[];
  /** Oldest → newest; complete UTC days ending yesterday. */
  days: AccountDay[];
}

type Multipliers = { views: number; like: number; reply: number; repost: number; quote: number; share: number };

const FORMAT_EFFECT: Record<PostFormat, Multipliers> = {
  question: { views: 0.9, like: 0.8, reply: 3.0, repost: 0.5, quote: 0.8, share: 0.6 },
  hot_take: { views: 1.7, like: 1.1, reply: 1.8, repost: 1.2, quote: 2.6, share: 1.0 },
  story: { views: 1.2, like: 1.6, reply: 1.2, repost: 1.0, quote: 0.6, share: 1.0 },
  list: { views: 1.3, like: 1.2, reply: 0.6, repost: 2.1, quote: 0.8, share: 2.3 },
  tip: { views: 1.1, like: 1.1, reply: 0.7, repost: 1.6, quote: 0.7, share: 1.8 },
  observation: { views: 1.0, like: 1.0, reply: 0.8, repost: 0.9, quote: 1.0, share: 0.8 },
  series: { views: 1.3, like: 1.2, reply: 0.8, repost: 2.0, quote: 0.8, share: 2.0 },
};

/** Share of a post's lifetime views/engagement that lands on day 0, 1, 2 after posting. */
const DAILY_SPREAD = [0.62, 0.26, 0.12];

/** mulberry32: tiny, fast, good enough for demo data. */
function createRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return {
    next,
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    /** Multiplicative noise centred on 1. */
    noise: (sigma: number) => Math.exp(sigma * normal() - (sigma * sigma) / 2),
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hourEffect(hour: number, peaks: number[]): number {
  const distance = Math.min(...peaks.map((p) => Math.min(Math.abs(hour - p), 24 - Math.abs(hour - p))));
  return 0.7 + 0.6 * Math.exp(-(distance * distance) / 6);
}

function shortcode(random: ReturnType<typeof createRandom>): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  return Array.from({ length: 11 }, () => random.pick([...alphabet])).join("");
}

export function generateDemoDataset(persona: DemoPersona, now: Date): DemoDataset {
  const random = createRandom(hash(persona.id));
  const todayStart = Date.parse(`${utcDay(now)}T00:00:00Z`);
  const firstDay = todayStart - DEMO_HISTORY_DAYS * DAY_MS;
  const growthPerDay = persona.dailyFollowerGrowth;
  const followersOn = (dayIndex: number) => persona.followersStart + growthPerDay * dayIndex;

  // 1. Place posts across the window, oldest seed first, roughly evenly spaced.
  const seeds = persona.posts;
  const posts: PostWithInsights[] = seeds.map((seed, i) => {
    const dayIndex = Math.min(
      DEMO_HISTORY_DAYS,
      Math.max(0, Math.round(((i + 0.5) * DEMO_HISTORY_DAYS) / seeds.length) + random.int(-1, 1)),
    );
    const local = zonedParts(new Date(firstDay + dayIndex * DAY_MS + 12 * 3_600_000), persona.timezone);
    const hour = random.pick(persona.postingHours);
    let posted = zonedTimeToUtc(
      { year: local.year, month: local.month, day: local.day, hour, minute: random.int(0, 59) },
      persona.timezone,
    );
    // Never in the future; a post from "today" that hasn't happened yet moves back a day.
    while (posted.getTime() > now.getTime() - 45 * 60_000) posted = new Date(posted.getTime() - DAY_MS);

    const effect = FORMAT_EFFECT[seed.format];
    const media = seed.mediaType === "IMAGE" ? { views: 1.25, like: 1.3 } : { views: 1, like: 1 };
    const ageHours = (now.getTime() - posted.getTime()) / 3_600_000;
    const matured = 1 - Math.exp(-ageHours / 18);
    // Reach drifts up over the window: the demo account is on a (realistic) good run.
    const reach = followersOn(dayIndex) * persona.reach * (0.85 + (0.3 * dayIndex) / DEMO_HISTORY_DAYS);
    const views = Math.round(
      reach *
        effect.views *
        media.views *
        hourEffect(hour, persona.peakHours) *
        (seed.topicTag ? 1.15 : 1) *
        random.noise(0.45) *
        matured,
    );
    const count = (rate: number, multiplier: number) => Math.round(views * rate * multiplier * random.noise(0.35));
    const insights: PostInsights = {
      views,
      likes: count(persona.rates.like, effect.like * media.like),
      replies: count(persona.rates.reply, effect.reply),
      reposts: count(persona.rates.repost, effect.repost),
      quotes: count(persona.rates.quote, effect.quote),
      shares: count(persona.rates.share, effect.share),
    };
    const code = shortcode(random);
    return {
      id: `${persona.profile.id}-${i + 1}`,
      text: seed.text,
      timestamp: posted.toISOString(),
      mediaType: seed.mediaType ?? "TEXT_POST",
      permalink: `https://www.threads.net/@${persona.profile.username}/post/${code}`,
      isQuotePost: false,
      topicTag: seed.topicTag ?? null,
      insights,
    };
  });

  // 2. Roll post activity and a baseline into complete UTC days, ending yesterday.
  const days: AccountDay[] = [];
  let followers = persona.followersStart;
  for (let d = 0; d < DEMO_HISTORY_DAYS; d++) {
    const dayStart = firstDay + d * DAY_MS;
    const baseline = followersOn(d) * 0.05 * random.noise(0.3);
    const day = { views: baseline, likes: baseline * 0.01, replies: 0, reposts: 0, quotes: 0 };
    let amplified = 0;
    for (const post of posts) {
      const offset = Math.floor((dayStart - Date.parse(`${post.timestamp.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
      const share = DAILY_SPREAD[offset];
      if (share === undefined) continue;
      day.views += post.insights.views * share;
      day.likes += post.insights.likes * share;
      day.replies += post.insights.replies * share;
      day.reposts += post.insights.reposts * share;
      day.quotes += post.insights.quotes * share;
      amplified += (post.insights.reposts + post.insights.quotes + post.insights.shares) * share;
    }
    followers += Math.max(
      -Math.round(growthPerDay),
      Math.round(growthPerDay * random.noise(0.5) + amplified * 0.8 + day.views * 0.0006 - growthPerDay * 0.3),
    );
    days.push({
      date: utcDay(new Date(dayStart)),
      views: Math.round(day.views),
      likes: Math.round(day.likes),
      replies: Math.round(day.replies),
      reposts: Math.round(day.reposts),
      quotes: Math.round(day.quotes),
      followersCount: followers,
    });
  }

  return {
    profile: { ...persona.profile, followersCount: followers },
    posts: posts.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    days,
  };
}

/** The demo's hand-labelled formats and topics, keyed like its generated posts. */
export function demoFeatures(persona: DemoPersona): Map<string, PostFeatures> {
  return new Map(
    persona.posts.map((seed, i) => [
      `${persona.profile.id}-${i + 1}`,
      { format: seed.format, topic: seed.topic.toLowerCase(), hookType: null, tone: null },
    ]),
  );
}
