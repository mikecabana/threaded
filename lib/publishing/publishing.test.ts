import { describe, expect, it } from "vitest";
import { draftProblem, normalizeTopic } from "./draft";
import { fromLocalInput, nextOccurrence, slotLabel, suggestedSlots, toLocalInput } from "./slots";

const TZ = "America/Toronto";
// Tuesday, Oct 20 2026, 10:30 in Toronto (EDT, UTC−4).
const now = new Date("2026-10-20T14:30:00Z");

describe("draft rules", () => {
  it("counts emoji the way Threads does and checks topic tags", () => {
    expect(draftProblem("Hello")).toBeNull();
    expect(draftProblem("   ")).toBe("empty");
    expect(draftProblem("a".repeat(500))).toBeNull();
    expect(draftProblem("🔥".repeat(126))).toBe("too_long");
    expect(draftProblem("Hi", "Build & ship")).toBe("bad_topic");
    // Threads rejects more than five distinct links.
    const links = (n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${i}`).join(" ");
    expect(draftProblem(links(5))).toBeNull();
    expect(draftProblem(`${links(5)} https://example.com/0`)).toBeNull();
    expect(draftProblem(links(6))).toBe("too_many_links");
    expect(draftProblem("Hi", "x".repeat(51))).toBe("bad_topic");
    expect(normalizeTopic(" #IndieHackers ")).toBe("IndieHackers");
    expect(normalizeTopic("")).toBeNull();
  });
});

describe("time slots", () => {
  it("finds the next occurrence of an hour or a weekday slot", () => {
    expect(nextOccurrence({ hour: 19 }, TZ, now).toISOString()).toBe("2026-10-20T23:00:00.000Z");
    // 9 AM has passed today, so tomorrow.
    expect(nextOccurrence({ hour: 9 }, TZ, now).toISOString()).toBe("2026-10-21T13:00:00.000Z");
    // Thursday 8 AM.
    expect(nextOccurrence({ weekday: 4, hour: 8 }, TZ, now).toISOString()).toBe("2026-10-22T12:00:00.000Z");
    // A slot a few minutes away is too soon to suggest.
    expect(nextOccurrence({ hour: 10 }, TZ, new Date("2026-10-20T13:55:00Z")).toISOString()).toBe(
      "2026-10-21T14:00:00.000Z",
    );
  });

  it("labels slots relative to today in the profile's timezone", () => {
    expect(slotLabel(new Date("2026-10-20T23:00:00Z"), TZ, now)).toBe("Today 7 PM");
    expect(slotLabel(new Date("2026-10-21T13:30:00Z"), TZ, now)).toBe("Tomorrow 9:30 AM");
    expect(slotLabel(new Date("2026-10-23T22:00:00Z"), TZ, now)).toBe("Fri 6 PM");
    expect(slotLabel(new Date("2026-11-04T23:00:00Z"), TZ, now)).toBe("Nov 4, 6 PM");
  });

  it("suggests the idea's slot first, then the author's best hours, without repeats", () => {
    const slots = suggestedSlots({ bestHours: [19, 9, 12], ideaSlot: { weekday: 2, hour: 19 }, timeZone: TZ, now });
    expect(slots.map((s) => [s.label, s.note])).toEqual([
      ["Today 7 PM", "suggested for this idea"],
      ["Tomorrow 9 AM", "your #2 hour"],
      ["Today 12 PM", "your #3 hour"],
    ]);
  });

  it("round-trips datetime-local values through the profile's timezone, across DST", () => {
    expect(toLocalInput(new Date("2026-10-20T23:00:00Z"), TZ)).toBe("2026-10-20T19:00");
    expect(fromLocalInput("2026-10-20T19:00", TZ)?.toISOString()).toBe("2026-10-20T23:00:00.000Z");
    // After DST ends (Nov 1), Toronto is UTC−5.
    expect(fromLocalInput("2026-11-02T19:00", TZ)?.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(fromLocalInput("tomorrow", TZ)).toBeNull();
  });
});
