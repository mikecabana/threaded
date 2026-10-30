# Working on Threaded

Threaded is a Threads growth companion. People sign in with Threads; it learns what their
audience rewards ("Profile DNA") and writes post ideas in their voice, aimed at followers,
views or engagement. They post or schedule them from the app. It's a multi-tenant SaaS, live
in production, paid with prepaid credits or a Monthly plan. Agencies get in touch for a plan
that fits.

Read these first, in this order:

1. **This file**: how to work in the repo, and what bites.
2. **[`docs/PLAN.md`](docs/PLAN.md)**: the product and architecture.
   - The decisions table at the top.
   - The roadmap (§13).
   - The progress log (§17 and §18): what each change shipped, and why.
3. **[`docs/SETUP.md`](docs/SETUP.md)**: every outside service, every environment variable,
   local setup, and the **launch checklist (§5)**.

## Where things stand (Oct 29, 2026)

- **Shipped:**
  - **Phases 0–2:** sign-in and sync; Studio with Profile DNA and web and Threads research;
    credits, auto-recharge, the Monthly plan and the own-key plan; posting, scheduling and
    series; Insights; the scorecard and alert emails; admin and evals.
  - **Launch work, technical parts:** monitoring, cookie consent, SEO, account and data
    controls, voice settings, and a pricing review.
