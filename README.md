# Threaded

A Threads growth companion. Connect a Threads account, and Threaded learns what
your audience rewards and writes post ideas in your voice, aimed at **more
followers**, **more views** or **more engagement**. You can post or schedule
them without leaving the app.

**Status:** Phase 1 is feature-complete: Threads sign-in and sync, AI post
ideas in Studio, billing (credit packs, auto-recharge, or your own AI Gateway
key), and posting or scheduling straight to Threads from a Queue. Three demo
accounts work with no setup. See [`docs/PLAN.md`](docs/PLAN.md).

## Quick start

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 and press **Try a demo account**. No environment
variables are needed for the demo. Service setup is in [`docs/SETUP.md`](docs/SETUP.md).

## Stack

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS 4 · Motion ·
AI SDK + Vercel AI Gateway · Neon Postgres + Drizzle · Upstash Redis · Stripe ·
Vercel Workflow. Biome, Vitest and Playwright for quality.

## Layout

```
app/(marketing)     landing, connect, legal pages
app/(app)           signed-in app: home, studio, queue, insights, settings
components/motion   animation building blocks (count-up, thread line, sparkline, tilt…)
components/ui       base components (button, card, badge, segmented control)
lib/analysis        scoring, KPIs and timing; pure functions with tests
lib/demo            demo personas and their generated 60-day history
lib/db              Drizzle schema (migrations in drizzle/)
lib/session         viewer and session handling
docs/               plan and setup guides
e2e/                Playwright tests
```
