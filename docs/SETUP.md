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
   (`threads_read_replies` and `threads_keyword_search` come later.)
3. Under the use case's settings, set:
   - **Redirect callback URLs:** `https://<production-host>/api/auth/threads/callback`, plus one fixed dev URL if you sign in locally (an ngrok or cloudflared tunnel). `<production-host>` is your project's `vercel.app` URL until you add a domain (see [Domains and previews](#domains-and-preview-deployments)). Preview deployments don't need entries of their own: they sign in through this one.
   - **Deauthorize callback URL:** `https://<production-host>/api/threads/uninstall`
   - **Data Deletion Requests URL:** `https://<production-host>/api/threads/delete`
4. Copy the **Threads** app ID and secret (from the Threads use case's settings, not the app's main ID and secret on the Basic settings page) into `THREADS_APP_ID` and `THREADS_APP_SECRET`. Threads tokens and user ids are scoped to that pair.
5. **Testers:** under App roles, add your own Threads account (and any teammates) as Threads testers. Each tester accepts the invite in the Threads app (Settings → Account → Website permissions → Invites). Until App Review approves the permissions, only testers can connect.
6. **App Review:** submit all three permissions. You'll need:
   - Privacy policy URL: `https://<your-domain>/legal/privacy` (have it reviewed first; see below)
   - An app icon and category
   - A screencast for each permission. Record the demo flow, then a tester account connecting, the insights screens, and posting where the user **explicitly confirms** the post.
   - Business verification may be requested.

## 2. Vercel project

1. Import the GitHub repo into Vercel. The framework preset is detected automatically.
2. **Storage → Neon Postgres** (Marketplace). This injects `DATABASE_URL`. Use the **pooled** connection string (host contains `-pooler`): the app connects with node-postgres and Vercel's `attachDatabasePool`. Enable preview branching so each preview deployment gets its own database branch.
3. **Storage → Upstash Redis** (Marketplace). This injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **AI Gateway:** enable it for the team. The model catalog is seeded with Claude Haiku/Sonnet/Opus 5.5 (`lib/ai/catalog.ts`). Check those ids against `gateway.getAvailableModels()` (any the Gateway doesn't list are disabled at the next nightly sync). Deployments authenticate with OIDC automatically. For local development, create an API key and put it in `AI_GATEWAY_API_KEY`, or run `vercel env pull .env.local` after `vercel link`.
5. Add the remaining variables from `.env.example` under Settings → Environment Variables:
   - Generate `SECRETS_ENC_KEY` and `SESSION_SECRET` with `openssl rand -base64 32`. Use **different values per environment**, and never rotate `SECRETS_ENC_KEY` without a re-encryption step, since it encrypts stored tokens.
   - Leave `THREADS_REDIRECT_URI` and `APP_URL` unset on Vercel: the production URL comes from Vercel (see [Domains and previews](#domains-and-preview-deployments)).
   - For previews, see the same section: `PREVIEW_ORIGINS`, their own database and secrets, or `DEMO_MODE=1` to keep them demo-only.
   - Generate `CRON_SECRET` the same way. Vercel Cron sends it as a Bearer token to the two crons in `vercel.json`: `/api/cron/daily` (06:00 UTC: model prices, the publish sweep, a refresh workflow per connected profile) and `/api/cron/publish` (every 5 minutes: the scheduled-post safety net).
   - The 5-minute cron needs a Vercel **Pro** plan; Hobby plans only allow daily crons and the deploy fails. On Hobby, delete that entry: the daily cron also runs the publish sweep, so missed posts are still rescued, just later.
   - Keep **Fluid compute** on (the default for new projects); Vercel Workflow needs it.
6. The schema is applied on every deploy: `vercel.json` builds with `pnpm db:deploy && pnpm build`, and `db:deploy` runs the migrations in `drizzle/` against that deployment's database (the unpooled URL when Neon provides one). Keep migrations additive, since the previous deployment serves traffic until the new one is ready. `SKIP_MIGRATIONS=1` turns it off.

## Domains and preview deployments

Nothing in the code names a domain. Threaded works out its URLs per deployment:

- **The production URL** comes from Vercel's `VERCEL_PROJECT_PRODUCTION_URL`: your `<project>.vercel.app` URL, or your custom domain once you add one. (Keep "Automatically expose System Environment Variables" on in the project settings; it's on by default.) `APP_URL` overrides it if you ever need to.
- **Threads sign-in** always goes through `https://<production-host>/api/auth/threads/callback`, the one URL Meta allows.
- **Stripe Checkout and the billing portal** send people back to whichever deployment they started from, and that page applies the payment straight away. Stripe's webhook goes to production only.

**Testing on vercel.app now.** Register the three Meta URLs and the Stripe webhook (`https://<production-host>/api/stripe/webhook`) with your `vercel.app` host. Nothing else to set.

**When you buy a domain.** Add it under Settings → Domains. From the next deployment the production URL is the new domain. Then add the new redirect URL in Meta (keep the old one until the switch is done), update the deauthorize and data-deletion callbacks, and move the Stripe webhook. No code or variable changes. Also set the old `vercel.app` domain to redirect to the new one (Settings → Domains → Edit), since sign-in only runs on the production URL and previews.

**Demoing on preview deployments.** Demo accounts work on every preview with no setup. For real Threads accounts on previews:

1. Set `PREVIEW_ORIGINS` in **both** Production and Preview to your preview URLs as a pattern, e.g. `https://threaded-*-your-team.vercel.app`. Copy any preview URL from the dashboard and replace the part between the project name and your team with `*`. Production needs it too, because that's where Meta returns: it relays the sign-in back to the preview that started it, but only to origins on this list, and only with a state signed by your Threads app secret.
2. Give previews their own database: in the Neon integration, turn on a database branch per preview deployment. Each preview build migrates its branch.
3. A Neon branch starts as a copy of its parent, real users included. Use **different** `SECRETS_ENC_KEY` and `SESSION_SECRET` values in the Preview environment, so production tokens copied into a branch can't be decrypted there; people simply connect Threads again on the preview. Use the same Threads app ID and secret as production, Stripe **test** keys, and the AI Gateway (OIDC works on previews too).
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

Create an account, verify your sending domain, and put the API key in `RESEND_API_KEY`.

## 5. Before launch

- [ ] Replace `SITE.contactEmail` in `lib/site.ts` with the real support address.
- [ ] Have a Quebec lawyer review `/legal/terms` and `/legal/privacy`, then remove the draft banner in `components/marketing/legal-page.tsx`. Ask in particular about Quebec's Consumer Protection Act: its rules for online (distance) contracts (what to disclose before purchase, the confirmation afterwards) and for the renewing $5/month plan.
- [ ] **French** (Charter of the French Language, as amended by Bill 96): French versions of the site, app, Terms, Privacy and emails, planned as the launch phase in `docs/PLAN.md` §13. Confirm the exact scope with the lawyer. Stripe receipts and Checkout already switch to French.
- [ ] **Privacy (Quebec's Law 25):**
  - Name the person in charge of protecting personal information, and publish their title and contact details on the site.
  - Do a privacy impact assessment before personal information leaves Quebec. Vercel, Neon, Stripe, Meta and the AI providers all process it elsewhere.
  - Keep a register of confidentiality incidents.
- [ ] **Live Stripe:** the head office address, GST/HST + QST registrations with your numbers, the product tax code, and `STRIPE_AUTOMATIC_TAX=1` (§3).
- [ ] Confirm which secret signs Meta's deauthorize and data-deletion callbacks (the one ⚠ left in `docs/PLAN.md` §2; everything else there was checked against Meta's docs).
