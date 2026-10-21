import { createHmac } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// A real account end to end: Threads sign-in against e2e/mock-meta.mjs,
// payments against e2e/mock-billing.mjs, and a real Postgres. Needs
// TEST_DATABASE_URL (see playwright.config.ts); skipped otherwise.

const databaseUrl = process.env.TEST_DATABASE_URL;
test.skip(!databaseUrl, "TEST_DATABASE_URL not set");
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool });
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: "drizzle" });
  await pool.end();
});

function signedRequest(payload: object, secret = "test-app-secret") {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${createHmac("sha256", secret).update(body).digest("base64url")}.${body}`;
}

test("signs in with Threads, syncs history, and signs out", async ({ page }) => {
  await page.goto("/api/auth/threads/start?tz=America/Toronto");
  await expect(page).toHaveURL("/home");
  // New accounts start with the free trial.
  await expect(page.getByRole("link", { name: /credits/ })).toContainText("100");
  await expect(page.getByText("Demo account")).toHaveCount(0);

  // The first sync runs as a durable workflow; Home switches from progress to
  // real metrics on its own when it finishes.
  await expect(page.getByRole("main").getByLabel("Key metrics")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mock");
  await expect(page.getByRole("main").getByLabel("Key metrics").getByText("Engagement rate")).toBeVisible();
  await expect(page.getByText("What's working for engagement")).toBeVisible();
  // Accounts don't get the demo's sample plays.
  await expect(page.getByText("No ideas yet.")).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByText("@mock.user")).toBeVisible();
  await expect(page.getByText(/Last synced .* ago/)).toBeVisible();
  // A second sync right away is throttled.
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Synced a few minutes ago")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/home");
  await expect(page).toHaveURL("/");
});

test("generates ideas in Studio, charges credits, and surfaces saved ideas on Home", async ({ page }) => {
  // Signing back in reuses the synced account.
  await page.goto("/api/auth/threads/start?tz=America/Toronto");
  await expect(page).toHaveURL("/home");
  await expect(page.getByRole("main").getByLabel("Key metrics")).toBeVisible();
  await expect(page.getByRole("link", { name: /credits/ })).toContainText("100");

  await page.goto("/studio");
  await expect(page.getByRole("button", { name: /Generate/ })).toContainText("cr");
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(3, { timeout: 20_000 });

  // The mock call costs 2 credits (actual cost × markup), charged after it finishes.
  await expect(page.getByRole("link", { name: /credits/ })).toContainText("98");

  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /Saved ideas/ })).toBeVisible();

  await page.goto("/home");
  await expect(page.getByText("No ideas yet.")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Today's plays" }).getByRole("button", { name: "Copy" }),
  ).not.toHaveCount(0);
});

async function signIn(page: Page) {
  await page.goto("/api/auth/threads/start?tz=America/Toronto");
  await expect(page).toHaveURL("/home");
}

const balance = (page: Page, credits: number) => page.getByRole("link", { name: new RegExp(`^${credits} credits`) });

test("auto-recharge saves a card, then tops up as soon as the balance is low", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/billing");
  await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
  // 98 credits left after the Studio test, under the default 100 threshold.
  await page.getByRole("switch", { name: "Auto-recharge" }).check({ force: true });
  await page.getByRole("button", { name: "Continue to add a card" }).click();

  await expect(page).toHaveURL(/localhost:3998\/pay\//);
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/billing\?checkout=card&status=fulfilled/);
  await expect(page.getByText("Card saved. Auto-recharge is on.")).toBeVisible();
  await expect(page.getByText("Charges Visa •••• 4242")).toBeVisible();

  // The recharge runs as a workflow: 2,000 credits for $20 on the saved card.
  await expect(async () => {
    await page.reload();
    await expect(balance(page, 2098)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByLabel("Credit activity")).toContainText("Auto-recharge");
});

test("buys a credit pack through Stripe Checkout", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/billing");

  // Backing out of Checkout changes nothing.
  await page.getByRole("button", { name: "Buy 500 credits for $5" }).click();
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page.getByText("Checkout canceled. You weren't charged.")).toBeVisible();
  await expect(balance(page, 2098)).toBeVisible();

  await page.getByRole("button", { name: "Buy 500 credits for $5" }).click();
  await expect(page).toHaveURL(/localhost:3998\/pay\//);
  await page.getByRole("button", { name: "Pay $5.00" }).click();
  await expect(page.getByText("Payment received. Your credits are ready to use.")).toBeVisible();
  await expect(balance(page, 2598)).toBeVisible();
  await expect(page.getByLabel("Credit activity")).toContainText("Bought credits");
});

test("switches to the user's own AI key and back", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/billing");
  const key = page.getByLabel("Vercel AI Gateway key");

  await key.fill("vck_bad_key_0000000000");
  await page.getByRole("button", { name: /Check key and continue/ }).click();
  await expect(page.getByText("The AI Gateway didn't accept that key.")).toBeVisible();

  await key.fill("vck_e2e_good_key_wxyz");
  await page.getByRole("button", { name: /Check key and continue/ }).click();
  await expect(page).toHaveURL(/localhost:3998\/pay\//);
  await page.getByRole("button", { name: "Subscribe $5.00" }).click();
  await expect(page.getByText("Your plan is active and Threaded now runs on your own key.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Your key" })).toBeVisible();
  await expect(page.getByText("•••• wxyz")).toBeVisible();
  await expect(page.getByText("$12.50")).toBeVisible();

  // Studio runs on the key and charges no credits.
  await page.goto("/studio");
  await expect(page.getByRole("button", { name: /Generate/ })).toContainText("Your key");
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByLabel("Ideas", { exact: true }).getByRole("button", { name: "Copy" })).toHaveCount(3, {
    timeout: 20_000,
  });

  await page.goto("/settings/billing");
  await page.getByRole("button", { name: "Switch back to credits" }).click();
  await expect(balance(page, 2598)).toBeVisible();
  await expect(page.getByText(/Your plan ends on/)).toBeVisible();
});

test("shows a billing problem across the app until it's dismissed", async ({ page }) => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`update workspaces set billing_notice = $1 where name = '@mock.user'`, [
      { kind: "auto_recharge_failed", message: "Auto-recharge couldn't charge your card.", at: new Date() },
    ]);
  } finally {
    await pool.end();
  }
  await signIn(page);
  await expect(page.getByText("Auto-recharge couldn't charge your card.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Auto-recharge couldn't charge your card.")).toHaveCount(0);
});

test("the daily cron refreshes connected profiles", async ({ request }) => {
  expect((await request.get("/api/cron/daily")).status()).toBe(401);
  expect((await request.get("/api/cron/daily", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);

  const response = await request.get("/api/cron/daily", { headers: { authorization: "Bearer test-cron-secret" } });
  expect(await response.json()).toMatchObject({ profiles: 1, started: 1, expired: { workspaces: 0, credits: 0 } });

  // The refresh runs as its own workflow; wait for it to land.
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await expect
      .poll(
        async () =>
          (await pool.query("select status from sync_runs where kind = 'daily' order by started_at desc limit 1"))
            .rows[0]?.status,
        { timeout: 30_000 },
      )
      .toBe("succeeded");
  } finally {
    await pool.end();
  }
});

test("rejects a callback with a forged state", async ({ page }) => {
  await page.goto("/api/auth/threads/callback?code=mock-code&state=forged-state-value");
  await expect(page).toHaveURL(/\/connect\?error=state/);
  await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
});

test("handles Meta's data-deletion callback", async ({ page, request }) => {
  const forged = await request.post("/api/threads/delete", {
    form: { signed_request: signedRequest({ algorithm: "HMAC-SHA256", user_id: "9001" }, "wrong-secret") },
  });
  expect(forged.status()).toBe(400);

  const response = await request.post("/api/threads/delete", {
    form: { signed_request: signedRequest({ algorithm: "HMAC-SHA256", user_id: "9001", issued_at: 1 }) },
  });
  expect(response.ok()).toBe(true);
  const { url, confirmation_code } = await response.json();
  expect(confirmation_code).toBeTruthy();

  await page.goto(new URL(url).pathname + new URL(url).search);
  await expect(page.getByText("Your data has been deleted.")).toBeVisible();
  await expect(page.getByText(confirmation_code)).toBeVisible();
});
