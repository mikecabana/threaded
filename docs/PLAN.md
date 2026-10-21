# Threaded: Threads Growth Companion

Implementation and UI/UX plan. Working name: **Threaded** (after the repo).

> **What it does:** A SaaS app. Connect a Threads account, and Threaded reads your posts and
> insights, learns what works for *you*, and writes post suggestions aimed at one of three goals:
> **More Followers**, **More Views** or **More Engagement**. You can post or schedule a suggestion
> straight to Threads. You pick the AI model from our curated list and **pay per use**, or
> **bring your own Vercel AI Gateway key**.

**Decisions made so far**

| Question | Decision |
|---|---|
| Direct publishing and scheduling in v1? | **Yes.** It's in the MVP, so `threads_content_publish` is part of the first App Review submission. |
| Personal tool or product? | **Multi-tenant SaaS.** |
| Who picks AI models? | **Each user**, from a curated list priced per use. Users can also **BYOK** (their own Vercel AI Gateway key) and pay Vercel directly. |
| Do BYOK users pay us? | **Yes: a $5/month platform fee** covering sync, analytics and scheduling. |
| Markup, packs, trial | **1.5× default markup** (per model in the catalog), packs of **$5 / $20 / $50**, **$1 trial** (100 credits) once per Threads account. |
| Expiry and refunds | Credits, purchased or free, **never expire**. **Not refundable** except where the law requires; failed generations are refunded automatically. |
| Where is the business, and which currency? | **Quebec, Canada**, with a Canadian Stripe account. Prices stay in **USD** (AI costs are in USD); Stripe shows customers abroad a converted price at checkout. |
| Sales tax? | **Stripe Tax**: GST/HST for Canada plus QST for Quebec, tax-exclusive prices. |
| French? | Required for Quebec customers (Bill 96). **Before public launch** as its own phase (§13). Stripe already sends French receipts to French-speaking customers. |

All commercial values live in `lib/pricing.ts`, so marketing, legal and billing stay in sync.

---

## 1. Recommended stack

Everything below deploys to Vercel. Versions were current on npm in Oct 2026.

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, RSC, Server Actions, Route Handlers), React 19, TypeScript | Native to Vercel. Streaming RSC suits a data-heavy dashboard. |
| UI | **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) | Accessible primitives that you own and can restyle fully. |
| Motion | **Motion v14** (`motion/react`) | Layout and shared-element animations, gestures (drag-to-schedule, swipe deck), springs and scroll-linked effects. Load it with `LazyMotion` to keep the bundle small. |
| AI | **AI SDK 7** (`ai`) + **Vercel AI Gateway** (`@ai-sdk/gateway`) | Models are plain strings. `createGateway({ apiKey })` makes BYOK a few lines of code. Also gives per-generation cost lookup, fallbacks and spend reports. See §5. |
| Payments | **Stripe**: Checkout for credit top-ups, saved cards for auto-recharge, webhooks, Stripe Tax | Prepaid credits mean no surprise bills and no chasing failed payments. See §6. |
| Database | **Neon Postgres** (Vercel Marketplace) + **Drizzle ORM** over node-postgres with `attachDatabasePool` | Relational data, typed queries, real transactions for the credit ledger, and the same driver against a local Postgres in tests. Neon branches can back each preview deployment. |
| Cache / rate limit | **Upstash Redis** + `@upstash/ratelimit` (Marketplace) | Caches Threads API responses and the model catalog. Limits generations per user. Stores sync progress. |
| Background jobs | **Vercel Workflow** (durable steps, `sleep` until a date) + **Vercel Cron** | Runs the initial sync, the daily refresh, and **scheduled publishing** (a workflow sleeps until the post time). A cron sweeper catches anything missed. (Inngest is a drop-in alternative.) |
| Email | **Resend** | Alerts for failed scheduled posts, low balance and weekly digests. Stripe sends the receipts. |
| Charts | **Recharts 3** for standard charts. Custom SVG + Motion for sparklines, the heatmap and rings. | Recharts covers the boring parts. The hero visuals are hand-built so they animate the way we want. |
| Validation | **Zod 4** | Shared schemas for API input, AI structured output, webhooks and env. |
| Auth | **Threads OAuth is the login** for the MVP. Hand-rolled with route handlers, a DB sessions table and an httpOnly cookie. | Threads' token flow (short-lived, then long-lived, then refresh) doesn't fit generic OAuth libraries. The schema already separates *people* from *Threads profiles* (§8), so email/Google login can be added later for agencies. |
| Tooling | pnpm, Biome (lint + format), Vitest, Playwright, `next/font` (Geist) | |
| Observability | Vercel Analytics + Speed Insights, the AI Gateway dashboard, optional Sentry | |

---

## 2. Threads API: what we can and can't get

