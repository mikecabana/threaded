import { expect, test } from "@playwright/test";

// The marketing header scrolls away with the page. Pinned to the top with a
// backdrop blur, it let the page show through behind the status bar above it
// on iOS Safari 26, which colours that strip from a bar pinned at the top.
test("the site header scrolls away with the page", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  const style = await header.evaluate((el) => {
    const own = getComputedStyle(el);
    return { position: own.position, blur: own.backdropFilter };
  });
  expect(style.position).not.toMatch(/^(sticky|fixed)$/);
  expect(style.blur).toBe("none");

  await page.evaluate(() => window.scrollTo(0, 800));
  await expect.poll(() => header.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(0);
});
