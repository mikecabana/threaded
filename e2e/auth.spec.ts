import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Full Threads sign-in against e2e/mock-meta.mjs and a real Postgres.
// Needs TEST_DATABASE_URL (see playwright.config.ts); skipped otherwise.

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
  await expect(page.getByLabel("Key metrics")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mock");
  await expect(page.getByLabel("Key metrics").getByText("Engagement rate")).toBeVisible();
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
  await expect(page.getByLabel("Key metrics")).toBeVisible();
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

test("the daily cron refreshes connected profiles", async ({ request }) => {
  expect((await request.get("/api/cron/daily")).status()).toBe(401);
  expect((await request.get("/api/cron/daily", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);

  const response = await request.get("/api/cron/daily", { headers: { authorization: "Bearer test-cron-secret" } });
  expect(await response.json()).toMatchObject({ profiles: 1, started: 1 });

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
