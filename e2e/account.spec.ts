import { createHash, createHmac } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { shown } from "./helpers";

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

test("signs in with Threads, plays The Read and the DNA reveal, and signs out", async ({ page }) => {
  await page.goto("/api/auth/threads/start?tz=America/Toronto");
  // The first sync plays out on The Read, step by step, driven by the real
  // (local) workflow run and the mock models.
  await expect(page).toHaveURL("/onboarding/analyzing");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mock");
  await expect(shown(page.getByText("Reading your posts"))).toBeVisible();
  await expect(shown(page.getByText("Finding your voice"))).toBeVisible();

  // When it's done, the Profile DNA is revealed, with our own numbers.
  await expect(page).toHaveURL("/onboarding/dna", { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're at your best keeping it short and direct.");
  await expect(page.getByRole("heading", { name: "What your audience rewards" })).toBeVisible();
  await expect(shown(page.getByText(/^\d+(\.\d)?×$/)).first()).toBeVisible();
  await page.getByRole("link", { name: "Go to your dashboard" }).click();

  await expect(page).toHaveURL("/home");
  // New accounts start with the free trial.
  await expect(page.getByRole("link", { name: /credits/ })).toContainText("100");
  await expect(shown(page.getByText("Demo account"))).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mock");
  await expect(page.getByRole("main").getByLabel("Key metrics").getByText("Engagement rate")).toBeVisible();
  await expect(shown(page.getByText("What's working for engagement"))).toBeVisible();
  // Accounts don't get the demo's sample plays.
  await expect(shown(page.getByText("No ideas yet."))).toBeVisible();

  // Studio writes in the author's voice; Insights has the charts and links back to the DNA.
  await page.goto("/studio");
  await expect(shown(page.getByText(/In your voice, learned from \d+ of your posts/))).toBeVisible();
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Formats × topics" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See your DNA" })).toBeVisible();
  // Returning to The Read after it's finished just offers the way on.
  await page.goto("/onboarding/analyzing");
  await expect(page.getByRole("link", { name: "Continue" })).toBeVisible();

  await page.goto("/settings");
  await expect(shown(page.getByText("@mock.user"))).toBeVisible();
  await expect(shown(page.getByText(/Last synced .* ago/))).toBeVisible();
  // A second sync right away is throttled.
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(shown(page.getByText("Synced a few minutes ago"))).toBeVisible();
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
  await expect(shown(page.getByText("No ideas yet."))).toHaveCount(0);
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
  await expect(shown(page.getByText("Card saved. Auto-recharge is on."))).toBeVisible();
  await expect(shown(page.getByText("Charges Visa •••• 4242"))).toBeVisible();

  // The recharge runs as a workflow: 2,000 credits for $20 on the saved card.
  await expect(async () => {
    await page.reload();
    await expect(balance(page, 2098)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(shown(page.getByLabel("Credit activity"))).toContainText("Auto-recharge");
});

test("buys a credit pack through Stripe Checkout", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/billing");

  // Backing out of Checkout changes nothing.
  await page.getByRole("button", { name: "Buy 500 credits for $5" }).click();
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(shown(page.getByText("Checkout canceled. You weren't charged."))).toBeVisible();
  await expect(balance(page, 2098)).toBeVisible();

  await page.getByRole("button", { name: "Buy 500 credits for $5" }).click();
  await expect(page).toHaveURL(/localhost:3998\/pay\//);
  await page.getByRole("button", { name: "Pay $5.00" }).click();
  await expect(shown(page.getByText("Payment received. Your credits are ready to use."))).toBeVisible();
  await expect(balance(page, 2598)).toBeVisible();
  await expect(shown(page.getByLabel("Credit activity"))).toContainText("Bought credits");
});

test("switches to the user's own AI key and back", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/billing");
  const key = shown(page.getByLabel("Vercel AI Gateway key"));

  await key.fill("vck_bad_key_0000000000");
  await page.getByRole("button", { name: /Check key and continue/ }).click();
  await expect(shown(page.getByText("The AI Gateway didn't accept that key."))).toBeVisible();

  await key.fill("vck_e2e_good_key_wxyz");
  await page.getByRole("button", { name: /Check key and continue/ }).click();
  await expect(page).toHaveURL(/localhost:3998\/pay\//);
  await page.getByRole("button", { name: "Subscribe $5.00" }).click();
  await expect(shown(page.getByText("Your plan is active and Threaded now runs on your own key."))).toBeVisible();
  await expect(page.getByRole("link", { name: "Your key" })).toBeVisible();
  await expect(shown(page.getByText("•••• wxyz"))).toBeVisible();
  await expect(shown(page.getByText("$12.50"))).toBeVisible();

  // Studio runs on the key and charges no credits.
  await page.goto("/studio");
  await expect(page.getByRole("button", { name: /Generate/ })).toContainText("Your key");
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(shown(page.getByLabel("Ideas", { exact: true })).getByRole("button", { name: "Copy" })).toHaveCount(3, {
    timeout: 20_000,
  });

  await page.goto("/settings/billing");
  await page.getByRole("button", { name: "Switch back to credits" }).click();
  await expect(balance(page, 2598)).toBeVisible();
  await expect(shown(page.getByText(/Your plan ends on/))).toBeVisible();
});

test("looks up a topic on Threads and the web before writing, and shows what it found", async ({ page }) => {
  await signIn(page);
  await page.goto("/studio");
  const generate = page.getByRole("button", { name: /Generate/ });
  await expect(page.getByText("Threaded reads what's popular on Threads about it first")).toContainText("(≈2 cr).");
  const estimate = async () => Number((await generate.textContent())?.match(/≈(\d+) cr/)?.[1]);
  const before = await estimate();
  await page.getByLabel("Topic").fill("php2shell");
  // The estimate now includes a search.
  await expect(generate).toContainText(`≈${before + 2} cr`);
  await generate.click();
  // Scoped to the new batch: the idea saved earlier is listed under Saved ideas too.
  const ideas = page.getByRole("region", { name: "Ideas", exact: true });
  await expect(ideas.getByRole("button", { name: "Copy" })).toHaveCount(3, { timeout: 20_000 });

  // What recent popular posts on Threads are saying, with links to the two by other people.
  const threads = ideas.getByRole("region", { name: "On Threads" });
  await expect(threads).toContainText("2 posts (mock summary)");
  await expect(threads).toContainText("From 2 recent popular posts:");
  await expect(threads.getByRole("link", { name: /^@sec\.daily/ })).toHaveAttribute(
    "href",
    "https://www.threads.net/@sec.daily/post/KW1",
  );
  await expect(threads.getByRole("link", { name: /^@ops\.notes/ })).toBeVisible();
  await expect(threads).not.toContainText("@mock.user");
  await expect(threads).not.toContainText("@random.dev");

  const found = ideas.getByRole("region", { name: "From the web" });
  await expect(found).toContainText("From a web search for “php2shell news”");
  await expect(found).toContainText("security flaw disclosed on 2026-10-20");
  await expect(found.getByRole("link")).toHaveCount(2);
  await expect(found.getByRole("link", { name: "php2shell: what happened this week" })).toHaveAttribute(
    "href",
    "https://news.example.com/php2shell",
  );
  // 2 credits for the ideas and 2 for the research.
  await expect(balance(page, 2594)).toBeVisible();
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
  await expect(shown(page.getByText("Auto-recharge couldn't charge your card."))).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(shown(page.getByText("Auto-recharge couldn't charge your card."))).toHaveCount(0);
});

/** A date-time input value for `days` from now in Toronto (the test account's timezone). */
function torontoInput(days: number, time: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + days * 86_400_000));
  return `${date}T${time}`;
}

