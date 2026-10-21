# Setup

How to run Threaded locally, and the one-time service setup Phase 0 needs. Only
the **Local development** section is needed to run the demo; the rest is needed
before real accounts can connect (Phase 1).

> Dashboard names below were accurate when written (Oct 2026), but Meta and
> Vercel move things around. If a step doesn't match, search the dashboard for
> the item's name.

## Local development

Requirements: Node 22+, pnpm 10 (`corepack enable`).

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
| `pnpm build && pnpm test:e2e` | Production build + Playwright (desktop and mobile) |
| `pnpm db:generate` | New SQL migration from `lib/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |

If your machine already has a Chromium build, point Playwright at it with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` instead of running
`pnpm exec playwright install chromium`.

## 1. Meta: Threads app (start this first; App Review takes time)

1. At [developers.facebook.com](https://developers.facebook.com/apps), create an app with the **Threads API** use case.
2. In the Threads use case, add the permissions `threads_basic`, `threads_manage_insights` and `threads_content_publish`.
   (`threads_read_replies` and `threads_keyword_search` come later.)
3. Under the use case's settings, set:
   - **Redirect callback URLs:** `https://<your-domain>/api/auth/threads/callback`, plus one fixed dev URL (an ngrok or cloudflared tunnel, or a stable Vercel alias). Meta needs exact HTTPS URLs, so random preview URLs won't work; previews run in demo mode instead.
   - **Uninstall callback URL:** `https://<your-domain>/api/threads/uninstall`
   - **Delete callback URL:** `https://<your-domain>/api/threads/delete`
4. Copy the Threads app ID and secret into `THREADS_APP_ID` and `THREADS_APP_SECRET`.
5. **Testers:** under App roles, add your own Threads account (and any teammates) as Threads testers. Each tester accepts the invite in the Threads app (Settings → Account → Website permissions → Invites). Until App Review approves the permissions, only testers can connect.
6. **App Review:** submit all three permissions. You'll need:
   - Privacy policy URL: `https://<your-domain>/legal/privacy` (have it reviewed first; see below)
   - An app icon and category
   - A screencast for each permission. Record the demo flow, then a tester account connecting, the insights screens, and posting where the user **explicitly confirms** the post.
   - Business verification may be requested.

## 2. Vercel project

1. Import the GitHub repo into Vercel. The framework preset is detected automatically.
2. **Storage → Neon Postgres** (Marketplace). This injects `DATABASE_URL`. Enable preview branching so each preview deployment gets its own database branch.
3. **Storage → Upstash Redis** (Marketplace). This injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **AI Gateway:** enable it for the team. Deployments authenticate with OIDC automatically. For local development, create an API key and put it in `AI_GATEWAY_API_KEY`, or run `vercel env pull .env.local` after `vercel link`.
5. Add the remaining variables from `.env.example` under Settings → Environment Variables:
   - Generate `SECRETS_ENC_KEY` and `SESSION_SECRET` with `openssl rand -base64 32`. Use **different values per environment**, and never rotate `SECRETS_ENC_KEY` without a re-encryption step, since it encrypts stored tokens.
   - Set `DEMO_MODE=1` for the **Preview** environment only.
   - Generate `CRON_SECRET` the same way.
6. Apply the schema: `pnpm db:migrate` with the production `DATABASE_URL` (or let a deploy hook run it once Phase 1 adds one).

## 3. Stripe (test mode)

1. Create a Stripe account and stay in **test mode**.
2. Copy the secret and publishable keys into `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. Turn on **Stripe Tax** (credit packs are taxable in many places).
4. Phase 1 adds the webhook endpoint (`/api/stripe/webhook`); its signing secret goes in `STRIPE_WEBHOOK_SECRET`. Locally, use `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Prices live in code (`lib/pricing.ts`): credit packs of $5/$20/$50, a $1 trial,
a 1.5× default markup, a $5/month BYOK platform fee, and a 12-month credit expiry.

## 4. Resend

Create an account, verify your sending domain, and put the API key in `RESEND_API_KEY`.

## 5. Before launch

- [ ] Replace `SITE.contactEmail` in `lib/site.ts` with the real support address.
- [ ] Have a lawyer review `/legal/terms` and `/legal/privacy`, then remove the draft banner in `components/marketing/legal-page.tsx`.
- [ ] Confirm the ⚠ items in `docs/PLAN.md` §2 against Meta's live docs (field lists, the token-refresh age rule, the text auto-publish flag, the emoji length rule, and the intent URL in `lib/threads/intent.ts`).
