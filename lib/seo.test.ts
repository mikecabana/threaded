import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { landingStructuredData } from "@/components/marketing/structured-data";
import { FAQS } from "./marketing/faq";
import { BYOK_PLATFORM_FEE_USD } from "./pricing";
import { indexable, pageMetadata, siteUrl } from "./seo";
import { SITE } from "./site";

afterEach(() => vi.unstubAllEnvs());

describe("where canonical URLs point", () => {
  it("uses the production origin everywhere, previews included", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "getthreaded.app" }).origin).toBe("https://getthreaded.app");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "getthreaded.app", VERCEL_ENV: "preview" }).origin).toBe(
      "https://getthreaded.app",
    );
    expect(siteUrl({ APP_URL: "https://staging.example.com/x" }).origin).toBe("https://staging.example.com");
    expect(siteUrl({ PORT: "3100" }).origin).toBe("http://localhost:3100");
  });

  it("lets search engines index production only", () => {
    expect(indexable({ VERCEL_ENV: "production" })).toBe(true);
    expect(indexable({})).toBe(true);
    expect(indexable({ VERCEL_ENV: "preview" })).toBe(false);
    expect(indexable({ VERCEL_ENV: "development" })).toBe(false);
  });

  it("gives a page its canonical URL and share text", () => {
    expect(pageMetadata({ title: "Privacy Policy", description: "What we collect.", path: "/legal/privacy" })).toEqual({
      title: "Privacy Policy",
      description: "What we collect.",
      alternates: { canonical: "/legal/privacy" },
      openGraph: {
        type: "website",
        siteName: "Threaded",
        locale: "en_US",
        title: "Privacy Policy · Threaded",
        description: "What we collect.",
        url: "/legal/privacy",
      },
    });
  });

  it("keeps the home page's title and description short enough for search results", () => {
    expect(SITE.title.length).toBeLessThanOrEqual(60);
    expect(SITE.description.length).toBeLessThanOrEqual(160);
  });
});

describe("robots.txt and the sitemap", () => {
  it("sends crawlers to the sitemap and away from signed-in pages in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "getthreaded.app");
    const rules = robots();
    expect(rules.sitemap).toBe("https://getthreaded.app/sitemap.xml");
    expect(rules.rules).toMatchObject({ userAgent: "*", allow: "/" });
    expect((rules.rules as { disallow: string[] }).disallow).toEqual(
      expect.arrayContaining(["/api/", "/home", "/studio", "/admin", "/onboarding"]),
    );
  });

  it("turns every crawler away from a preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("lists the public pages on the production domain, with the legal pages' dates", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "getthreaded.app");
    expect(sitemap()).toEqual([
      { url: "https://getthreaded.app/" },
      { url: "https://getthreaded.app/connect" },
      { url: "https://getthreaded.app/legal/terms", lastModified: SITE.legalUpdated.terms },
      { url: "https://getthreaded.app/legal/privacy", lastModified: SITE.legalUpdated.privacy },
    ]);
  });
});

describe("the home page's structured data", () => {
  const data = landingStructuredData(new URL("https://getthreaded.app"));
  const node = (type: string) => data["@graph"].find((n) => n["@type"] === type) as Record<string, unknown>;

  it("describes the company, the site and the app, with no ratings we don't have", () => {
    expect(node("Organization")).toMatchObject({
      name: "Threaded",
      url: "https://getthreaded.app/",
      logo: "https://getthreaded.app/apple-icon",
    });
    expect(node("WebApplication")).toMatchObject({
      applicationCategory: "BusinessApplication",
      offers: { price: "0", priceCurrency: "USD" },
    });
    expect(JSON.stringify(data)).not.toContain("aggregateRating");
  });

  it("carries exactly the questions the page shows", () => {
    const faq = node("FAQPage") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(FAQS.map((f) => f.question));
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe(FAQS[0].answer);
  });

  it("quotes prices from the pricing module", () => {
    const cost = FAQS.find((f) => f.question === "How much does it cost?")?.answer ?? "";
    expect(cost).toContain("$1 of free credits");
    expect(cost).toContain("$5, $20 or $50 packs");
    expect(cost).toContain(`$${BYOK_PLATFORM_FEE_USD} monthly platform fee`);
  });
});