Base URL: `https://graph.threads.net/v1.0` (still the current version per Meta's changelog; `graph.threads.com` also works since June 2025). Everything below was checked against Meta's developer docs on Oct 21, 2026, through Meta's developer-tools MCP. The one item still marked ⚠ isn't covered by the Threads docs.

**Scopes requested at launch:** `threads_basic`, `threads_manage_insights`, `threads_content_publish`.
**Added later:** `threads_read_replies` and `threads_manage_replies` (reply analysis), `threads_keyword_search` (trend radar). The app's use case also offers `threads_delete`, `threads_manage_mentions`, `threads_location_tagging`, `threads_share_to_instagram` and **Threads Trending Topics**, a candidate data source for the Phase 3 trend radar.

**Read endpoints**

| Purpose | Call |
|---|---|
| Authorize | `https://threads.net/oauth/authorize?client_id&redirect_uri&scope&response_type=code&state` (still `threads.net`) |
| Exchange code for short-lived token (1h; code single-use, 1h) | `POST /oauth/access_token`. Strip the `#_` Meta appends to the code. Its `user_id` is a JSON number too big for JavaScript, so we take the id from `/me` instead. |
| Exchange for long-lived token (60 days) | `GET /access_token?grant_type=th_exchange_token` |
| Refresh token (60 days from refresh) | `GET /refresh_access_token?grant_type=th_refresh_token`. Only when the token is **at least 24 hours old** and unexpired. |
| Profile | `GET /me?fields=id,username,name,threads_profile_picture_url,threads_biography,is_verified` |
| Posts | `GET /me/threads?fields=id,text,timestamp,media_type,permalink,is_quote_post,topic_tag` with `since`/`until` and `limit` (max 100). Pages by the `after` cursor (the docs only promise cursors; we follow `paging.next` when present). |
| Post metrics | `GET /{media-id}/insights?metric=views,likes,replies,reposts,quotes,shares` (`views` and `shares` are labelled "in development"; reposts of others return nothing) |
| Account metrics | `GET /me/threads_insights?metric=views,likes,replies,reposts,quotes,clicks` with `since`/`until`: `views` is a daily series, `clicks` comes per link (`link_total_values`), the rest are totals. No data before **Apr 13, 2024** (we clamp). `followers_count` takes no date range, so it's a separate call. `follower_demographics` needs one `breakdown` (country, city, age or gender) and 100+ followers. |

**Publish endpoints**

| Purpose | Call |
|---|---|
| Create container | `POST /me/threads?media_type=TEXT&text=…`, optional `topic_tag` (1–50 characters, no `.` or `&`, one per post) and `reply_to_id` for series. |
| Check container status | `GET /{container-id}?fields=status,error_message`: `IN_PROGRESS`, `FINISHED`, `PUBLISHED`, `ERROR`, or `EXPIRED` (**unpublished containers expire after 24 hours**). Meta suggests waiting about 30s before publishing and checking at most once a minute for five minutes; the publish workflow follows that. |
| Publish | `POST /me/threads_publish?creation_id={container-id}` → media `id`. `auto_publish_text=true` on the create call would skip this step for text posts; we keep two steps because the docs don't say what the create call returns then. |
| Publishing quota | `GET /me/threads_publishing_limit`: 250 posts per rolling 24h (carousels count once). Replies (1,000), deletes (100) and location searches (500) have their own quotas. Checked before every publish. |
| Web intent (no-API fallback) | `https://www.threads.com/intent/post?text=…` (the host is now `threads.com`) |

**Limits and gaps the design has to work around**
- **The 500-character limit counts emojis by their UTF-8 bytes** ("Emojis are counted as the number of UTF-8 bytes"). The composer's counter and the AI post-processor both use `threadsLength()`, not `string.length`.
- **At most five links per post.** Since Dec 22, 2025, posts with more than five distinct URLs fail at container creation. The composer refuses them and the AI post-processor drops them.
- **No native scheduling.** The publishing endpoints have no publish-time parameter, and a container can't be parked as a draft: it expires after 24 hours unpublished. Meta's only advice is that apps which schedule should enforce the publishing limit themselves. So we schedule it ourselves (§7): the workflow wakes at the slot, re-checks `threads_publishing_limit`, creates the container, then publishes.
- **No per-post follower attribution.** `followers_count` is a current total only. We **snapshot it daily** to build a growth history, and estimate which posts drove follows by correlating daily follower changes with that day's posts. The UI labels this as an *estimate*.
- **No insights webhooks.** We poll with the daily cron, plus snapshots at +1h, +24h and +72h after we publish a post.
- **Permission grants last 90 days.** Refreshing the token extends them for public profiles only; private profiles must grant again every 90 days. (Phase 2: prompt a reconnect before it lapses.)
- **Call budget** is 4800 × impressions per 24h per app and user (impressions floored at 10), plus a CPU-time budget. Plenty for us.
- **Permalinks** may come back on `threads.com` or `threads.net`, and are omitted for posts flagged for copyright. Never parse the host.
- **App Review:** until Meta approves the insights and publish scopes, only **Threads testers** can connect (they accept the invite under Settings → Account → Website permissions). Submit with a screencast that shows the user explicitly confirming every post.
- **Required by Meta:** a *Deauthorize callback URL* and a *Data Deletion Requests URL*. Both receive a `signed_request` that we verify with HMAC-SHA256; the deletion callback answers `{ url, confirmation_code }`. ⚠ Meta's general app docs describe this, but the Threads docs don't say which of a Threads app's two secrets signs it. We use the Threads app secret; confirm with the first real callback.

---

## 3. Architecture

```
                         ┌──────────────────────── Vercel ────────────────────────────┐
 Browser (RSC + Motion)  │  Next.js 16                                                │
 ───────────────────────▶│   app/(app)/*          RSC pages, Server Actions           │
   streamed suggestions ◀│   /api/generate        reserve credits → streamText →      │──▶ Vercel AI Gateway ──▶ Anthropic / OpenAI / Google / …
                         │                        settle actual cost                  │      (platform key via OIDC, or the user's BYOK key)
                         │   /api/auth/threads    OAuth start/callback                │
                         │   /api/threads/*       uninstall + delete callbacks        │──▶ graph.threads.net (read + publish)
                         │   /api/stripe/webhook  credit purchases, auto-recharge     │◀── Stripe
                         │   /api/cron/*          daily refresh, publish sweeper      │
                         │   workflows/*          initial-sync, daily-refresh,        │──▶ Resend (alerts)
                         │                        build-dna, publish-post             │
                         └──────────┬──────────────────────────┬──────────────────────┘
                                    │                          │
                             Neon Postgres               Upstash Redis
                   (Drizzle; credit ledger, queue)   (cache, rate limit, progress)
```

**Request paths**
1. **Connect:** OAuth callback → create the user, workspace and profile → exchange for a long-lived token → encrypt and store it → grant trial credits (once per Threads account) → start `initial-sync` → `/onboarding/analyzing`.
2. **Initial sync** (durable steps): profile → paginate posts (≤365 days or ≤500 posts) → post insights in batches of 25 → account insights → deterministic stats → LLM post classification → Profile DNA. Progress goes to Redis, and the onboarding screen polls it every 1s, or streams it over SSE.
3. **Daily refresh** (cron at 06:00 UTC, one workflow per profile): refresh the token if it's >24h old and expires within 14 days → new posts plus metric snapshots → follower snapshot → update stats → re-run DNA weekly.
4. **Generate:** Studio → `/api/generate` → rate limit → **reserve credits** (skipped for BYOK) → build context → `streamText` with structured output → cards stream in → `onFinish` saves the suggestions and **settles the actual cost** (§6).
5. **Publish / schedule:** composer → `scheduled_posts` row → `publish-post` workflow sleeps until the scheduled time → checks → container → publish → snapshots (§7).

---

## 4. Analysis engine

### 4a. Deterministic layer (pure TypeScript, no LLM, fully unit-tested)

For each post (posts <72h old are marked *"still settling"* and left out of scoring):
- `engagementRate = (likes + replies + reposts + quotes) / views`
- `replyRate`, `amplificationRate = (reposts + quotes + shares) / views`
- `outperformance = views / median(views over the trailing 30 posts)`: the "2.4×" badge in the UI

**Robust z-scores.** Social metrics are heavy-tailed, so we use median and MAD, with `log1p` on views. A z-score here means how far a post sits above or below your typical post, in robust units.

**Aggregates:**
- Hour × weekday heatmap in the user's timezone. This also drives the "best slot" suggestions in the scheduler.
- Performance by format, topic, length bucket, has-question, has-link and topic tag
- Posting cadence vs. performance
- Follower delta per day

### 4b. Goal scoring (the "static goals")

Each goal is a fixed **playbook**: a scoring formula, the levers it pulls and prompt guidance.

| Goal | North-star metric | Post score (robust z) | Content levers the AI leans on |
|---|---|---|---|
| **More Views** | Views per post vs. your median | `0.7·z(log views) + 0.3·z(amplification)` | A scroll-stopping first line, timely and broad-appeal framing, topic tags, posting in your peak hours, quotable lines |
| **More Engagement** | Engagement rate, with replies weighted most | `0.5·z(replyRate) + 0.3·z(likeRate) + 0.2·z(quoteRate)` | Open questions, mild contrarian takes, "what's yours?" prompts, personal stories, low-friction ways to reply |
| **More Followers** | Daily follower growth | `0.4·z(amplification) + 0.3·z(log views) + 0.3·z(est. follow lift)` | Niche consistency, value-dense posts people repost, series ("part 2 tomorrow"), posts that make your profile worth following, occasional soft CTAs |

The **top 5 posts by the active goal's score** become few-shot examples. The **bottom 5** become the "avoid" patterns.

### 4c. LLM layer

- **Post classification** (fast model, 20 posts per call, `Output.object`): format, topic cluster, hook type, tone and stance. Cached per post and versioned.
- **Profile DNA** (mid-tier model, run weekly): voice descriptors, signature phrases, emoji and casing habits, typical length, core topics, *"what your audience rewards"* statements backed by real stats, and *"blind spots"*. Stored as versioned JSON and shown in the UI.

**Cold start** (<10 posts): personal stats are hidden. Generation relies on the goal playbook plus the bio. The UI shows a "confidence: low" chip.

---

## 5. AI generation and model configuration

### Why AI Gateway
- **Any model as a string** (`provider/model`), so switching is a setting, not a deploy.
- **BYOK is built in:** `createGateway({ apiKey: userKey })` routes a request through the user's own Gateway account, which pays for it.
- **Exact cost per call:** `gateway.getGenerationInfo({ id })` returns `totalCost` in USD. That's what we bill from.
- **Live catalog with pricing:** `gateway.getAvailableModels()` returns each model's pricing and type, so we can price the curated list.
- **Fallbacks and attribution:** `providerOptions.gateway` takes `models` (fallback list), `order`/`only` (provider routing), and `user`/`tags` (who and what to attribute spend to).
- **Spend reports:** `gateway.getSpendReport()` groups spend by user, tag or model. That feeds the margin dashboard.
- **Validating a BYOK key:** `createGateway({ apiKey }).getCredits()` confirms the key works and shows the user's remaining Gateway balance.

### Curated model catalog (DB-managed, not env)

A `model_catalog` table, edited from `/admin`, holds for each model:
- Gateway model id, label, provider
- Tier: Fast, Balanced or Best
- Which tasks it may run (`classify`, `dna`, `generate`, `critique`) and which tasks it's the default for
- Our markup, minimum charge and enabled flag

A nightly job syncs the table against `getAvailableModels()`. It refreshes base prices and auto-disables any model that has disappeared upstream.

**Which models a user sees:**
- **Credits users:** only enabled catalog models, each with a per-use price.
- **BYOK users:** the curated list by default, plus a "Show all Gateway models" toggle. Uncurated models carry an *untested* badge.

```ts
// lib/ai/models.ts
import { createGateway } from '@ai-sdk/gateway';

export type AiTask = 'classify' | 'dna' | 'generate' | 'critique';
const platformGateway = createGateway();          // OIDC on Vercel; AI_GATEWAY_API_KEY locally

export async function resolveModel(task: AiTask, ws: Workspace, userPick?: string) {
  const entry = await pickFromCatalog(task, ws, userPick);   // user's pick ∩ allowed, else the task default
  const byok = ws.billingMode === 'byok';
  const gw = byok ? createGateway({ apiKey: await decryptSecret(ws.byokKeyEnc) }) : platformGateway;
  return {
    model: gw(entry.modelId),
    pricing: byok ? null : entry,                  // null = nothing for us to charge
    providerOptions: {
      gateway: { models: sameTierFallbacks(entry), user: ws.id, tags: [`task:${task}`] },
    },
  };
}
```

Fallbacks stay **in the same price tier**, so a fallback never costs much more than the price the user saw. Billing uses the actual cost either way.

### Generation contract

```ts
// lib/ai/schemas.ts
export const Suggestion = z.object({
  text: z.string(),                 // validated with threadsLength() ≤ 500 after generation
  format: z.enum(['hot_take', 'question', 'story', 'list', 'tip', 'observation', 'series']),
  hook: z.string(),                 // why the first line stops the scroll
  rationale: z.string(),            // must cite the user's own data ("your questions get 3.1× replies")
  goalFit: z.number().min(0).max(100),
  topicTag: z.string().optional(),
  bestSlot: z.object({ weekday: z.number(), hour: z.number() }),
});
export const SuggestionBatch = z.object({ suggestions: z.array(Suggestion) });
```

```ts
// app/api/generate/route.ts (sketch)
const { model, pricing, providerOptions } = await resolveModel('generate', ws, body.modelId);
const hold = pricing ? await credits.reserve(ws, estimateMaxCost(pricing, ctx)) : null;  // 402 if short
const result = streamText({
  model,
  providerOptions,
  maxOutputTokens: 2_000,
  instructions: buildInstructions({ goal, dna, playbook }),    // AI SDK 7 renamed `system` to `instructions`
  prompt: buildPrompt({ exemplars, avoid, recentPosts, steer, count }),
  output: Output.object({ schema: SuggestionBatch }),
  onFinish: async ({ output, usage, providerMetadata }) => {
    const gen = await saveGeneration(ws, goal, output, usage, providerMetadata);
    if (hold) await credits.settle(hold, await actualCostUsd(providerMetadata, usage, pricing));
  },
  onError: () => hold && credits.release(hold),
});
return result.toTextStreamResponse();
// Client: experimental_useObject({ api: '/api/generate', schema: SuggestionBatch })
```

**How `actualCostUsd` works:** read the gateway generation id from `providerMetadata` and call `getGenerationInfo` for the exact cost. If that lookup fails, fall back to tokens × catalog price. An aborted stream settles on the partial usage.

**Prompt context:**
- Goal playbook
- Profile DNA (the voice guide)
- Top and bottom exemplars for the goal
- Last 20 posts (so suggestions don't repeat them)
- Timing stats
- User steer: topic, a "spice" level from 0 to 3, length, emoji on/off, banned words

**Post-processing:**
- Enforce the limit with `threadsLength()`, trimming or regenerating as needed
- Drop near-duplicates of past posts (trigram similarity)
- Optionally run a `critique` pass that reranks the drafts. It's billed like any other call.

**Prompts are versioned files** (`lib/ai/prompts/generate.v3.ts`). Each generation records `promptVersion`, `model` and `costUsd`.

### Feedback loop

Posts published through Threaded have a known `media_id`. For posts written elsewhere, the next sync fuzzy-matches them back to suggestions. Each one's performance against your baseline feeds the **Suggestion scorecard** and moves winning posts into the exemplar pool.

---

## 6. Billing: pay per use, or bring your own key

### Two billing modes per workspace

| AI action | **Credits** (default) | **BYOK** (their Vercel AI Gateway key) |
|---|---|---|
| Generate, Variant, Rerank (user-initiated) | **Charged per use** | Runs on their key. We charge nothing. |
| Post classification + Profile DNA (background) | Included. We absorb the cost on a fixed Fast-tier model. | Runs on their key |
| Nightly "Today's plays" (opt-in) | Charged per use | Runs on their key |
| Model choice | Curated list | Curated list + "all models" toggle |

### Credits

**How credits are priced:**
- 1 credit = $0.01 (a display unit, which also leaves room to change the markup later).
- The charge for a call is `ceil(costUsd × markup × 100)` credits, with a minimum of `minCredits`. Markup and minimum are set per model in the catalog.
- The UI shows an **estimate before** the call (catalog pricing × the rolling average tokens for that task) and the **actual charge after**.

**Our ledger is the source of truth.** Stripe only takes the money. Each generation needs an instant "can they afford this?" check, which Stripe's invoice-time billing credits can't provide.
- `wallets`: one row per workspace, holding `balance` and `reserved`.
- `credit_ledger`: append-only rows of kind `purchase | trial | reserve | settle | release | refund | adjust`. Each row is unique on `(kind, ref)` for idempotency.

**Spending is two-phase, so concurrent requests can't overdraw a wallet:**
1. **Reserve:** `UPDATE wallets SET balance = balance - :est, reserved = reserved + :est WHERE workspace_id = :id AND balance >= :est`. If no row updates, return `402` and show the top-up sheet. `:est` is the maximum possible cost, which is why `maxOutputTokens` is capped.
2. **Settle:** in one transaction, release the reservation, charge the actual amount and write the ledger rows.
3. **Release:** on error, return the whole reservation.

**No expiry:** credits never expire. They still arrive in **lots** (`credit_lots`, one per purchase or grant), which record what's left of each purchase, for refunds and for accounting (unspent credits are owed to the customer). A settled charge draws on the oldest lot first. Invariant: the lots' remaining credits equal `balance + reserved`.

**Buying credits:**
- **Top-ups:** hosted Stripe Checkout in one-time payment mode, packs of $5, $20 and $50 priced inline from `lib/pricing.ts`. The `checkout.session.completed` webhook **and** the return route (`/api/billing/return`) both fulfill the session: each re-reads it from Stripe and adds a `purchase` ledger row, idempotent on the session id.
- **Currency and tax:** prices are USD, but the Stripe account is Canadian, so every Stripe object that takes a currency gets `CURRENCY` explicitly (Stripe otherwise uses CAD, and an auto-recharge invoice then rejects its USD item). Stripe Tax (`STRIPE_AUTOMATIC_TAX=1`) adds GST/HST and QST on top of the price, based on the customer's address. Checkout collects that address, including when saving a card for auto-recharge.
- **Receipt language:** a new Stripe customer gets `preferred_locales` from the browser's language, so French speakers get French receipts and invoices. Checkout picks its language from the browser.
- **Auto-recharge:** "Add a card" is Checkout in setup mode; the card becomes the customer's default for invoices. When a charge leaves the balance under the threshold, a conditional UPDATE claims the workspace (so only one runs), and a Vercel Workflow run charges the card off-session through an invoice (create, add the pack, finalize, pay), so tax and receipts work like Checkout. Every Stripe call is keyed by the claim, so retries never charge twice. A decline turns auto-recharge off and shows an in-app banner (email comes with Resend). So does a missing address while Stripe Tax is on, which retrying can't fix; turning auto-recharge back on then goes through Checkout to collect it. A 402 also starts a recharge.
- **Trial:** about $1 of credits, granted once per **Threads account id**, which prevents farming new accounts for trials. That's enough for the onboarding analysis plus several Studio batches.

### BYOK
- **Setup:** Settings → Billing → "Use your own AI key". We validate it with `getCredits()` and show the user's Gateway balance.
- **Pricing:** a **$5/month platform fee**, a Stripe subscription started through Checkout. The workspace runs on its key only while the plan is live (active, trialing or past due) **and** a key is saved. Subscription webhooks re-read the subscription from Stripe, so out-of-order events are harmless.
- **Switching back** deletes the key and sets the plan to end with its period; adding a key before then resumes the same plan. When the plan ends for good, the key is deleted and an in-app notice explains the switch. Deleting the account cancels the plan immediately.
- **Storage:** encrypted with AES-256-GCM, bound to the workspace. Only the last 4 characters are ever displayed or logged.
- **Errors:** a rejected key or an empty Gateway balance shows a clear message in Studio with a one-click switch back to credits.
- **Rate limits still apply,** to protect our infrastructure and the user's Threads API quota.

### Admin (`/admin`, role-gated)
- Edit the catalog and markups
- A **margin view**: credit revenue vs. Gateway spend from `getSpendReport` grouped by user and model
- Manual credit adjustments and refunds (written as ledger `adjust` rows)
- Workspace lookup

---

## 7. Publishing and scheduling

**Composer flow:** a suggestion or a blank draft opens the composer sheet. It has a live Threads preview, a byte-accurate counter and an optional topic tag. Then:
- **Post now:** a confirmation step, then publish immediately.
- **Schedule:** pick a time from best-slot chips ("Tue 7pm · your #1 slot") or a custom time in the profile's timezone.

**`publishPost` workflow** (Vercel Workflow, one run per *version* of a `scheduled_posts` row; `workflows/publish.ts`):
1. `sleep` until `scheduled_for`. Every edit, reschedule, cancel or retry bumps the row's `version` and starts a fresh run; a run whose version no longer matches stops when it wakes, so moving a post earlier or later just works.
2. Claim the row (`scheduled` → `publishing`, conditional on the version), so only one run can publish it.
3. Pre-flight: the token is valid (refreshed if due), the text still fits, and quota remains (`threads_publishing_limit`).
4. Create the container (stored as `container_id`), poll its status every 5s for up to a minute, then publish (stored as `media_id`, checked before publishing again).
5. Record it: `published_at`, permalink, a `posts` row marked `via_threaded`, and the idea marked `posted`. Snapshots at +1h, +24h and +72h feed the scorecard.
6. Failures the user can act on (reconnect, quota, a container Threads rejects) end the attempt with a message written for them; transient errors retry per step (rate limits wait 10 minutes). The post is then `failed`, with Retry, Edit and Remove in the Queue and a banner across the app. Email alerts come with Resend.

**Safety nets:**
- A cron **sweeper** (`/api/cron/publish`, every 5 minutes, and also from the daily cron) gives a new run to any `scheduled` row more than 5 minutes overdue.
- A row stuck in `publishing` for 30 minutes without a `media_id` might or might not have gone out, so rather than risk posting twice it's marked `failed` with a note to check Threads before retrying.
- A row that has a `media_id` is always recorded as published, even if a later step failed.
- Nothing is ever posted without an explicit user action: "Post now" has a confirmation step, and there's no autopilot.

**Series (Phase 2):** a multi-part suggestion publishes as a chain, each part using `reply_to_id` to reply to the previous one.

---

## 8. Data model (Drizzle, Postgres)

```
-- tenancy
users            id, threads_user_id (unique; login identity in MVP), email (asked in onboarding; Threads OAuth doesn't provide one), created_at
workspaces       id, name, billing_mode (credits|byok), byok_key_enc, byok_key_last4, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_period_end, subscription_cancel_at_period_end, auto_recharge jsonb, auto_recharge_pending_at, billing_notice jsonb, created_at
memberships      user_id, workspace_id, role (owner|member)
threads_profiles id (threads user id), workspace_id, username, name, avatar_url, bio, is_verified, timezone, active_goal
threads_tokens   profile_id, access_token_enc, expires_at, scopes[], last_refreshed_at
sessions         id (random 256-bit), user_id, expires_at, user_agent

-- content & analytics (keyed by profile)
posts            id (threads media id), profile_id, text, media_type, permalink, posted_at, is_quote, topic_tag, length, has_link, has_question, via_threaded
post_metrics     post_id, captured_at, views, likes, replies, reposts, quotes, shares   ← snapshots, so we can see how fast a post picked up
post_features    post_id, version, format, topic, hook_type, tone, model
account_daily    profile_id, date, views, likes, replies, reposts, quotes, clicks, followers_count
demographics     profile_id, captured_at, breakdown (country|city|age|gender), data jsonb
profile_dna      profile_id, version, data jsonb, model, generated_at

-- AI
model_catalog    model_id, label, provider, tier, tasks[], default_for[], markup, min_credits, input_price, output_price, enabled, synced_at
user_settings    user_id, model_picks jsonb (per task), voice_prefs jsonb (emoji, casing, banned_words, spice_default)
generations      id, profile_id, goal, model, prompt_version, steer jsonb, usage jsonb, gateway_generation_id, cost_usd, credits_charged, billing_mode, status, dropped, error, created_at
suggestions      id, generation_id, text, format, hook, rationale, goal_fit, best_slot, status (new|saved|dismissed|scheduled|posted), posted_media_id, perf_vs_baseline

-- billing
wallets          workspace_id, balance, reserved
credit_ledger    id, workspace_id, delta, kind, ref, generation_id, created_at   unique(kind, ref)
credit_lots      id, workspace_id, ledger_id, amount, remaining, created_at   ← spent oldest first; never expire

-- publishing & jobs
scheduled_posts  id, profile_id, suggestion_id, text, topic_tag, scheduled_for (utc), status (scheduled|publishing|published|failed|canceled), version, container_id, media_id, permalink, attempts, last_error, workflow_run_id, publishing_at, published_at
sync_runs        id, profile_id, kind, status, step, stats jsonb, error, started_at, finished_at
```

**Security:**
- Threads tokens and BYOK keys are encrypted with AES-256-GCM. Each ciphertext is prefixed with a key id, so `SECRETS_ENC_KEY` can be rotated.
- Secret-handling modules import `server-only`, so they can't end up in client bundles.
- The OAuth `state` is kept in a signed, short-lived cookie.
- The Stripe webhook verifies its signature, and its handlers are idempotent on the event id.
- Disconnecting deletes the profile's tokens. The data-deletion callback deletes the profile's data and returns the confirmation-code URL Meta expects.
- Ledger rows are retained for accounting. Wallets stay with the workspace, not the profile.

---

## 9. UI/UX design

### 9a. Design language: "Monochrome + one living accent"

Threads itself is stark black and white, so Threaded feels native to it.

**Base:**
- Dark-first, with a light theme via `next-themes`
- Near-black `#0A0A0B` background, surfaces at `#141416`, 1px borders at 8% white
- Subtle grain texture

**Goal accent system.** The active goal re-themes the whole app. The accent is a registered CSS custom property (`@property --accent { syntax: '<color>' }`), so it **smoothly morphs** when the goal changes.

| Goal | Accent | Feel |
|---|---|---|
| Followers | Violet `oklch(0.68 0.2 295)` | Community |
| Views | Electric cyan `oklch(0.8 0.14 220)` | Reach |
| Engagement | Coral `oklch(0.72 0.18 20)` | Conversation |

A soft "aurora" gradient behind page headers takes on the accent color.

**Type:** Geist Sans for UI, Geist Mono for every number and credit amount (tabular figures), and Instrument Serif italic for the big DNA-reveal headlines.

**Signature motif: the thread line.** Threads connects posts with a vertical line. We reuse it as a progress line, a connector between onboarding steps, in post previews, and as the timeline in the queue. It is always drawn in with SVG `pathLength`.

### 9b. Information architecture

```
/                       Landing, pricing, "Try a demo account"
/connect                What we read & post, and why (trust screen) → Threads OAuth
/onboarding/analyzing   The Read (live sync progress)
/onboarding/dna         Your Profile DNA reveal
/onboarding/goal        Pick your goal (+ email for alerts)
/home                   Today: goal progress, 3 ready-to-post plays, next scheduled post
/studio                 Generate & refine suggestions
/queue                  Saved · Scheduled (calendar) · Posted (scorecard)
/insights               Deep analytics
/settings               Models · Voice · Billing (credits / BYOK) · Account & data
/admin                  Catalog, markups, margin, workspaces (staff only)
```

Navigation is a bottom tab bar on mobile (Home, Studio, Queue, Insights; Settings via the avatar) and a collapsible left rail on desktop. **A credits pill sits in the header**, or a "Your key" badge in BYOK mode. A PWA manifest lets people install it next to the Threads app.

### 9c. Key screens

**Landing.**
- Scroll-linked hero (`useScroll`): sample post cards float in, and a thread line draws through them, linking them into a chain.
- A pricing section explains "pay per use or bring your key".
- Two CTAs: "Connect Threads" and "Try a demo account".

**The Read (onboarding analysis): the first "wow".** Progress is real, driven by the workflow's steps rather than a fake timer.
```
 ●  Reading your posts .................. 147  ✓      ← counters tick up (useSpring)
 │
 ●  Measuring what landed ............... 147/147    ← post cards rain in, then sort into topic clusters (layout animations)
 │
 ◐  Finding your voice
 │
 ○  Mapping your best hours
```

**Profile DNA reveal.** A stack of cards revealed one by one with a spring stagger. Each card is a claim backed by a number:
- *"You're at your best being direct."* Hot takes get 2.8× your median views.
- Topic bubbles, sized by performance, each with a confidence chip.
- A best-hours heatmap whose cells cascade in diagonally.
- One card for *"Blind spot"*.

**Goal picker.** Three tall cards, each showing the goal's north-star metric and *your* baseline. Selecting one expands it to full screen via `layoutId`, the accent color morphs, and the card shrinks into the header goal pill. That pill stays on every page and is the goal switcher.

**Home ("Today"):**
```
┌──────────────────────────────────────────────────────────────────┐
│ ◉ More Engagement ▾      Next post: Tue 7pm ⏱ 3h12m     ◈ 482 cr │
├──────────────┬──────────────┬──────────────┬─────────────────────┤
│ Eng. rate    │ Replies/post │ Views (7d)   │ Followers           │  ← count-up + sparkline draw-in
│ 4.8% ▲0.6    │ 12.3 ▲3.1    │ 18.2k ▼4%    │ 2,341 ▲38           │
├──────────────┴──────────────┴──────────────┴─────────────────────┤
│ Today's plays                                       [Open Studio]│
│ ┌─ card ─┐ ┌─ card ─┐ ┌─ card ─┐                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Studio: the core loop.**
```
┌── Controls ──────────────┐  ┌── Suggestions (stream in) ────────────────────────┐
│ Goal  [Fol|View|●Eng]    │  │ ┌──────────────────────────────┐  goal fit ◔ 86   │
│ Topic [ indie hacking ]  │  │ │ (avatar) @you                │                  │
│ Spice ○──●──○──○         │  │ │ Unpopular opinion: your MVP  │  hook · question │
│ Format [any ▾]           │  │ │ doesn't need auth. ▍         │  best: Tue 7pm   │
│ Count  [ 5 ]             │  │ └──────────────────────────────┘                  │
│ Model  Balanced · ≈6 cr ▾│  │ Why: your questions get 3.1× replies…  ▸          │
│ [ Generate ✦  ≈6 cr ]    │  │ [Copy] [Edit] [Variant] [Save] [Schedule] [Post]  │
└──────────────────────────┘  └───────────────────────────────────────────────────┘
```
- **The model picker** groups models by tier and shows a per-use estimate. In BYOK mode it shows "Your key" instead of prices.
- **The Generate button shows the estimated cost.** After the stream finishes, the header pill ticks down with a spring, and a small "−6" floats up and fades.
- **Cards are real streaming.** A skeleton card morphs into the content card, text appears as tokens arrive, and the goal-fit ring fills when the card completes.
- **Each card is a Threads-native preview.** It shows the avatar, the thread line and a byte-accurate 500 counter ring.
- **Edit** opens the composer via shared `layoutId`. **Variant** regenerates that one card, and its text crossfades.
- **Schedule** flies the card (shared element) into the Queue tab icon.
- **Mobile triage:** a swipe deck (`drag="x"`). Right saves, left dismisses, and the card tilts with the drag.
- **Insufficient credits** slide up a top-up sheet with Stripe packs. After paying, the user returns to the same Studio state.

**Queue.**
- **Scheduled:** a week calendar where slots are shaded by your best-hours heatmap.
  - Drag a saved card onto a slot to schedule it (Motion drag + drop zones, with a spring snap).
  - Keyboard alternative: a "Schedule…" menu that suggests slots.
  - On mobile it's a vertical timeline on the thread line.
- **Saved:** a list of saved suggestions.
- **Posted:** the scorecard. Each published suggestion shows a +1h/+24h/+72h performance chip against your baseline.
- **Failed posts** show inline with Retry and Edit.

**Insights:**
- Views over time and follower growth (annotated with your posts, highlighting those published via Threaded)
- The heatmap
- A format × topic matrix
- A sortable post table with outperformance badges
- Demographics (once eligible)
- Every chart has a plain-English "what this means" line.

**Settings → Models:** a dropdown per task (Generate, Rerank; background tasks are shown only in BYOK mode). Each model shows its tier, provider, per-use estimate and context window. A "Test this model" button generates one suggestion side by side with your current model, and it's billed. "Reset to defaults" restores the catalog defaults.

**Settings → Billing:**
- The balance, with a count-up animation
- Buy credits (packs) and auto-recharge
- Usage history by action and model, with estimated vs. actual cost
- A **billing mode switch** (Credits ↔ BYOK) with the key field, validation state and the user's Gateway balance

### 9d. Motion system

- **Springs, not easing curves:**
  - UI uses `{ type: 'spring', stiffness: 400, damping: 32 }`
  - Big reveals use `{ stiffness: 120, damping: 20 }`
  - Interactions finish in under 300ms
- **Choreography only at the magic moments:** The Read, the DNA reveal, Generate, the goal switch, and the moment a post is sent (the thread line draws into a checkmark). Everything else stays calm.
- **Building blocks** (`components/motion/`):
  - `<CountUp>`, `<DrawPath>` (the thread line), `<StaggerList>`, `<Reveal>`, `<TiltCard>`
  - `<SwipeDeck>`, `<DropSlot>`, `<FlyTo>` (shared-element "send to queue"), `<CreditDelta>`, `<AccentAurora>`, `<GoalPill layoutId>`
- **Page transitions:** enter animations in `template.tsx`. Detail views use shared-element morphs.
- **Performance:**
  - `LazyMotion` + `m.*` with `domAnimation` by default; load `domMax` only where layout or drag is used
  - Animate only transform and opacity
- **Accessibility:**
  - `<MotionConfig reducedMotion="user">`
  - Streamed suggestions announce through `aria-live="polite"`
  - Keyboard alternatives for swipe and drag-to-schedule
  - Visible focus rings in the accent color

---

## 10. Project structure

```
app/
  (marketing)/page.tsx, pricing/, connect/, legal/{terms,privacy}/
  (app)/layout.tsx                      session guard, nav, goal pill, credits pill, accent theme
  (app)/onboarding/{analyzing,dna,goal}/page.tsx
  (app)/{home,studio,queue,insights}/page.tsx
  (app)/settings/{models,voice,billing,account}/page.tsx
  (admin)/admin/{catalog,margin,workspaces}/page.tsx
  api/auth/threads/{start,callback}/route.ts
  api/threads/{uninstall,delete}/route.ts
  api/generate/route.ts
  api/stripe/{checkout,webhook}/route.ts
  api/sync/[runId]/route.ts             progress (SSE or poll)
  api/cron/{daily,publish-sweeper,catalog-sync}/route.ts
workflows/{initial-sync,daily-refresh,build-dna,publish-post}.ts
lib/
  threads/{client,oauth,publish,length,types}.ts, threads/fixtures/
  analysis/{metrics,scoring,timing,aggregates}.ts      pure functions
  ai/{models,catalog,schemas,generate,classify,dna,cost}.ts, ai/prompts/*.vN.ts
  billing/{wallet,ledger,stripe,pricing}.ts
  auth/{session,crypto,signed-request}.ts
  db/{schema,index}.ts
  email/{templates,send}.ts
components/{ui,motion,charts,studio,queue,billing,dna,home}/
evals/                                  prompt and model eval harness
```

---

## 11. Quality, demo mode and evals

- **Demo mode.** A "Try a demo account" button loads realistic fixture data (3 personas: small creator, mid-size niche account, large brand) with no Meta login. Generation runs against a small free demo allowance. Publishing is simulated. It's the default on preview deployments, unblocks development before App Review, and gives Meta reviewers a working flow.
- **Unit tests (Vitest):**
  - Analysis and scoring
  - `threadsLength()`
  - **The credit ledger**: concurrent reserves can't overdraw, settle and release math, webhook idempotency
  - Publish workflow state transitions
  - Token refresh timing and signed-request verification
- **E2E (Playwright, against demo mode, Stripe test mode):** onboarding → goal → generate (credits deducted) → schedule → simulated publish; top-up via Stripe test card; switch to BYOK.
- **Prompt/model evals (`pnpm eval`):** run the fixture personas through `generate`, then have a judge model score voice match, goal fit, length compliance and repetition. Record cost per batch too. Run this before adding a model to the catalog, and use it to set that model's tier and default status.
- **CI:** typecheck, Biome, Vitest and Playwright on every PR. Vercel previews come with a Neon branch.

---

## 12. Environment

```
THREADS_APP_ID, THREADS_APP_SECRET
THREADS_REDIRECT_URI     # local only; on Vercel derived from VERCEL_PROJECT_PRODUCTION_URL
APP_URL                  # optional override for the production URL
PREVIEW_ORIGINS          # previews allowed to sign in via production's callback (relay)
SECRETS_ENC_KEY          # 32-byte base64; encrypts Threads tokens + BYOK keys (key-id prefixed for rotation)
SESSION_SECRET
DATABASE_URL             # Neon (Marketplace injects)
KV_REST_API_URL, KV_REST_API_TOKEN          # Upstash (Marketplace injects)
AI_GATEWAY_API_KEY       # local only; production uses Vercel OIDC
AI_DEFAULT_MODEL_*       # last-resort defaults if the catalog is empty
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
STRIPE_AUTOMATIC_TAX     # 1 = Stripe Tax on top-ups, auto-recharge and the BYOK plan
RESEND_API_KEY
CRON_SECRET
DEMO_MODE                # 1 = demo accounts only (e.g. a public preview)
```

Threads OAuth needs exact HTTPS redirect URIs. Register production plus one fixed dev alias (or an ngrok/cloudflared tunnel). Use demo mode on previews.

---

## 13. Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **0: Setup** | Meta app (Threads use case, testers, callbacks); **submit App Review early for basic + insights + publish**; Vercel + Neon + Upstash + AI Gateway + Stripe (test) + Resend; scaffold, design tokens, motion primitives, demo fixtures; Terms + Privacy pages | Demo account renders the Home shell |
| **1: MVP** | OAuth + workspaces; initial sync; deterministic stats; goal picker; Studio with streaming; **curated catalog + model picker**; **credits wallet** (trial, Checkout top-ups, reserve/settle, auto-recharge); **BYOK** ($5/month plan); **post now + schedule + Queue**; rate limits | A tester connects, buys credits (test mode), generates, and has a scheduled post publish on time |
| **2: Intelligence + polish** | LLM classification + Profile DNA, The Read + DNA reveal choreography, Insights page, daily cron (snapshots, token refresh), scorecard, evals harness, **admin margin dashboard**, **series via `reply_to_id`** | Daily loop runs unattended; margins visible per model |
| **Launch: Quebec readiness** | **French** (Bill 96): site, app, Terms, Privacy and emails, with `fr-CA` as a first-class locale and AI output in the user's language; the Law 25 privacy items; live Stripe Tax; the lawyer's changes (SETUP.md §5) | Public sign-ups open, and everything a Quebec customer sees exists in French |
| **3: Grow** | Keyword-search trend radar, reply analysis, A/B variants, opt-in nightly "Today's plays", weekly digest email | |
| **4: Agencies** | Multiple Threads profiles per workspace, team seats, email/Google login, optional subscription plans | |

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| App Review delays or rejection (bigger scope with publishing) | Submit in Phase 0 with a clear screencast where the user explicitly confirms every post. Demo mode and tester accounts in the meantime. |
| Losing money on AI calls | Charge actual Gateway cost × markup. Reserve the maximum cost up front. Same-tier fallbacks only. Margin dashboard. Background tasks pinned to a Fast-tier model. |
| Trial abuse | One trial per Threads account id. Rate limits. Small trial amount. |
| Leaked BYOK keys | AES-GCM encryption, `server-only` modules, never logged, only the last 4 characters displayed, deleted on switch or disconnect |
| A scheduled post fails or doesn't fire | Durable workflow + 5-minute sweeper + retries + email and in-app alerts. Idempotent container/publish steps. |
| No per-post follower data | Daily snapshots + correlation, labeled "estimated". The Followers goal leans on amplification as its proxy. |
| Generic "AI-sounding" posts | Few-shot from the user's own top posts, a DNA voice guide, banned-phrase list, critique rerank, evals before any model is added to the catalog |
| Small or new accounts | Cold-start mode: playbook-led suggestions plus a low-confidence chip. Personal stats unlock at 10 or more posts. |
| Token expiry / private profiles | Daily refresh. Grants on private profiles can't be extended past 90 days, so prompt a reconnect 7 days before. Scheduled posts pre-flight the token and alert early if it's invalid. |
| Threads API changes | One typed client module, response validation with Zod, and fixtures in contract tests |
| Quebec rules: French, privacy (Law 25), consumer protection | French before public launch (§13). Law 25 checklist and a lawyer's review of the Terms and the plan (SETUP.md §5). Credits never expire. |

---

## 15. Decisions log

All open decisions are resolved; see the table at the top. Revisit the markup, packs and trial size once the margin dashboard has real data.

## 16. Phase 0 status

**Done in code:**
- Next.js 16 scaffold with Cache Components, Tailwind 4, Biome, Vitest, Playwright and a CI workflow
- Design tokens: dark/light themes, a goal accent that morphs on switch, set before first paint
- Motion building blocks: `CountUp`, `ThreadLine`/`DrawPath`, `Reveal`/`Stagger`, `TiltCard`, `AccentAurora`, `Sparkline`, `GoalFitRing`, and a `Segmented` control built on native radios
- Landing, connect (permission explainer), and draft Terms and Privacy pages
- App shell with rail and bottom-tab navigation, goal switcher, credits pill and demo banner
- Home screen: goal-specific KPIs, "Today's plays", best time to post, up next, and what's working
- Three demo personas with a seeded, always-current 60-day history
- Analysis core: robust z-scores, goal scoring, outperformance, KPIs, best hour, Threads length rule
- Drizzle schema for everything in §8, with the initial migration verified against Postgres 16

## 17. Phase 1 progress

**1a, accounts (done):**
- Threads OAuth with a signed state cookie
- Encrypted tokens (AES-256-GCM keyring, AAD-bound)
- DB sessions storing only token hashes
- Transactional account provisioning, with a trial granted once per Threads account
- Meta uninstall and data-deletion callbacks, plus a deletion status page
- The viewer is now either a demo or a real account

**1b, sync (done):**
- `initialSync` and `refreshSync` run as Vercel Workflow runs. Steps take only ids, so tokens and post text never enter the event log, and auth and rate-limit errors map to fatal or delayed retries.
- The first sync starts at sign-in, and Home shows live progress.
- A daily cron runs refreshes, and Settings has a throttled "Sync now".
- Follower counts are snapshotted, never backdated.

**1c, AI generation (done):**
- A model catalog in the database, seeded with Claude Haiku/Sonnet/Opus 5.5. A nightly sync takes live prices from `gateway.getAvailableModels()` and disables models the Gateway drops. Markups are never overwritten.
- Users pick a model per task; fallbacks stay within the same price tier. Every call sets `disallowPromptTraining`, matching the privacy policy.
- The prompt is built from the author's own data: voice stats, their five best and three weakest posts for the goal, recent posts to avoid, best hours, and only insights the numbers support (prompt `generate.v1`).
- Generations stream structured output into Studio. Post-processing enforces the Threads length rule and drops near-duplicates of past posts (character-trigram similarity ≥ 0.6).
- Billing reserves the worst case, then charges the Gateway's reported cost × markup, and **only if at least one idea comes back**. Failures, cancellations and fully-dropped batches are refunded. The wallet is race-safe (tested with concurrent reserves and a settle racing a release).
- Rate limit: 10 generations per 10 minutes per profile, counted in Postgres. Upstash isn't needed yet.
- Studio: tone, format, count, model with a per-use estimate, ideas that write themselves in, save/dismiss, and saved ideas. Home's "Today's plays" shows real accounts' best recent ideas. The demo streams sample ideas for free.

**1d, billing (done):**
- Settings → Billing: balance, credit packs, auto-recharge, own key, and an activity list. The header pill opens it; Studio's out-of-credits message links to it.
- Stripe via hosted Checkout and the billing portal only, priced inline from `lib/pricing.ts`, so there's nothing to set up in the dashboard but the webhook and portal. Fulfillment re-reads every object from Stripe and runs from both the webhook and the return route; ledger refs make it idempotent.
- Credits arrive in lots, one per purchase or grant, spent oldest first. The migration backfills existing balances as one lot. (They first expired after 12 months; that was dropped: credits never expire.)
- Auto-recharge saves a card with setup-mode Checkout, then a workflow run charges it off-session through an invoice when a charge (or a 402) leaves the balance under the threshold. One claim per workspace, Stripe idempotency keys per claim, and a decline turns it off with an in-app banner.
- BYOK: keys are checked with `getCredits()`, stored encrypted and bound to the workspace; the $5/month plan is a Checkout subscription mirrored from webhooks. Switching back deletes the key and ends the plan with its period; a lapsed plan falls back to credits with a notice; Meta's data-deletion callback cancels the plan.
- Studio shows actionable errors for a rejected key or an empty Gateway balance, with a one-click switch back to credits.
- Tested against `e2e/mock-billing.mjs`, a stateful mock of the Stripe API, hosted Checkout, signed webhooks and the Gateway credits endpoint: integration tests for top-ups, webhooks, auto-recharge (paid and declined), lots, and the BYOK plan lifecycle; end-to-end tests that save a card and watch the recharge workflow top up, buy a pack, switch to a key and back, and show and dismiss a billing notice.
- Not yet: emails for failed recharges and lapsed plans (needs Resend; planned with 1e's failure emails), the admin margin view (Phase 2), the "all Gateway models" toggle for BYOK users.

**1e, publishing (done):**
- A composer (dialog on desktop, bottom sheet on phones) with a live Threads preview, a length ring that counts emoji the Threads way, and an optional topic tag. **Schedule** offers the idea's own slot and the author's best hours as chips ("Today 7 PM · your best hour"), or any time in the profile's timezone; **Post now** asks for confirmation first.
- It opens from Studio's idea cards, saved ideas, Home's plays and the Queue. "Post now" follows the run until the post is live and links to it.
- Queue: a week strip, the scheduled timeline grouped by day (edit, post now, cancel), "Needs attention" for failures (retry, edit, remove), saved ideas ready to schedule, and recently posted with their latest numbers. Home's "Up next" counts down to the next post. The demo shows a sample queue.
- Durable `publishPost` runs with versioning, a single-publisher claim, idempotent container and publish steps, user-facing failure messages, and the sweeper (§7).
- Tests: integration tests drive every step against a fake Graph API (scheduling rules, publish once, container polling and errors, quota, revoked tokens, edits superseding runs, cancel, retry, the sweeper); end-to-end tests schedule, edit and cancel a saved idea, post now through the mock Meta server, show a failed post until it's removed, and rescue an overdue post with the sweeper.
- Not yet: drag-and-drop onto a week calendar (the slot chips cover it for now), failure emails (needs Resend and the user's email), series via `reply_to_id` (Phase 2).

**Stripe sandbox check (Canadian account, Quebec):** Stripe's MCP connector was used to send the app's own Checkout, portal and invoice calls to the real sandbox. The connector can't pay invoices, so the final charge is still only tested against the mock. Checkout in all three modes and the portal work as written. Two bugs the mock had hidden are fixed:
- Auto-recharge invoices were created without a currency, so on a Canadian account they came out in CAD and refused the USD pack. Every recharge would have failed and been retried as if Stripe were down. The invoice now states USD.
- With Stripe Tax on, Stripe won't finalize an invoice for a customer without an address, and saving a card didn't collect one. Card Checkout now asks for the address when tax is on, and a recharge that still lacks one stops with a notice instead of retrying.
- The mock now behaves the same way (CAD by default, no mixed currencies, no taxed invoice without an address), and integration tests cover both cases. The sandbox has GST/HST and QST registrations, and its default portal configuration already matches what Threaded needs.

**Phase 1 is feature-complete.** Remaining before testers: the external setup below, then a pass against the real services (Meta's docs are checked; see §2).

**Waiting on you** (see `docs/SETUP.md`):
- Meta app and App Review submission
- Vercel project with Neon, Upstash and AI Gateway
- Stripe: the head office address in Tax settings, a default product tax code (with your accountant), then the secret key and webhook; and a Resend account
- Legal review of the Terms and Privacy drafts by a Quebec lawyer, including the items in SETUP.md §5
