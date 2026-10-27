import { expect, type Page, test } from "@playwright/test";

// The cookie banner and Google Tag Manager (components/consent). The app's
// answer about the container and the visitor's location is stubbed, and so is
// Google's script, so no request leaves for Google.

async function stub(page: Page, config: { gtmId: string | null; required: boolean }) {
  const loads: string[] = [];
  await page.route("**/api/consent", (route) => route.fulfill({ json: config }));
  await page.route("https://www.googletagmanager.com/**", (route) => {
    loads.push(route.request().url());
    return route.fulfill({ contentType: "text/javascript", body: "window.__gtm = true;" });
  });
  return loads;
}

/** Consent Mode commands pushed so far, e.g. ["consent", "default", {...}]. */
const consentCommands = (page: Page) =>
  page.evaluate(() =>
    (window.dataLayer ?? [])
      .map((entry) => Array.from(entry as ArrayLike<unknown>))
      .filter((args) => args[0] === "consent"),
  );

test("asks first where the law says to, and loads Tag Manager only after a yes", async ({ page }) => {
  const loads = await stub(page, { gtmId: "GTM-TEST1", required: true });
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Cookie choices" });
  await expect(banner).toContainText("Those cookies stay off unless you turn them on.");

  await banner.getByRole("button", { name: "Decline" }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(banner).toBeHidden();
  expect(loads).toEqual([]);

  // Changing your mind from the footer.
  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  await banner.getByLabel(/Analytics/).check();
  await banner.getByRole("button", { name: "Save choices" }).click();
  await expect.poll(() => loads).toEqual(["https://www.googletagmanager.com/gtm.js?id=GTM-TEST1"]);
  expect(await consentCommands(page)).toEqual([
    [
      "consent",
      "default",
      { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" },
    ],
  ]);
});

test("doesn't ask elsewhere, and turning cookies off updates consent", async ({ page }) => {
  const loads = await stub(page, { gtmId: "GTM-TEST1", required: false });
  await page.goto("/");
  await expect.poll(() => loads).toHaveLength(1);
  await expect(page.getByRole("region", { name: "Cookie choices" })).toBeHidden();

  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  const banner = page.getByRole("region", { name: "Cookie choices" });
  await expect(banner).toContainText("They're on now, and you can turn them off here.");
  await banner.getByLabel(/Analytics/).uncheck();
  await banner.getByLabel(/Advertising/).uncheck();
  await banner.getByRole("button", { name: "Save choices" }).click();
  const commands = await consentCommands(page);
  expect(commands.at(-1)).toEqual([
    "consent",
    "update",
    { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" },
  ]);
});

test("without a container there's no banner, and Cookie settings explains why", async ({ page }) => {
  const loads = await stub(page, { gtmId: null, required: true });
  await page.goto("/");
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByRole("region", { name: "Cookie choices" })).toBeHidden();
  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  await expect(page).toHaveURL(/\/legal\/privacy#cookies$/);
  await expect(page.getByRole("heading", { name: "Cookies" })).toBeVisible();
  expect(loads).toEqual([]);
});

test("the app works out who to ask from the visitor's location", async ({ request }) => {
  const ask = async (headers: Record<string, string>) =>
    (await (await request.get("/api/consent", { headers })).json()) as { required: boolean };
  expect(await ask({ "cf-ipcountry": "CA", "cf-region-code": "QC" })).toMatchObject({ required: true });
  expect(await ask({ "cf-ipcountry": "CA", "cf-region-code": "ON" })).toMatchObject({ required: false });
  expect(await ask({ "x-vercel-ip-country": "DE" })).toMatchObject({ required: true });
  expect(await ask({ "x-vercel-ip-country": "US" })).toMatchObject({ required: false });
  expect(await ask({})).toMatchObject({ required: true });
});
