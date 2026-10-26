import { describe, expect, it } from "vitest";
import {
  baselineAt,
  CHECKPOINTS,
  type Chip,
  matchDrafts,
  readingAt,
  scoreAt72h,
  scoreChips,
  scorecardLine,
  type TrackedPost,
} from "./scorecard";

const HOUR = 3_600_000;
const [AT_1H, AT_24H, AT_72H] = CHECKPOINTS;
const start = Date.parse("2026-10-01T12:00:00Z");

/** A post published `day` days after the start, measured at the given ages (hours → views). */
function post(id: string, day: number, readings: Record<number, number>, latestViews?: number): TrackedPost {
  const postedAt = start + day * 24 * HOUR;
  return {
    id,
    postedAt: new Date(postedAt).toISOString(),
    snapshots: Object.entries(readings).map(([age, views]) => ({
      at: new Date(postedAt + Number(age) * HOUR).toISOString(),
      views,
    })),
    latestViews,
  };
}

const at = (day: number, hours = 0) => new Date(start + day * 24 * HOUR + hours * HOUR);

describe("readings", () => {
  it("takes the snapshot closest to the checkpoint, inside its window", () => {
    const p = post("p", 0, { 0.25: 10, 1.2: 120, 1.9: 150, 20: 900, 30: 1000, 60: 1500 });
    expect(readingAt(p, AT_1H)?.views).toBe(120);
    expect(readingAt(p, AT_24H)?.views).toBe(900);
    expect(readingAt(p, AT_72H)?.views).toBe(1500);
    expect(readingAt(post("q", 0, { 0.25: 10, 40: 900 }), AT_24H)).toBeNull();
  });
});

describe("baselines", () => {
  const history = [
    post("a", 0, { 1: 100, 24: 800, 72: 1000 }, 1100),
    post("b", 1, { 1: 200, 24: 900 }, 1300),
    post("c", 2, { 1: 300, 24: 1000 }, 1500),
    post("d", 3, { 1: 50 }, 900),
  ];
  const mine = post("mine", 4, { 1: 400, 24: 1800, 72: 2600 });
  const now = at(9);

  it("is the median of earlier posts measured at the same age", () => {
    expect(baselineAt(AT_1H, mine, history, now)).toEqual({ views: 150, posts: 4, basis: "age" });
    expect(baselineAt(AT_24H, mine, history, now)).toEqual({ views: 900, posts: 3, basis: "age" });
  });

  it("only counts posts published before this one", () => {
    expect(baselineAt(AT_1H, history[1], history, now)).toBeNull();
  });

  it("falls back to final views at 3 days, but not earlier", () => {
    expect(baselineAt(AT_72H, mine, history, now)).toEqual({ views: 1200, posts: 4, basis: "settled" });
    const unmeasured = history.map((h) => ({ ...h, snapshots: [] }));
    expect(baselineAt(AT_24H, mine, unmeasured, now)).toBeNull();
  });
});

describe("chips", () => {
  const history = [
    post("a", 0, { 1: 100, 24: 800, 72: 1000 }),
    post("b", 1, { 1: 100, 24: 800, 72: 1000 }),
    post("c", 2, { 1: 100, 24: 800, 72: 1000 }),
  ];

  it("scores each checkpoint against the usual", () => {
    const mine = post("mine", 5, { 1: 150, 24: 400, 72: 2000 });
    const chips = scoreChips(mine, history, at(10));
    expect(chips.map((c) => (c.state === "measured" ? c.multiplier : c.state))).toEqual([1.5, 0.5, 2]);
    expect(scoreAt72h(mine, history, at(10))).toBe(2);
  });

  it("waits for checkpoints that haven't come yet, and marks the ones that were never measured", () => {
    const fresh = post("fresh", 5, { 1: 150 });
    const chips = scoreChips(fresh, history, at(5, 3));
    expect(chips.map((c) => c.state)).toEqual(["measured", "pending", "pending"]);
    expect((chips[1] as Extract<Chip, { state: "pending" }>).dueAt).toBe(at(6).toISOString());

    const later = scoreChips(fresh, history, at(10));
    expect(later.map((c) => c.state)).toEqual(["measured", "missed", "missed"]);
    expect(scoreAt72h(fresh, history, at(10))).toBeNull();
  });

  it("shows the number without a multiplier until there's a usual", () => {
    const chips = scoreChips(post("first", 0, { 1: 80 }), [], at(0, 3));
    expect(chips[0]).toMatchObject({ state: "measured", views: 80, baseline: null, multiplier: null });
  });
});

