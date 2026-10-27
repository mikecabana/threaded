import { expect, type Page, test } from "@playwright/test";

// The cookie banner and Google Tag Manager (lib/consent, components/consent).
// The app's answer about the container and the visitor's location is stubbed,
// and so is Google's script, so no request leaves for Google.

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

const signals = (analytics: boolean, advertising: boolean) => ({
  analytics_storage: analytics ? "granted" : "denied",
  ad_storage: advertising ? "granted" : "denied",
  ad_user_data: advertising ? "granted" : "denied",
  ad_personalization: advertising ? "granted" : "denied",
});

const GTM = "https://www.googletagmanager.com/gtm.js?id=GTM-TEST1";

test("where the law asks first, Tag Manager loads with consent denied until the visitor says yes", async ({ page }) => {
  const loads = await stub(page, { gtmId: "GTM-TEST1", required: true });
  await page.goto("/");
  // Tag Manager starts on arrival, with everything denied by default.
  await expect.poll(() => loads).toEqual([GTM]);
  expect(await consentCommands(page)).toEqual([["consent", "default", signals(false, false)]]);
  const banner = page.getByRole("region", { name: "Cookie choices" });
  await expect(banner).toContainText("They stay off unless you turn them on.");
  // The banner names no tools.
  await expect(banner).not.toContainText(/Google|Tag Manager|Analytics 4|Sentry|Vercel/);

  await banner.getByRole("button", { name: "Decline" }).click();
  await expect(banner).toBeHidden();
  expect((await consentCommands(page)).at(-1)).toEqual(["consent", "update", signals(false, false)]);

  // Next visit: the saved choice is the default, and nobody asks again.
  await page.reload();
  await expect.poll(() => loads).toHaveLength(2);
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(banner).toBeHidden();
  expect(await consentCommands(page)).toEqual([["consent", "default", signals(false, false)]]);

  // Changing your mind from the footer updates consent and the saved default.
  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  await banner.getByLabel(/Analytics/).check();
  await banner.getByRole("button", { name: "Save choices" }).click();
  expect((await consentCommands(page)).at(-1)).toEqual(["consent", "update", signals(true, false)]);
  await page.reload();
  await expect.poll(() => consentCommands(page)).toEqual([["consent", "default", signals(true, false)]]);
});

test("elsewhere consent is granted by default, nobody is asked, and turning cookies off updates it", async ({
  page,
}) => {
  const loads = await stub(page, { gtmId: "GTM-TEST1", required: false });
  await page.goto("/");
  await expect.poll(() => loads).toEqual([GTM]);
  expect(await consentCommands(page)).toEqual([["consent", "default", signals(true, true)]]);
  await expect(page.getByRole("region", { name: "Cookie choices" })).toBeHidden();

  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  const banner = page.getByRole("region", { name: "Cookie choices" });
  await expect(banner).toContainText("They're on now, and you can turn them off here.");
  await banner.getByLabel(/Analytics/).uncheck();
  await banner.getByLabel(/Advertising/).uncheck();
  await banner.getByRole("button", { name: "Save choices" }).click();
  expect((await consentCommands(page)).at(-1)).toEqual(["consent", "update", signals(false, false)]);

  await page.reload();
  await expect.poll(() => consentCommands(page)).toEqual([["consent", "default", signals(false, false)]]);
});

test("without a container there's no Tag Manager or banner, and Cookie settings explains why", async ({ page }) => {
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
