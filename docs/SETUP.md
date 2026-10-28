# Setup

How to run Threaded locally, and the one-time service setup Phase 0 needs. Only
the **Local development** section is needed to run the demo; the rest is needed
before real accounts can connect (Phase 1).

> Dashboard names below were accurate when written (Oct 2026), but Meta and
> Vercel move things around. If a step doesn't match, search the dashboard for
> the item's name.

## Local development

Requirements: Node 22+ (CI runs the latest LTS), pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev            # http://localhost:3000 → "Try a demo account"
```

With no environment variables set, the app runs entirely on the demo accounts.

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm format` | Biome check / auto-fix |
| `pnpm typecheck` | Route types + `tsc` |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:int` | Integration tests against `TEST_DATABASE_URL` (wipes that database) |
| `pnpm build && pnpm test:e2e` | Production build + Playwright (desktop and mobile). With `TEST_DATABASE_URL` set, also runs a real account end to end: Threads sign-in against a mock of Meta (`e2e/mock-meta.mjs`), and payments and key checks against a mock of Stripe and the AI Gateway (`e2e/mock-billing.mjs`) |
| `pnpm db:generate` | New SQL migration from `lib/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |

Background jobs (the Threads sync, auto-recharge, scheduled publishing) run on [Vercel Workflow](https://vercel.com/docs/workflow). Locally they
use the built-in Local World, so `pnpm dev` runs them with no setup; inspect runs with `npx workflow web`
or `npx workflow inspect runs`. Run data lives in `.workflow-data/` (gitignored).

For the integration and sign-in tests, any throwaway Postgres 16 works, for example
`docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=threaded_test postgres:16`
with `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/threaded_test`.

If your machine already has a Chromium build, point Playwright at it with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` instead of running
`pnpm exec playwright install chromium`.

## 1. Meta: Threads app (start this first; App Review takes time)

1. At [developers.facebook.com](https://developers.facebook.com/apps), create an app with the **Threads API** use case.
2. In the Threads use case, add the permissions `threads_basic`, `threads_manage_insights` and `threads_content_publish`.
   (`threads_keyword_search` is step 7; `threads_read_replies` comes later.)
3. Under the use case's settings, set:
   - **Redirect callback URLs:** `https://<production-host>/api/auth/threads/callback`, plus one fixed dev URL if you sign in locally (an ngrok or cloudflared tunnel). `<production-host>` is your project's `vercel.app` URL until you add a domain (see [Domains and previews](#domains-and-preview-deployments)). Preview deployments don't need entries of their own: they sign in through this one.
   - **Deauthorize callback URL:** `https://<production-host>/api/threads/uninstall`
   - **Data Deletion Requests URL:** `https://<production-host>/api/threads/delete`
4. Copy the **Threads** app ID and secret (from the Threads use case's settings, not the app's main ID and secret on the Basic settings page) into `THREADS_APP_ID` and `THREADS_APP_SECRET`. Threads tokens and user ids are scoped to that pair.
5. **Testers:** under App roles, add your own Threads account (and any teammates) as Threads testers. Each tester accepts the invite in the Threads app (Settings → Account → Website permissions → Invites). Until App Review approves the permissions, only testers can connect.
6. **App Review:** submit all three permissions, plus `threads_keyword_search` once it's added (step 7). You'll need:
   - Privacy policy URL: `https://<your-domain>/legal/privacy` (have it reviewed first; see below)
   - An app icon and category
   - A screencast for each permission. Record the demo flow, then a tester account connecting, the insights screens, and posting where the user **explicitly confirms** the post. For keyword search, show a topic in Studio and the "What people on Threads are saying" card under the ideas.
   - Business verification may be requested.
7. **Keyword search** (Studio reads recent popular Threads posts on a topic before writing):
   1. Add `threads_keyword_search` to the use case.
   2. Then set `THREADS_KEYWORD_SEARCH=1` in Vercel (Production and Preview) and redeploy, so sign-in asks for it. Not before: Threads refuses a sign-in that asks for a permission the app hasn't added.
   3. Reconnect your account once (Studio shows a "reconnect Threads" link under Topic). Everyone who connected before does the same.

   Until App Review approves it, the search only finds your own posts, which Studio leaves out, so Studio stays on the web alone. Each batch with a topic uses one of the user's 2,200 keyword searches a day.

## 2. Vercel project

1. Import the GitHub repo into Vercel. The framework preset is detected automatically.
2. **Storage → Neon Postgres** (Marketplace). This injects `DATABASE_URL`. Use the **pooled** connection string (host contains `-pooler`): the app connects with node-postgres and Vercel's `attachDatabasePool`. Enable preview branching so each preview deployment gets its own database branch.
3. **Storage → Upstash Redis** (Marketplace). This injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **AI Gateway:** enable it for the team. The model catalog is seeded with Claude Haiku/Sonnet/Opus 5.5 (`lib/ai/catalog.ts`). Check those ids against `gateway.getAvailableModels()` (any the Gateway doesn't list are disabled at the next nightly sync). Studio's web research uses the Gateway's Perplexity Search tool, billed to the same Gateway account ($5 per 1,000 searches); there's nothing else to set up. Deployments authenticate with OIDC automatically. For local development, create an API key and put it in `AI_GATEWAY_API_KEY`, or run `vercel env pull .env.local` after `vercel link`.
5. Add the remaining variables from `.env.example` under Settings → Environment Variables:
   - Generate `SECRETS_ENC_KEY` and `SESSION_SECRET` with `openssl rand -base64 32`. Use **different values per environment**, and never rotate `SECRETS_ENC_KEY` without a re-encryption step, since it encrypts stored tokens.
   - Leave `THREADS_REDIRECT_URI` and `APP_URL` unset on Vercel: the production URL comes from Vercel (see [Domains and previews](#domains-and-preview-deployments)).
   - For previews, see the same section: `PREVIEW_ORIGINS`, their own database and secrets, or `DEMO_MODE=1` to keep them demo-only.
   - Generate `CRON_SECRET` the same way. Vercel Cron sends it as a Bearer token to the two crons in `vercel.json`: `/api/cron/daily` (06:00 UTC: model prices, the publish sweep, a refresh workflow per connected profile) and `/api/cron/publish` (every 5 minutes: the scheduled-post safety net).
   - The 5-minute cron needs a Vercel **Pro** plan; Hobby plans only allow daily crons and the deploy fails. On Hobby, delete that entry: the daily cron also runs the publish sweep, so missed posts are still rescued, just later.
   - Keep **Fluid compute** on (the default for new projects); Vercel Workflow needs it.
6. Docs-only changes don't build previews: `vercel.json`'s `ignoreCommand` runs `scripts/vercel-ignore-build.sh`, which skips a preview when nothing outside `docs/` and Markdown files changed since the branch's last deployment (or, on its first, since it left `main`). Production always builds, and so does anything the script can't be sure about.
7. The schema is applied on every deploy: `vercel.json` builds with `pnpm db:deploy && pnpm build`, and `db:deploy` runs the migrations in `drizzle/` against that deployment's database (the unpooled URL when Neon provides one). Keep migrations additive, since the previous deployment serves traffic until the new one is ready. `SKIP_MIGRATIONS=1` turns it off.

## Domains and preview deployments

Nothing in the code names a domain. Threaded works out its URLs per deployment:

- **The production URL** comes from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`: your `<project>.vercel.app` URL, or your custom domain once you add one. (Keep "Automatically expose System Environment Variables" on in the project settings; it's on by default.) `APP_URL` overrides it if you ever need to.
- **Threads sign-in** always goes through `https://<production-host>/api/auth/threads/callback`, the one URL Meta allows.
- **Stripe Checkout and the billing portal** send people back to whichever deployment they started from, and that page applies the payment straight away. Stripe's webhook goes to production only.

**Testing on vercel.app now.** Register the three Meta URLs and the Stripe webhook (`https://<production-host>/api/stripe/webhook`) with your `vercel.app` host. Nothing else to set.

**When you buy a domain.** No code or variable changes, but the order matters:

1. In Meta, add `https://<new-domain>/api/auth/threads/callback` as a second redirect URL. Keep the old one until the switch is done, because the next deployment moves sign-in to the new domain.
2. If the DNS lives elsewhere (e.g. Cloudflare), point it at Vercel with the records Vercel shows. **DNS only** (no proxy) is simplest: Vercel's CDN and certificates sit directly in front of the app. Cloudflare's proxy works too (production runs behind it) with these settings:
   - SSL/TLS mode **Full (strict)**. Flexible loops forever, because Vercel redirects HTTP to HTTPS.
   - **Email Address Obfuscation off.** It rewrites `mailto:` links in the HTML before React hydrates it.
   - **Rocket Loader off**, and no "Cache Everything" rules: signed-in pages differ per person, and Cloudflare's cache ignores the `Vary` headers Next.js relies on. The default (static files only) is fine.
   - **Bot Fight Mode off**, and no challenge rules on `/api/`. Stripe and Meta POST to `/api/stripe/webhook`, `/api/threads/uninstall` and `/api/threads/delete` from servers that can't solve a challenge, and the Free plan's Bot Fight Mode can't be skipped per path.
   - Nothing that blocks or caches `/.well-known/acme-challenge/`, which is how Vercel renews the certificate.

   Cron jobs and workflow steps call the deployment's own `vercel.app` URL, so they never pass through the proxy. Vercel sees Cloudflare's IPs rather than visitors' (Cloudflare sends the real one in `CF-Connecting-IP`); nothing in the app uses client IPs yet.
3. Add the domain under Settings → Domains. Vercel's production URL is the **shortest** production domain, so if you add both `example.com` and `www.example.com`, the bare domain must be the one that serves, with `www` redirecting to it. Otherwise sign-in breaks: the callback points at the bare domain while visitors are on `www`. To serve `www` instead, set `APP_URL=https://www.example.com` and register that callback in Meta.
4. Redeploy production. Then set the old `vercel.app` domain to redirect to the new one (Settings → Domains → Edit), since sign-in only runs on the production URL and previews.
5. Point Meta's deauthorize and data-deletion callbacks and the privacy and terms URLs at the new domain, and remove the old redirect URL once sign-in works there. Edit the live Stripe webhook's URL; its signing secret stays the same.

**Demoing on preview deployments.** Demo accounts work on every preview with no setup. For real Threads accounts on previews:

1. Set `PREVIEW_ORIGINS` in **both** Production and Preview to your preview URLs as a pattern, e.g. `https://threaded-*-your-team.vercel.app`. Copy any preview URL from the dashboard and replace the part between the project name and your team with `*`. Production needs it too, because that's where Meta returns: it relays the sign-in back to the preview that started it, but only to origins on this list, and only with a state signed by your Threads app secret.
2. Give previews their own database: in the Neon integration, turn on a database branch per preview deployment. Each preview build migrates its branch.
3. A Neon branch starts as a copy of its parent, real users included. Use **different** `SECRETS_ENC_KEY` and `SESSION_SECRET` values in the Preview environment, so production tokens copied into a branch can't be decrypted there; people simply connect Threads again on the preview. Use the same Threads app ID and secret as production, Stripe **test** keys, and the AI Gateway (OIDC works on previews too).
   For `STRIPE_WEBHOOK_SECRET` on Preview, use any random value, e.g. `echo "whsec_$(openssl rand -hex 24)"`. Stripe can't send webhooks to changing preview URLs, and previews don't need them; the app only needs the variable set to turn payments on. A forged event couldn't do anything either, since the handler re-reads every object from Stripe.
4. Previews are behind Vercel Authentication by default. To show one to someone outside your team, use the deployment's **Share** button to create a shareable link, or relax Deployment Protection for previews.

What's different on a preview: crons only run in production, so there's no daily refresh or 5-minute publish sweep there (scheduled posts still go out on time through their own workflow runs), and Stripe webhooks don't reach previews (top-ups, saved cards and starting the own-key plan are applied when Checkout returns; changes made later in the Stripe portal aren't). To keep a preview demo-only, set `DEMO_MODE=1` for it.

## 3. Stripe (test mode)

Threaded is run from Quebec, so the Stripe account is **Canadian**, but prices are in **US dollars**: AI costs
are billed to us in USD, and Stripe shows customers abroad, Canadians included, a converted price at checkout
(Adaptive Pricing is on for the account; Checkout Sessions still report their amounts in USD). Threaded uses hosted Checkout
and the hosted billing portal, so there's no publishable key and no products to create: prices come from
`lib/pricing.ts` (credit packs of $5/$20/$50, a $1 trial, a 1.5× default markup and a $5/month BYOK platform
fee). Credits never expire.

1. Use the **Threaded** Stripe account (Canada) in **test mode**, not a separate sandbox. Put its test secret
   key in `STRIPE_SECRET_KEY`.
2. **Webhook:** add an endpoint for `https://<your-domain>/api/stripe/webhook` with exactly these events, and
   put its signing secret in `STRIPE_WEBHOOK_SECRET`:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`. Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook --events …`
   prints a secret to use instead.
3. **Customer portal:** nothing to do. Stripe creates a default configuration the first time a portal opens,
   and its defaults are what Threaded needs: update cards, see invoices, cancel the plan at the end of the
   period, edit the billing address.
4. **Sales tax (Stripe Tax).** Prices are tax-exclusive: tax is added on top, based on the customer's address,
   which Checkout collects.
   - In Tax settings, enter the head office address in Quebec (done in test mode).
   - Add your registrations: **Canada, normal GST/HST** and **Quebec, QST**, each from its effective date (tax
     charged before then isn't yours to keep). Stripe then charges GST + QST in Quebec and GST or HST in the
     other provinces. Customers outside Canada pay no Canadian tax. Stripe watches the sales thresholds for BC,
     Manitoba and Saskatchewan and for other countries; EU and UK VAT on digital services can apply from the
     first sale. Test mode already has both registrations.
   - Pick the default product tax code with your accountant; Threaded's inline prices don't set one, so the
     default applies. Candidates: `txcd_10103001` (SaaS, business use), `txcd_10103000` (SaaS, personal use),
     `txcd_10105002` / `txcd_10105001` (AI as a service, cloud, business / personal use). Canadian tax is the
     same under all four; they differ for US states. Test mode uses `txcd_10103000`.
   - Add your GST and QST numbers to the account so they print on invoices; business customers need them to
     claim input tax credits.
   - Set `STRIPE_AUTOMATIC_TAX=1` (Production and Preview).
5. **Payouts:** Stripe converts USD to CAD when it pays out. Add a USD bank account if you'd rather keep USD.

Payments stay off (the billing page says so) until both Stripe variables are set.

**Language:** customers whose browser prefers French get French receipts and invoices from Stripe (set on
their Stripe customer at their first purchase), and Checkout follows the browser's language on its own.

**Testing by hand:** card `4242 4242 4242 4242` pays. To see a failed auto-recharge, save
`4000 0000 0000 0341` (it saves fine, then every charge is declined), and lower your balance under
the threshold with a generation. With tax on, Checkout asks for an address: a Quebec postal code such as
`H2X 1Y4` shows GST and QST on top of the price.

**How it fits together** (details in `docs/PLAN.md` §6): our ledger decides what a workspace can
spend; Stripe only takes money. A paid Checkout Session or auto-recharge invoice adds a lot of
credits, fulfilled from both the webhook and the return page (`/api/billing/return`), idempotently.
Auto-recharge charges the saved card off-session through an invoice, from a Vercel Workflow run.

## 4. Resend

Alert emails (a scheduled post that didn't go out, a declined auto-recharge, a lapsed plan, a
reminder to reconnect Threads) go through [Resend](https://resend.com). Until it's set up, they're
logged instead of sent, and everything else works.

1. Create an account and add `getthreaded.app` under **Domains**.
2. Resend lists a few DNS records (DKIM, plus SPF and an MX record on a `send` subdomain). Add them
   in Cloudflare's DNS, each set to **DNS only** (grey cloud), then click **Verify** in Resend.
3. Create an API key with **Sending access** for that domain, and put it in Vercel's Production
   `RESEND_API_KEY`. Leave it out of Preview, so previews never email real people.
4. Optional: `EMAIL_FROM` (for example `Threaded <alerts@getthreaded.app>`). By default emails come
   from `alerts@` the production domain.

People add an address in **Settings → Email alerts**. It's stored only after they open the
confirmation link, and each alert goes out once per event (the `email_log` table).

## Monitoring and cookies

**Sentry** reports errors from the server, the proxy and the browser. Before anything leaves, tokens
in URLs, request bodies, cookies, headers, the user and any row Postgres quotes in an error are
removed, and console breadcrumbs are dropped (`lib/monitoring/scrub.ts`). Errors only: no tracing
or session replay.

1. Create a Sentry project (platform: Next.js). In its settings, under **Security & Privacy**, turn
   on **Prevent Storing of IP Addresses**.
2. In Vercel (Production and Preview), add `NEXT_PUBLIC_SENTRY_DSN` with the project's DSN.
3. For readable stack traces, add `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` (an
   organization token with source map upload) too; builds then upload source maps. Without the
   token, builds skip that step.

**Google Tag Manager** loads on every page under Google's Consent Mode v2 (`consentBootScript` in
`lib/consent/consent.ts`). Before it loads, consent defaults are set by region: denied where the law
asks first (Quebec under Law 25, the EU and EEA, the UK and Switzerland, and anywhere the location is
unknown), granted elsewhere. There, a banner asks; the answer updates consent and is saved in the
browser, and on later visits the saved choice is the default instead. **Cookie settings** in the
footer and on the Privacy page reopens the choices. The banner names no tools; the Privacy page does
(Google Analytics and Tag Manager, Sentry, Vercel, and ad platforms such as Google Ads or Reddit Ads).

1. Create a web container in Tag Manager and set up your tags inside it (Google Analytics 4 now,
   ad platforms later). Google's own tags follow the consent signals (`analytics_storage`,
   `ad_storage`, `ad_user_data`, `ad_personalization`) on their own. Tags without built-in consent
   support, such as the Reddit pixel, need **Advanced Settings → Consent Settings → Require
   additional consent** set to `ad_storage`, or they'd fire regardless. Check them all under
   Tag Manager's **Consent Overview**.
2. While consent is denied, Google's tags still send cookieless pings (Consent Mode's "advanced"
   mode). That's what the Privacy page describes; if your lawyer prefers nothing at all to reach
   Google before a yes, say so and the loader can wait for the choice in those regions instead.
3. Add `GTM_ID` (`GTM-…`) in Vercel's Production environment. Without it there's no banner and no
   Tag Manager.
4. The visitor's location comes from Cloudflare when it's in front (Vercel only sees Cloudflare's
   address then). For the province, turn on **Rules → Settings → Managed Transforms → Add visitor
   location headers** in Cloudflare. Without it, Canadian visitors are asked, since Quebec can't
   be told apart. When the location is unknown, visitors are asked too.

## Search and sharing

The app publishes what search engines and link previews need on its own: titles, descriptions and
canonical URLs on the production domain, share images (`opengraph-image.tsx` next to each public
page), `robots.txt`, `sitemap.xml`, a web manifest and schema.org data on the home page
(`lib/seo.ts`). Signed-in pages are marked `noindex`, and previews turn every crawler away.

1. **Google Search Console:** add a **Domain** property for your domain and verify it with the DNS
   TXT record it gives you (add it in Cloudflare → DNS). Then submit
   `https://<your-domain>/sitemap.xml` under Sitemaps.
2. **Bing Webmaster Tools:** import the site from Search Console (this also covers DuckDuckGo and
   Yahoo, which use Bing's index).
3. **Cloudflare:** check `https://<your-domain>/robots.txt` after the first deploy. Cloudflare's
   **Managed robots.txt** and AI bot settings can add to it or block crawlers. Leave Googlebot
   and Bingbot allowed.
4. **Share previews:** paste the home page into Meta's
   [Sharing Debugger](https://developers.facebook.com/tools/debug/) and LinkedIn's
   [Post Inspector](https://www.linkedin.com/post-inspector/) to check the image and refresh their
   caches after a change.

## Admin and evals

**Admin (`/admin`)** has the margin view, the model catalog and workspace lookup. Only staff can
open it; everyone else gets a 404.

1. Sign in, open **Settings**, and copy your **Threads user ID** from the account card.
2. In Vercel, add `ADMIN_THREADS_USER_IDS` with that ID to Production (comma-separate several).
   Setting `users.is_staff` to true for a user works too.
3. Redeploy, then use the **Admin** card in Settings.

The catalog page lists each AI task with its default model, then the models themselves. A task's
list holds the models switched on and offered for it, and only Studio lets people pick from it.
Post labels run on Jev (`CLASSIFIER_MODEL` in `lib/ai/classify-questions.ts`), a decision model
set in code; the catalog's default for that task names each account's topics and backs Jev up.

Credit adjustments are written to the ledger with the reason and who made them. For a card
refund, refund the payment in Stripe first, then take the credits back in the workspace's page.

**Evals (`pnpm eval`)** run the demo personas through Studio's prompt and grade the batches
(`lib/evals/eval.ts`): voice and goal fit from a judge model, and length, repeats and cost
measured directly. Run them locally with an AI Gateway key before switching a model on or making
it a default:

```bash
AI_GATEWAY_API_KEY=… pnpm eval --model anthropic/claude-haiku-5.5,anthropic/claude-sonnet-5.5
pnpm eval --mock    # the whole harness on stand-in models, no key needed
```

Options: `--judge <model>` (default: the catalog's best-tier model), `--personas creator,expert,brand`,
`--goals followers,views,engagement`, `--count 5`. Each model's report is saved to
`evals/results/` (not committed unless you choose to). A full run is 9 batches per model plus 9
judge calls, roughly $0.50 on the default models.

## 5. Before launch

- [ ] Replace `SITE.contactEmail` in `lib/site.ts` with the real support address.
- [ ] Have a Quebec lawyer review `/legal/terms` and `/legal/privacy`, then remove the draft banner in `components/marketing/legal-page.tsx`. Ask in particular about Quebec's Consumer Protection Act: its rules for online (distance) contracts (what to disclose before purchase, the confirmation afterwards) and for the renewing $5/month plan.
- [ ] **French** (Charter of the French Language, as amended by Bill 96): French versions of the site, app, Terms, Privacy and emails, planned as the launch phase in `docs/PLAN.md` §13. Confirm the exact scope with the lawyer. Stripe receipts and Checkout already switch to French.
- [ ] **Privacy (Quebec's Law 25):**
  - Name the person in charge of protecting personal information, and publish their title and contact details on the site.
  - Do a privacy impact assessment before personal information leaves Quebec. Vercel, Neon, Stripe, Meta and the AI providers all process it elsewhere.
  - Keep a register of confidentiality incidents.
- [ ] **Live Stripe:** the head office address, GST/HST + QST registrations with your numbers, the product tax code, and `STRIPE_AUTOMATIC_TAX=1` (§3). Live and test mode are configured separately: check that Tax shows **Active** in live mode, or Checkout fails while tax is on.
- [ ] **Live Stripe webhook:** a live-mode endpoint for `https://<production-host>/api/stripe/webhook` with the same six events (§3). Its signing secret, not the test endpoint's, goes in Production's `STRIPE_WEBHOOK_SECRET`.
- [ ] **Meta:** verify the app's contact email (App settings → Basic), then submit App Review (§1, step 6). The app stays in development mode, open to Threads testers only, until it's approved.
- [ ] **Database URLs:** change `sslmode=require` to `sslmode=verify-full` in `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (Production and Preview). It's the same check `pg` does today, and it clears the "SSL modes" warning in the logs before `pg` 9 changes what `require` means.
- [ ] **Monitoring and cookies:** the Sentry project and Tag Manager container, their keys in Vercel, and Cloudflare's visitor location headers ([Monitoring and cookies](#monitoring-and-cookies)). The privacy impact assessment (Law 25, above) covers Sentry and Google too.
- [ ] **Search:** verify the domain in Google Search Console and submit the sitemap, import it into Bing, and check `robots.txt` on the live site ([Search and sharing](#search-and-sharing)).
- [ ] **Pricing and costs:** revisit them against real usage before sign-ups open. In `/admin` → Margins, compare what a typical batch costs (the Studio model, research, web searches) with what it charges, per model. Then settle the markup (1.5× by default, overridable per model in the catalog), the credit packs ($5, $20, $50), the 100 free credits, and the $5/month own-key fee (`lib/pricing.ts`). Count Stripe's fees (the fixed 30¢ weighs most on the $5 pack) and Stripe Tax's, and the monthly running costs (Vercel, Neon, Sentry, Resend, the domain). Settle the markup before launch: credits never expire, and a markup change also changes what credits people already bought are worth.
- [ ] Confirm which secret signs Meta's deauthorize and data-deletion callbacks (the one ⚠ left in `docs/PLAN.md` §2; everything else there was checked against Meta's docs).
