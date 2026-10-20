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

test("signs in with Threads, lands on Home, and signs out", async ({ page }) => {
  await page.goto("/api/auth/threads/start?tz=America/Toronto");

  await expect(page).toHaveURL("/home");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Mock");
  // New accounts start with the free trial.
  await expect(page.getByRole("link", { name: /credits/ })).toContainText("100");
  await expect(page.getByText("Demo account")).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByText("@mock.user")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/home");
  await expect(page).toHaveURL("/");
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