describe("summary line", () => {
  const measured = (id: (typeof CHECKPOINTS)[number]["id"], multiplier: number | null): Chip => ({
    checkpoint: CHECKPOINTS.find((c) => c.id === id) ?? AT_1H,
    state: "measured",
    views: 100,
    baseline: null,
    multiplier,
  });

  it("speaks to the latest checkpoint with scores", () => {
    expect(scorecardLine([{ chips: [measured("72h", 1.4)] }, { chips: [measured("72h", 0.8)] }])).toBe(
      "1 of 2 posts beat your usual views at 3 days.",
    );
    expect(
      scorecardLine([{ chips: [measured("1h", 1.2), measured("24h", 1.1)] }, { chips: [measured("24h", 2)] }]),
    ).toBe("Both posts beat your usual views at 1 day.");
    // 1.04× shows as 1.0×, so it doesn't count as beating the usual.
    expect(
      scorecardLine([
        { chips: [measured("72h", 1.04)] },
        { chips: [measured("72h", 1.5)] },
        { chips: [measured("72h", 2)] },
      ]),
    ).toBe("2 of 3 posts beat your usual views at 3 days.");
    expect(scorecardLine([{ chips: [measured("24h", 0.7)] }])).toBe(
      "The one post scored so far is below your usual views at 1 day.",
    );
  });

  it("explains itself before anything is scored", () => {
    expect(scorecardLine([{ chips: [measured("1h", null)] }])).toMatch(/compared with your usual views/);
    expect(scorecardLine([])).toBe("");
  });
});

describe("matching posts to drafts", () => {
  const drafts = [
    { id: "d1", text: "Shipped the new onboarding today. Signups up 18% in a week.", createdAt: at(0).toISOString() },
    { id: "d2", text: "What's the one tool you'd keep if you had to drop the rest?", createdAt: at(0).toISOString() },
    { id: "old", text: "Morning routine: coffee, inbox zero, then deep work.", createdAt: at(-40).toISOString() },
  ];

  it("pairs an edited post with the draft it came from", () => {
    const posts = [
      {
        id: "p1",
        text: "Shipped the new onboarding today! Signups are up 18% in one week.",
        postedAt: at(2).toISOString(),
      },
      { id: "p2", text: "Completely unrelated thought about the weather.", postedAt: at(2).toISOString() },
    ];
    expect(matchDrafts(posts, drafts)).toEqual([{ postId: "p1", draftId: "d1", score: expect.any(Number) }]);
  });

  it("ignores drafts written after the post or more than 30 days before it", () => {
    const posts = [
      { id: "early", text: drafts[1].text, postedAt: at(-1).toISOString() },
      { id: "late", text: drafts[2].text, postedAt: at(1).toISOString() },
    ];
    expect(matchDrafts(posts, drafts)).toEqual([]);
  });

  it("uses each draft once, for its closest post", () => {
    const posts = [
      { id: "near", text: drafts[1].text, postedAt: at(1).toISOString() },
      { id: "nearish", text: `${drafts[1].text} Asking for a friend.`, postedAt: at(1).toISOString() },
    ];
    expect(matchDrafts(posts, drafts).map((m) => [m.postId, m.draftId])).toEqual([["near", "d2"]]);
  });
});
