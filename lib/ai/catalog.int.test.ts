import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { modelCatalog } from "@/lib/db/schema";
import { closeDatabase, resetDatabase } from "@/test/db";
import { catalogFor, DEFAULT_CATALOG, syncCatalogFromGateway } from "./catalog";

beforeAll(resetDatabase);
afterAll(closeDatabase);

describe("model catalog", () => {
  it("seeds itself on first use, cheapest tier first", async () => {
    const entries = await catalogFor("generate");
    expect(entries.map((e) => e.tier)).toEqual(["fast", "balanced", "best"]);
    expect(await db().select().from(modelCatalog)).toHaveLength(DEFAULT_CATALOG.length);
  });

  it("takes live prices from the Gateway and disables models it no longer offers", async () => {
    const result = await syncCatalogFromGateway(async () => ({
      models: [
        // Per-token USD strings, as the Gateway reports them.
        { id: "anthropic/claude-sonnet-5.5", pricing: { input: "0.0000025", output: "0.0000125" } },
        { id: "anthropic/claude-haiku-5.5", pricing: null },
      ],
    }));
    expect(result).toEqual({ updated: 2, disabled: 1 });

    const [sonnet] = await db()
      .select()
      .from(modelCatalog)
      .where(eq(modelCatalog.modelId, "anthropic/claude-sonnet-5.5"));
    expect(Number(sonnet.inputPrice)).toBe(2.5);
    expect(Number(sonnet.outputPrice)).toBe(12.5);
    // Markups are ours and never overwritten by a sync.
    expect(Number(sonnet.markup)).toBe(2);

    const generate = await catalogFor("generate");
    expect(generate.map((e) => e.modelId)).not.toContain("anthropic/claude-opus-5.5");
  });
});