- **Last changes:**
  - **Agency tier instead of own key:** the pricing page's own-key plan is now an Agency tier
    with no price and a "Get in touch" email. Settings shows the own-key card only to
    workspaces that have used it.
  - **Mobile app shell (#33):** on phones the page scrolls inside the shell, between the top
    bar and the tabs. This is the fix for iOS Safari 26.
  - **Gateway model picker in `/admin` (#31).**
- **Open, and only the owner can do these** (dashboards, accounts, people):
  - Meta App Review (submitted).
  - A Quebec lawyer's review of the Terms and Privacy policy.
  - The Law 25 privacy items.
  - Search Console.
  - Checking that Stripe pays out into a USD bank account.

  See SETUP.md §5. Until App Review passes, only people with a role on the Meta app can sign in.
- **Good next work:**
  - **Drop the unused `scheduled_posts.reply_to_scheduled_id` column**, in two PRs.
    1. Remove it from `lib/db/schema.ts` without generating a migration. Drizzle selects
       every column, so the running deployment still reads it.
    2. In a later PR, run `pnpm db:generate` to drop it.

    See "Migrations must work with the previous deployment" below.
  - **Remove the own-key plan's code** once no workspace is on it (check Stripe for live
    own-key subscriptions). Code first, then its columns in a later release, as above.
  - **The roadmap's polish item:** drag-and-drop onto the week calendar.
  - **French, after launch:** the site, the app, the Terms and Privacy policy, and the emails
    (Bill 96).
  - **Phase 3:** a trend radar, reply analysis, A/B variants and a weekly digest.

## Stack and layout

Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4, Motion, AI SDK with the
Vercel AI Gateway, Neon Postgres with Drizzle, Stripe, Resend, Vercel Workflow, and Sentry.
Biome, Vitest and Playwright handle quality. pnpm 10 and Node 22+.

```
app/(marketing)     landing, connect, legal, data-deletion
app/(onboarding)    The Read (live sync) and the DNA reveal, after a first sign-in
app/(app)           signed-in app: home, studio, queue, insights, settings, admin (staff only)
app/api             auth, Stripe webhook and Checkout return, generate (streaming), cron, …
workflows/          Vercel Workflow runs: sync, publish, billing (auto-recharge)
lib/ai              model catalog, generation, research, classification (Jev), Profile DNA, mocks
lib/billing         wallet ledger, Checkout, subscriptions (Monthly and own-key plans), webhook
lib/publishing      schedule, publish, series, sweeper, scorecard
lib/sync            Threads sync; lib/threads is the typed Threads API client
lib/analysis        pure maths: KPIs, timing, insights, scorecard (unit-tested)
lib/admin           staff tools: margins, catalog, Gateway models, workspaces, credit adjustments
lib/db              Drizzle schema; SQL migrations live in drizzle/
lib/demo            demo personas: the app works with no env vars at all
lib/pricing.ts      every commercial number (markup, packs, plans, trial)
components/         UI by area; components/ui and components/motion are the building blocks
e2e/                Playwright specs + mock servers for Meta, Stripe, the AI Gateway and Resend
test/               integration-test helpers (database reset, a fake Threads API)
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the app at http://localhost:3000. "Try a demo account" works with no env vars. |
| `pnpm lint` / `pnpm format` | Biome check / fix. |
| `pnpm typecheck` | Generates route types, then runs `tsc`. |
| `pnpm test` | Unit tests (Vitest). |
| `pnpm test:int` | Integration tests against `TEST_DATABASE_URL`. **This wipes that database.** |
| `pnpm build && pnpm test:e2e` | Playwright, desktop and mobile. It serves the production build, so build first. |
| `pnpm db:generate` | Generates a SQL migration from `lib/db/schema.ts`. |
| `pnpm eval` | Compares models on real prompts (see SETUP.md, "Admin and evals"). |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, integration, build and e2e on every
PR, with Postgres 16. Run the same set before you push. Any throwaway Postgres 16 works
locally, e.g.
`docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=threaded_test postgres:16`,
then `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/threaded_test`. To use a
Chromium you already have, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

How the e2e setup works:

- **Mock servers:** Playwright starts mock servers for Meta (`e2e/mock-meta.mjs`) and for
  Stripe, the AI Gateway and Resend (`e2e/mock-billing.mjs`), then serves the app with
  `AI_MOCK=1`.
- **Mock AI:** `AI_MOCK=1` swaps in deterministic models (`lib/ai/mock-model.ts`) and a mock
  Gateway model list.
- **The real-account suite:** `e2e/account.spec.ts` signs in, buys credits and publishes,
  against a real database. It runs serially, and later tests depend on earlier ones (credit
  balances, for example), so add tests where the balances still add up.

## How changes get made

- **Branches and PRs:** one PR per change, from a branch off `main`, merged by the owner as a
  squash. Each PR gets a Vercel preview, except docs-only changes
  (`scripts/vercel-ignore-build.sh`). Production deploys from `main`.
- **Write-ups:** commit messages and PR descriptions say what changed for people and why.
  Every shipped change also adds an entry to PLAN.md §18, and a row in the decisions table
  when a decision changed.
- **The repo is public:**
  - No personal data, secrets, keys or customer details in commits, fixtures or docs.
  - Test data is made up (the demo personas, `@mock.user`).
  - Never print secrets from the environment.
- **Product rules:**
  - Credits never expire. The Terms say so; don't add expiry.
  - Prices come from `lib/pricing.ts`. Marketing, the FAQ, the Terms and billing all read from
    it, so change numbers there and nowhere else.
- **Copy:** UI text is plain, short, sentence case, and says what happens ("Your next 1,200
  credits come on Nov 27").
- **Code style:** match the surrounding code. Comments explain *why*, at the density of the
  file they're in.

## Things that bite

**Next.js 16 is newer than most training data.** Read the guide in
`node_modules/next/dist/docs/` before using an API (see the block below).

- **Cache Components is on.** Anything that reads the session, cookies or `searchParams`
  renders inside `<Suspense>`.
- **`searchParams` and `params` are Promises.**
- **Middleware lives in `proxy.ts`.**

**Migrations must work with the previous deployment.** Vercel runs `pnpm db:deploy`
(`scripts/migrate.mjs`) before every production build, while the old deployment is still
serving.

- Only add things: new columns, new tables, nullable columns, or defaults.
- To remove or rename a column, take two releases: first ship code that stops using it, then
  drop it in a later migration.
- `drizzle-kit generate` asks questions (renames, for example) and needs an interactive
  terminal.

**On phones, the page scrolls inside `<main>`, not the document** (`app/(app)/layout.tsx`).
iOS Safari 26 draws the page under its floating toolbar and clips fixed elements above it, so
a fixed tab bar let the page show through underneath. The shell is now exactly the screen's
height: top bar, scrolling `<main>`, then the tab bar. This has consequences:

- **Entrance animations must not wait on scrolling.** Safari doesn't report elements coming
  into view inside that scroll area, so anything using `whileInView` or `useInView` stays
  invisible there.
  - Use the hooks in `components/motion/scroll-reveal.tsx`: `useReveal` and
    `useScrollReveal`.
  - In the app shell (`PlayOnMount`) animations play on mount; on marketing pages they play
    on scroll.
  - `e2e/app-shell.spec.ts` catches a regression by stubbing `IntersectionObserver`.
- **Nothing may be wider than the screen**, or the page scrolls sideways.
  - Give grids explicit columns (`grid-cols-1` is `minmax(0, 1fr)`).
  - Wrap wide tables in `overflow-x-auto`.
  - Never put `sr-only` on a `<table>`: tables ignore `width: 1px`. Put it on a wrapping
    `<div>`.
- **Don't pin a blurred bar to the top of a page.** Safari 26 also draws the page behind
  the status bar, colouring that strip from a fixed or sticky bar at the top, and a
  backdrop blur on that bar makes it show the page through instead. The marketing header
  simply scrolls away with the page (`e2e/site-header.spec.ts`).

**More gotchas:**

- **Motion components:** Motion runs under `LazyMotion strict`, so use `m.div`, never
  `motion.div`.
- **e2e text and label queries:** page-wide `getByText` and `getByLabel` queries go through
  `shown()` (`e2e/helpers.ts`). While a Suspense boundary streams in, React briefly keeps a
  hidden copy of its content, and strict mode then finds two matches. Role queries skip
  hidden elements on their own.
- **Billing:**
  - The credit ledger is the source of truth. Every grant is unique on `(kind, ref)`, so the
    Stripe webhook and the Checkout return page can both fulfil the same payment safely.
  - A workspace has one subscription slot (`plan_kind`: `own_key` or `monthly`); the two plans
    never run at the same time.
  - See PLAN.md §6.
- **AI:**
  - Models come from the `model_catalog` table, edited in `/admin`.
  - Calls go through `lib/ai/models.ts`, which uses `platformGateway()` for our key and the
    workspace's key on the own-key plan.
  - Charges come from the cost the Gateway reports, times the markup.
  - Background work (classification, DNA) is on us.
- **Background jobs:**
  - They are Vercel Workflow runs (`workflows/`).
  - Crons are defined in `vercel.json`: a daily sync and catalog refresh, and a publish sweep
    every 5 minutes.
  - Locally they run in-process; see SETUP.md.
- **Who can use `/admin`:** users marked `is_staff`, or listed in `ADMIN_THREADS_USER_IDS`.
  Everyone else gets a 404.
- **Previews:** previews can't receive Stripe webhooks, and crons run only in production.
  Threads sign-in on a preview is relayed through production (`PREVIEW_ORIGINS`).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
