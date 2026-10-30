# Threaded

A Threads growth companion. Connect a Threads account, and Threaded learns what
your audience rewards and writes post ideas in your voice, aimed at **more
followers**, **more views** or **more engagement**. You can post or schedule
them without leaving the app.

**Status:** live in production. Shipped so far:
- Threads sign-in and sync, with Profile DNA and Insights.
- Studio, which writes posts and threads and can research a topic on the web and on Threads
  first.
- Posting, scheduling and series from a Queue.
- Billing: credit packs, auto-recharge and a Monthly plan. Agencies get in touch.
- Alert emails, an admin area, and account and data controls.

Three demo accounts work with no setup. To work on the code, start with
[`AGENTS.md`](AGENTS.md); the full plan and progress log are in [`docs/PLAN.md`](docs/PLAN.md).

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 and press **Try a demo account**. No environment
variables are needed for the demo. Service setup is in [`docs/SETUP.md`](docs/SETUP.md).

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS 4 · Motion ·
AI SDK + Vercel AI Gateway · Neon Postgres + Drizzle · Upstash Redis · Stripe · Resend ·
Vercel Workflow · Sentry. Biome, Vitest and Playwright for quality.

## Layout

```
app/(marketing)     landing, connect, legal pages
app/(onboarding)    The Read and the DNA reveal, after a first sign-in
app/(app)           signed-in app: home, studio, queue, insights, settings, admin
workflows/          background runs: sync, publishing, auto-recharge
lib/                domain code (ai, billing, publishing, sync, analysis, db, …)
components/         UI by area; ui/ and motion/ are the building blocks
docs/               PLAN.md (product, architecture, progress) and SETUP.md (services, launch checklist)
e2e/                Playwright tests and mock servers
```

A fuller map, the commands, and the conventions are in [`AGENTS.md`](AGENTS.md).