test("schedules a saved idea, edits it, and takes it back out of the queue", async ({ page }) => {
  await signIn(page);
  await page.goto("/queue");
  await expect(page.getByRole("heading", { level: 1, name: "Queue" })).toBeVisible();
  await expect(shown(page.getByText("Nothing scheduled"))).toBeVisible();

  // The idea saved in the Studio test is ready to schedule.
  const saved = page.getByRole("region", { name: "Saved ideas" });
  await saved.getByRole("button", { name: "Schedule" }).first().click();
  const composer = page.getByRole("dialog", { name: "New post" });
  await expect(composer).toBeVisible();
  await composer.getByText("Pick a time").click();
  await composer.getByLabel("Date and time").fill(torontoInput(1, "09:30"));
  await composer.getByRole("button", { name: "Schedule for Tomorrow 9:30 AM" }).click();
  await expect(composer.getByText("Scheduled for Tomorrow 9:30 AM")).toBeVisible();
  await composer.getByRole("button", { name: "Done" }).click();
  await expect(composer).toHaveCount(0);

  const scheduled = page.getByRole("region", { name: "Scheduled" });
  await expect(scheduled).toContainText("Tomorrow");
  await expect(scheduled).toContainText("9:30 AM");
  await expect(page.getByRole("region", { name: "Saved ideas" })).toHaveCount(0);

  // Home counts down to it.
  await page.goto("/home");
  await expect(shown(page.getByText("Up next"))).toBeVisible();
  await expect(shown(page.getByText(/Posts in \d+[dh] \d+[hm], even if you.re offline/))).toBeVisible();

  // Edit the text; the time stays.
  await page.goto("/queue");
  await scheduled.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("dialog", { name: "Edit scheduled post" });
  await editor.getByLabel("Post text").fill("Edited before it went out. What tool would you never give up?");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByText("Scheduled for Tomorrow 9:30 AM")).toBeVisible();
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(scheduled).toContainText("Edited before it went out.");

  // Cancelling asks first, then the idea goes back to the saved list.
  await scheduled.getByRole("button", { name: "Cancel" }).click();
  await scheduled.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(shown(page.getByText("Nothing scheduled"))).toBeVisible();
  await expect(page.getByRole("region", { name: "Saved ideas" })).toBeVisible();
});

