import { describe, expect, it } from "vitest";
import { DNA_SCHEMA_VERSION } from "@/lib/ai/dna-prompt";
import { demoDna } from "./dna";
import { generateDemoDataset } from "./generate";
import { DEMO_PERSONAS } from "./personas";

const now = new Date("2026-10-20T19:30:00Z");

describe("demo Profile DNA", () => {
  for (const persona of Object.values(DEMO_PERSONAS)) {
    it(`builds ${persona.id}'s DNA from its own measured facts`, () => {
      const dna = demoDna(persona, generateDemoDataset(persona, now), now);
      expect(dna.schema).toBe(DNA_SCHEMA_VERSION);
      expect(dna.headline).toMatch(/^You're at your best/);
      expect(dna.rewards.length).toBeGreaterThan(0);
      expect(dna.rewards.every((r) => r.fact.multiplier > 1 && r.claim.startsWith("Your audience shows up for"))).toBe(
        true,
      );
      expect(dna.blindSpots.every((b) => b.fact.multiplier < 1)).toBe(true);
      expect(dna.topics.filter((t) => t.core)).toHaveLength(3);
    });
  }
});
