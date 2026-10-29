import { expect, test } from "@playwright/test";

// iOS Safari 26 draws the page behind the status bar and fills that strip with
// the colour of the bar pinned at the top, but only when the bar is one solid
// colour: a see-through background or a backdrop blur lets the page show
// through above it. So the marketing header stays opaque and unblurred.
test("the site header is one solid colour, so Safari can fill the status bar with it", async ({ page }) => {
  await page.goto("/");
  const header = await page.getByRole("banner").evaluate((el) => {
    const style = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return { alpha: ctx.getImageData(0, 0, 1, 1).data[3], backdrop: style.backdropFilter, position: style.position };
  });
  expect(header).toEqual({ alpha: 255, backdrop: "none", position: "sticky" });
});
