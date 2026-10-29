import { expect, type Page, test } from "@playwright/test";

// On phones the app's pages scroll inside the shell, between the top bar and
// the tabs, and Safari doesn't report elements scrolling into view there. This
// stands in for that: an IntersectionObserver that never reports anything.
// Nothing in the app may wait for it to show content.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo account" }).first().click();
  await expect(page).toHaveURL("/home");
});

/** Elements in the page that are still invisible (an entrance animation that never played). */
const invisible = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("main *")].filter(
        (el) => getComputedStyle(el).opacity === "0" && el.getBoundingClientRect().height > 20,
      ).length,
  );

/** Whether the page, or the area it scrolls in, is wider than the screen. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    return main.scrollWidth > main.clientWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1;
  });

test("every app page shows its content without waiting on scrolling, and doesn't scroll sideways", async ({ page }) => {
  for (const path of ["/home", "/studio", "/queue", "/insights", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect.poll(() => invisible(page), { message: `${path}: content left invisible` }).toBe(0);
    expect(await scrollsSideways(page), `${path} scrolls sideways`).toBe(false);
  }
});

test("on phones the document stays put: the page scrolls between the top bar and the tabs", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phones only");
  const main = page.getByRole("main");
  await main.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => main.evaluate((m) => m.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const tabs = await page.getByRole("navigation", { name: "Main" }).last().boundingBox();
  expect(tabs && Math.round(tabs.y + tabs.height)).toBe(page.viewportSize()?.height);

  // A new page opens at its top, not where the last one was scrolled to.
  await page.getByRole("navigation", { name: "Main" }).last().getByRole("link", { name: "Studio" }).click();
  await expect(page).toHaveURL("/studio");
  await expect.poll(() => main.evaluate((m) => m.scrollTop)).toBe(0);
});
