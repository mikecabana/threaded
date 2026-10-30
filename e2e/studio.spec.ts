import { expect, test } from "@playwright/test";
import { holdNextBatch, shown } from "./helpers";

test("demo Studio streams sample ideas for free", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo account" }).first().click();
  await expect(page).toHaveURL("/home");
  await page.goto("/studio");

  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();
  await expect(shown(page.getByText("Writing for"))).toBeVisible();
  await holdNextBatch(page);
  await page.getByRole("button", { name: /Generate/ }).click();

  // Each step shows while the batch is written…
  const progress = page.getByRole("list", { name: "Progress" });
  await expect(progress).toHaveText("Reading your best posts…");
  // …then the ideas take its place, all at once rather than streaming in: by the time
  // anything shows, every card is finished (only finished cards have Copy).
  const ideas = page.getByRole("region", { name: "Ideas", exact: true });
  await expect(ideas.getByRole("article").first()).toBeVisible({ timeout: 15_000 });
  expect(await ideas.getByRole("button", { name: "Copy" }).count()).toBe(3);
  await expect(progress).toHaveCount(0);
  await expect(ideas.getByRole("article").first()).toContainText("What's one thing you stopped doing this year");

  // Saving works locally in the demo; dismissing removes the card.
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveCount(1);
  await page.getByRole("button", { name: "Dismiss idea" }).last().click();
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(2);
});
