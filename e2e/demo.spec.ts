import { expect, test } from "@playwright/test";
import { shown } from "./helpers";

test.describe("demo flow", () => {
  test("app routes need a session", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Grow on Threads");
  });

  test("landing → demo account → Home", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a demo account" }).first().click();

    await expect(page).toHaveURL("/home");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Maya");
    await expect(shown(page.getByText("Demo account", { exact: true }))).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Key metrics").locator("> div")).toHaveCount(4);
    await expect(page.getByRole("heading", { name: "Today's plays" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(3);
  });

  test("switching goal re-themes the app and reorders KPIs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a demo account" }).first().click();
    await expect(page).toHaveURL("/home");
    await expect(page.locator("html")).toHaveAttribute("data-goal", "engagement");

    await page.getByRole("radio", { name: "Views" }).check({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-goal", "views");
    await expect(page.getByRole("main").getByLabel("Key metrics").getByText("Views (7d)").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("more views");

    // Cards that changed with the goal must animate in, not stay at their hidden start state.
    // (toBeVisible() counts opacity: 0 as visible, so check the computed opacity.)
    const tiles = page.getByRole("main").getByLabel("Key metrics").locator("> div");
    const plays = page.getByRole("region", { name: "Today's plays" }).locator("> div").nth(1).locator("> div");
    for (let i = 0; i < 4; i++) await expect(tiles.nth(i)).toHaveCSS("opacity", "1");
    for (let i = 0; i < 3; i++) await expect(plays.nth(i)).toHaveCSS("opacity", "1");

    // Persists across reloads via the goal cookie.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-goal", "views");
  });

  test("switching persona and exiting the demo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a demo account" }).first().click();
    await expect(page).toHaveURL("/home");

    await page.getByRole("button", { name: "Running coach" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Priya");

    await page
      .getByRole("button", { name: /Exit demo/ })
      .first()
      .click();
    await expect(page).toHaveURL("/");
  });

  test("every section renders inside the shell", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a demo account" }).first().click();
    await expect(page).toHaveURL("/home");
    for (const [path, title] of [
      ["/studio", "Studio"],
      ["/queue", "Queue"],
      ["/insights", "Insights"],
      ["/settings", "Settings"],
      ["/settings/billing", "Billing"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    }
  });
  test("Insights explains the numbers, and the demo has a Profile DNA", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a demo account" }).first().click();
    await expect(page).toHaveURL("/home");
    await page.goto("/insights");
    for (const name of ["Views", "Followers", "Best hours", "Formats × topics", "Your posts"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    await expect(shown(page.getByText(/views in the last 30 days/))).toBeVisible();
    await expect(page.getByRole("slider", { name: "Views by day" })).toBeVisible();

    // The post table sorts by any number.
    const viewsHeader = page.getByRole("table", { name: /^Your posts/ }).getByRole("columnheader", { name: "Views" });
    await expect(viewsHeader).toHaveAttribute("aria-sort", "none");
    await viewsHeader.getByRole("button").click();
    await expect(viewsHeader).toHaveAttribute("aria-sort", "descending");

    await page.getByRole("link", { name: "See your DNA" }).click();
    await expect(page).toHaveURL("/onboarding/dna");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("real numbers");
    await expect(page.getByRole("heading", { name: "What your audience rewards" })).toBeVisible();
    // The demo has no sync to watch.
    await page.goto("/onboarding/analyzing");
    await expect(page).toHaveURL("/home");
  });
});
