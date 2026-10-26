import { describe, expect, it } from "vitest";
import { generateDemoDataset } from "./generate";
import { DEMO_PERSONAS } from "./personas";
import { demoScorecard } from "./scorecard";

const now = new Date("2026-10-20T19:30:00Z");

describe("demo scorecard", () => {
  it("shows the three latest posts, scored like a real account's", () => {
    for (const persona of Object.values(DEMO_PERSONAS)) {
      const { entries, line } = demoScorecard(generateDemoDataset(persona, now).posts, now);
      expect(entries).toHaveLength(3);
      expect(line).toMatch(/your usual views at/);
      const multipliers = entries.flatMap((e) =>
        e.chips.flatMap((c) => (c.state === "measured" && c.multiplier !== null ? [c.multiplier.toFixed(1)] : [])),
      );
      // Early readings vary per post, so the chips tell different stories.
      expect(new Set(multipliers).size).toBeGreaterThan(2);
    }
  });
});
