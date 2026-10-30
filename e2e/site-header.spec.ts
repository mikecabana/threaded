import { expect, test } from "@playwright/test";

// iOS Safari 26 draws the page behind the status bar and fills that strip with
// one colour read from the bar pinned at the top. A see-through background is
// blended over the page colour, but a backdrop blur on the bar itself makes
// Safari give up, and the page shows through above the header. So the header's
// own background stays one colour and its blur sits on a layer Safari's check
// passes over (pointer-events: none).
test("the site header keeps its blur off the bar Safari reads the status bar colour from", async ({ page }) => {
  await page.goto("/");
  const header = await page.getByRole("banner").evaluate((el) => {
    const own = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    /** The pixel the colours make, painted one over the other. */
    const paint = (...colours: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      for (const colour of colours) {
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1, 1);
      }
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const pageColour = getComputedStyle(document.documentElement).backgroundColor;
    const glass = [...el.children].find((child) => getComputedStyle(child).backdropFilter !== "none");
    return {
      position: own.position,
      blur: own.backdropFilter,
      // What Safari fills the strip with, against the page colour.
      tint: paint(pageColour, own.backgroundColor),
      page: paint(pageColour),
      glass: glass
        ? { blur: getComputedStyle(glass).backdropFilter, pointerEvents: getComputedStyle(glass).pointerEvents }
        : null,
    };
  });
  expect(header.position).toBe("sticky");
  expect(header.blur).toBe("none");
  // Blended over the page colour, the header's tint is the page colour: the strip matches the page.
  expect(Math.max(...header.tint.map((value, i) => Math.abs(value - header.page[i])))).toBeLessThanOrEqual(1);
  // The glass look is still there, on a layer Safari's check doesn't hit.
  expect(header.glass).toEqual({ blur: expect.stringContaining("blur("), pointerEvents: "none" });
});
