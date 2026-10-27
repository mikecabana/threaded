import { expect, type Page, test } from "@playwright/test";

// What search engines and link previews see: titles, canonical URLs, share
// images, structured data, robots.txt and the sitemap.

const meta = (page: Page, selector: string) => page.locator(selector).first().getAttribute("content");

test("the home page has a search title, a canonical URL, a share image and structured data", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Threaded: grow on Threads with AI post ideas in your voice");
  expect(await meta(page, 'meta[name="description"]')).toContain("post ideas in your voice");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/^https?:\/\/[^/]+\/?$/);
  expect(await meta(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");

  // The share image is a real 1200×630 PNG.
  const image = new URL((await meta(page, 'meta[property="og:image"]')) ?? "");
  expect(await meta(page, 'meta[property="og:image:width"]')).toBe("1200");
  const response = await request.get(image.pathname + image.search);
  expect(response.headers()["content-type"]).toBe("image/png");
  const png = await response.body();
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);

  // Structured data parses, and its questions are the ones on the page.
  const json = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
  const faq = json["@graph"].find((node: { "@type": string }) => node["@type"] === "FAQPage");
  expect(faq.mainEntity.length).toBeGreaterThan(5);
  const faqSection = page.locator("#faq");
  for (const question of faq.mainEntity) await expect(faqSection).toContainText(question.name);
  await faqSection.getByText("How much does it cost?").click();
  await expect(faqSection.getByText(/credits never expire/)).toBeVisible();

  // One h1, and the sections people search for have headings.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Everything you need to grow on Threads" })).toBeVisible();
});

test("other public pages have their own canonical URL and share image", async ({ page }) => {
  for (const [path, title] of [
    ["/connect", "Connect Threads · Threaded"],
    ["/legal/privacy", "Privacy Policy · Threaded"],
    ["/legal/terms", "Terms of Service · Threaded"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    expect(new URL((await page.locator('link[rel="canonical"]').getAttribute("href")) ?? "").pathname).toBe(path);
    expect(await meta(page, 'meta[property="og:image"]')).toContain(`${path}/opengraph-image`);
    expect(await meta(page, 'meta[property="og:image:alt"]')).toBe(title);
  }
});

test("robots.txt and the sitemap point crawlers at the public pages only", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /home");
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/connect", "/legal/terms", "/legal/privacy"]) expect(sitemap).toContain(`${path}</loc>`);
  expect(sitemap).not.toContain("/home");

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Threaded", display: "standalone" });
  expect((await request.get("/apple-icon")).headers()["content-type"]).toBe("image/png");
});

test("signed-in pages ask search engines not to index them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo account" }).first().click();
  await expect(page).toHaveURL(/\/home$/);
  expect(await meta(page, 'meta[name="robots"]')).toBe("noindex, nofollow");
});
