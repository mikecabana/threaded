import { expect, test } from "@playwright/test";

test("demo Studio streams sample ideas for free", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo account" }).first().click();
  await expect(page).toHaveURL("/home");
  await page.goto("/studio");

  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();
  await expect(page.getByText("Writing for")).toBeVisible();
  await page.getByRole("button", { name: /Generate/ }).click();

  const ideas = page
    .getByLabel("Ideas")
    .getByRole("article")
    .filter({ has: page.getByText("maya.builds") });
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(3, { timeout: 15_000 });
  await expect(ideas.first()).toContainText("What's one thing you stopped doing this year");

  // Saving works locally in the demo; dismissing removes the card.
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Saved" })).toHaveCount(1);
  await page.getByRole("button", { name: "Dismiss idea" }).last().click();
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(2);
});