test("posts now after an explicit confirmation", async ({ page }) => {
  await signIn(page);
  await page.goto("/queue");
  await page.getByRole("button", { name: "New post" }).click();
  const composer = page.getByRole("dialog", { name: "New post" });
  await composer.getByLabel("Post text").fill("Shipping the queue today. What would you schedule first?");
  await composer.getByLabel("Topic tag").fill("BuildInPublic");
  await composer
    .locator("label")
    .filter({ hasText: /^Post now$/ })
    .click();
  await composer.getByRole("button", { name: "Post now" }).click();
  // Nothing goes out until the user confirms.
  await expect(composer.getByText("Post this to Threads now?")).toBeVisible();
  await composer.getByRole("button", { name: "Yes, post it" }).click();

  await expect(composer.getByText("Posted to @mock.user")).toBeVisible({ timeout: 30_000 });
  await expect(composer.getByRole("link", { name: /View on Threads/ })).toHaveAttribute("href", /MOCK-MEDIA-1/);
  await composer.getByRole("button", { name: "Done" }).click();

  await page.reload();
  // It's on the scorecard, waiting for its first reading at one hour.
  const scorecard = page.getByRole("region", { name: "Scorecard" });
  await expect(scorecard).toContainText("Shipping the queue today.");
  await expect(scorecard).toContainText("Measured at 1 hour, in");
  await expect(scorecard.getByRole("link", { name: /View on Threads/ })).toBeVisible();
});

test("a post Threads can't take shows up as failed until it's dealt with", async ({ page }) => {
  await signIn(page);
  await page.goto("/queue");
  await page.getByRole("button", { name: "New post" }).click();
  const composer = page.getByRole("dialog", { name: "New post" });
  await composer.getByLabel("Post text").fill("This one breaks the mock #fail");
  await composer
    .locator("label")
    .filter({ hasText: /^Post now$/ })
    .click();
  await composer.getByRole("button", { name: "Post now" }).click();
  await composer.getByRole("button", { name: "Yes, post it" }).click();
  await expect(composer.getByText("That didn't go out")).toBeVisible({ timeout: 30_000 });
  await expect(composer.getByText("Threads couldn't prepare the post: The post couldn't be processed")).toBeVisible();
  await composer.getByRole("button", { name: "Done" }).click();

  await page.reload();
  await expect(shown(page.getByText("A scheduled post didn't go out."))).toBeVisible();
  const failed = page.getByRole("region", { name: "Needs attention" });
  await expect(failed).toContainText("This one breaks the mock");
  await failed.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("region", { name: "Needs attention" })).toHaveCount(0);
  await expect(shown(page.getByText("A scheduled post didn't go out."))).toHaveCount(0);
});

test("adds an alert email through the emailed link, then gets an email when a post fails", async ({
  page,
  request,
}) => {
  const address = "mock.user@example.com";
  const outbox = async () =>
    (await (await request.get(`http://localhost:3998/__control/emails?to=${address}`)).json()).data as {
      subject: string;
      text: string;
    }[];

  await signIn(page);
  await page.goto("/settings");
  const card = page.getByRole("main").locator("#email");
  await card.getByLabel("Email for alerts").fill(address);
  await card.getByRole("button", { name: "Send link" }).click();
  await expect(card.getByRole("status")).toHaveText(
    `Check ${address} for a link to confirm it. It works for 24 hours.`,
  );

  // Nothing is stored until the emailed link is opened.
  const [confirmation] = await outbox();
  expect(confirmation.subject).toBe("Confirm your email for Threaded alerts");
  const link = confirmation.text.match(/http:\/\/localhost:\d+\/api\/email\/verify\?token=\S+/)?.[0] ?? "";
  await page.goto(link);
  await expect(page).toHaveURL("/settings?email=confirmed");
  await expect(card).toContainText("Email confirmed. Alerts will go there.");
  await expect(card).toContainText(`Alerts go to ${address}`);

  // A post that fails is emailed about, once.
  await page.goto("/queue");
  await page.getByRole("button", { name: "New post" }).click();
  const composer = page.getByRole("dialog", { name: "New post" });
  await composer.getByLabel("Post text").fill("This one breaks the mock too #fail");
  await composer
    .locator("label")
    .filter({ hasText: /^Post now$/ })
    .click();
  await composer.getByRole("button", { name: "Post now" }).click();
  await composer.getByRole("button", { name: "Yes, post it" }).click();
  await expect(composer.getByText("That didn't go out")).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await outbox()).map((e) => e.subject), { timeout: 15_000 })
    .toEqual(["Confirm your email for Threaded alerts", "A scheduled post didn't go out"]);
  await composer.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await page.getByRole("region", { name: "Needs attention" }).getByRole("button", { name: "Remove" }).click();

  // Removing the address stops alerts.
  await page.goto("/settings");
  await card.getByRole("button", { name: "Remove" }).click();
  await expect(card).not.toContainText("Alerts go to");
});

