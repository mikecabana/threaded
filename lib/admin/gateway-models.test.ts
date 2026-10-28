import { afterEach, describe, expect, it } from "vitest";
import { MOCK_GATEWAY_MODELS } from "@/lib/ai/mock-gateway-models";
import {
  batchCredits,
  fetchGatewayModels,
  filterModels,
  languageModels,
  parseFilters,
  providerCounts,
  providerName,
  suggestTier,
} from "./gateway-models";

const models = languageModels(MOCK_GATEWAY_MODELS);
const ids = (list: { id: string }[]) => list.map((m) => m.id);
const filters = (params: Record<string, string> = {}) => parseFilters(params);

describe("the Gateway's model list", () => {
  it("keeps the language models, priced per million tokens", () => {
    expect(ids(models)).not.toContain("openai/text-embedding-4-small");
    expect(ids(models)).not.toContain("vercel/jev");
    expect(models.find((m) => m.id === "anthropic/claude-sonnet-5.5")).toEqual({
      id: "anthropic/claude-sonnet-5.5",
      name: "Claude Sonnet 5.5",
      provider: "Anthropic",
      description: "Anthropic's balanced model.",
      inputPrice: 3,
      outputPrice: 15,
    });
    expect(models.find((m) => m.id === "deepseek/deepseek-v4")).toMatchObject({ inputPrice: 0.27, outputPrice: 1.1 });
    expect(models.find((m) => m.id === "meta/llama-5-70b")).toMatchObject({ inputPrice: null, outputPrice: null });
  });

  it("names providers from the ID, including ones it doesn't know", () => {
    expect(providerName("openai/gpt-5.5")).toBe("OpenAI");
    expect(providerName("moonshotai/kimi-k3")).toBe("Moonshot AI");
    expect(providerName("acme/model-1")).toBe("Acme");
    expect(providerCounts(models).find((p) => p.provider === "Anthropic")).toEqual({ provider: "Anthropic", count: 3 });
  });

  it("suggests a tier from the output price", () => {
    expect(suggestTier(2)).toBe("fast");
    expect(suggestTier(5)).toBe("fast");
    expect(suggestTier(15)).toBe("balanced");
    expect(suggestTier(25)).toBe("best");
    expect(suggestTier(null)).toBe("balanced");
  });

  it("prices a batch of five ideas the way the catalog would at the default markup", () => {
    // 2,500 in and 1,400 out on Sonnet: $0.0285, ×2 = 5.7¢.
    expect(batchCredits({ inputPrice: 3, outputPrice: 15 })).toBe(6);
    expect(batchCredits({ inputPrice: 0.25, outputPrice: 2 })).toBe(1);
    expect(batchCredits({ inputPrice: null, outputPrice: null })).toBeNull();
  });

  it("comes from the mock under AI_MOCK=1", async () => {
    process.env.AI_MOCK = "1";
    const listing = await fetchGatewayModels();
    expect(listing.ok && listing.models.length).toBe(models.length);
  });
  afterEach(() => {
    process.env.AI_MOCK = "";
  });
});

describe("filtering", () => {
  const inCatalog = new Set(["anthropic/claude-sonnet-5.5", "anthropic/claude-haiku-5.5"]);

  it("reads the query string, falling back to the defaults", () => {
    expect(filters()).toEqual({ q: "", provider: "", show: "all", sort: "cheapest" });
    expect(parseFilters({ q: "  gpt ", show: "new", sort: "name", provider: "OpenAI" })).toEqual({
      q: "gpt",
      provider: "OpenAI",
      show: "new",
      sort: "name",
    });
    expect(parseFilters({ show: "toString", sort: ["priciest", "name"] })).toMatchObject({
      show: "all",
      sort: "priciest",
    });
  });

  it("matches every word against the ID, name and provider", () => {
    expect(ids(filterModels(models, filters({ q: "gpt mini" }), inCatalog))).toEqual(["openai/gpt-5.5-mini"]);
    expect(ids(filterModels(models, filters({ q: "GOOGLE" }), inCatalog))).toEqual([
      "google/gemini-3.5-flash",
      "google/gemini-3.5-pro",
    ]);
    expect(filterModels(models, filters({ q: "nothing-like-this" }), inCatalog)).toEqual([]);
  });

  it("narrows to a provider, and to what is or isn't in the catalog", () => {
    expect(ids(filterModels(models, filters({ provider: "Anthropic", show: "new" }), inCatalog))).toEqual([
      "anthropic/claude-opus-5.5",
    ]);
    expect(ids(filterModels(models, filters({ show: "catalog", sort: "name" }), inCatalog))).toEqual([
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-sonnet-5.5",
    ]);
  });

  it("sorts by a typical batch's price either way, with unpriced models last", () => {
    const cheapest = ids(filterModels(models, filters(), inCatalog));
    expect(cheapest.slice(0, 2)).toEqual(["deepseek/deepseek-v4", "openai/gpt-5.5-mini"]);
    expect(cheapest.at(-1)).toBe("meta/llama-5-70b");
    const priciest = ids(filterModels(models, filters({ sort: "priciest" }), inCatalog));
    expect(priciest[0]).toBe("anthropic/claude-opus-5.5");
    expect(priciest.at(-1)).toBe("meta/llama-5-70b");
    expect(ids(filterModels(models, filters({ sort: "name" }), inCatalog))[0]).toBe("anthropic/claude-haiku-5.5");
  });
});