test("admin is invisible to everyone but staff, and staff can adjust credits", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "This thread doesn't exist" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: /^Admin/ })).toHaveCount(0);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("update users set is_staff = true where threads_user_id = '9001'");
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Admin/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Margins" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Summary" })).toContainText("Studio revenue");
    await expect(page.getByRole("table", { name: "Studio, by model" })).toBeVisible();

    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Catalog" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Model catalog" })).toBeVisible();
    await expect(page.getByRole("form", { name: "anthropic/claude-sonnet-5.5" })).toContainText(
      "Default for Studio ideas",
    );

    await page.goto("/admin/workspaces?q=mock.user");
    await page
      .getByRole("table", { name: /^Results for/ })
      .getByRole("link")
      .first()
      .click();
    const adjust = page.getByRole("form", { name: "Adjust credits" });
    await adjust.getByLabel("Credits").fill("50");
    await adjust.getByLabel("Reason").fill("Goodwill for the e2e test");
    await adjust.getByRole("button", { name: "Apply" }).click();
    await expect(adjust.getByRole("status")).toContainText("Done. The balance is now");
    await expect(page.getByRole("table", { name: "Ledger, latest 50" })).toContainText("Goodwill for the e2e test");
  } finally {
    await pool.query("update users set is_staff = false where threads_user_id = '9001'");
    await pool.end();
  }
});

test("the publish sweeper rescues a post whose run was lost", async ({ request }) => {
  expect((await request.get("/api/cron/publish")).status()).toBe(401);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // A post that should have gone out ten minutes ago, with no run behind it.
    const { rows } = await pool.query(
      `insert into scheduled_posts (profile_id, text, scheduled_for)
       values ('9001', 'Rescued by the sweeper.', now() - interval '10 minutes') returning id`,
    );
    const response = await request.get("/api/cron/publish", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    expect(await response.json()).toMatchObject({ restarted: 1, stuck: 0 });
    await expect
      .poll(
        async () => (await pool.query("select status from scheduled_posts where id = $1", [rows[0].id])).rows[0].status,
        { timeout: 30_000 },
      )
      .toBe("published");
  } finally {
    await pool.end();
  }
});

test("signs in on a preview deployment through the production callback", async ({ page }) => {
  // localhost:3101 plays a Vercel preview. Meta only knows production's callback,
  // which relays the browser back to the preview that started the sign-in.
  const preview = "http://localhost:3101";
  await page.goto(`${preview}/api/auth/threads/start?tz=America/Toronto`);
  await expect(page).toHaveURL(`${preview}/home`);
  await expect(page.getByRole("link", { name: /credits/ })).toBeVisible();
});

test("relays sign-ins only to this app's own previews", async ({ page }) => {
  /** A relay state as a deployment of this app (holding its secret) would mint it. */
  const relayState = (origin: string) => {
    const payload = `nonce1234567890abcdefgh.${Buffer.from(origin).toString("base64url")}`;
    const key = createHash("sha256").update("threaded/oauth-relay:test-app-secret").digest();
    return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
  };
  const callback = (state: string) => `/api/auth/threads/callback?code=mock-code&state=${encodeURIComponent(state)}`;

  // Signed properly, but for an origin that isn't in PREVIEW_ORIGINS.
  await page.goto(callback(relayState("https://evil.example")));
  await expect(page).toHaveURL(/\/connect\?error=state/);
  // Pointing at an allowed preview, but not signed with the app secret.
  const [nonce, origin] = relayState("http://localhost:3101").split(".");
  await page.goto(callback(`${nonce}.${origin}.forged`));
  await expect(page).toHaveURL(/\/connect\?error=state/);
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
  await expect(shown(page.getByText("Your data has been deleted."))).toBeVisible();
  await expect(shown(page.getByText(confirmation_code))).toBeVisible();
});
