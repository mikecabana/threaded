# Threaded: Threads Growth Companion

Implementation and UI/UX plan. Working name: **Threaded** (after the repo).

> **What it does:** A SaaS app. Connect a Threads account, and Threaded reads your posts and
> insights, learns what works for *you*, and writes post suggestions aimed at one of three goals:
> **More Followers**, **More Views** or **More Engagement**. You can post or schedule a suggestion
> straight to Threads. You pick the AI model from our curated list and **pay per use**, or take
> the **Monthly plan**. Agencies get in touch for a plan that fits.

**Decisions made so far**

| Question | Decision |
|---|---|
| Direct publishing and scheduling in v1? | **Yes.** It's in the MVP, so `threads_content_publish` is part of the first App Review submission. |
| Personal tool or product? | **Multi-tenant SaaS.** |
| Who picks AI models? | **Each user**, from a curated list priced per use. |
| Bring your own key? | **No longer offered to new customers** (Oct 29, 2026). It asked creators to open a Vercel account and paste an AI Gateway key, which put our vendor in the contract, and the Monthly plan now serves heavy users. The pricing page offers an **Agency** tier instead: no price, and a "Get in touch" email to work out what agencies need. Workspaces that have used their own key keep it, at **$5/month** (§6). |
| Markup, packs, trial | **2× default markup** (per model in the catalog; raised from 1.5× before launch, see §15), packs of **$5 / $20 / $50** for **500 / 2,200 / 5,750 credits** (bigger packs carry a bonus), **$1 trial** (100 credits) once per Threads account. |
| A subscription for credits? | **The Monthly plan: $9/month for 1,200 credits** (133 per dollar, against 100–115 for packs), added with each paid invoice. They never expire either. One plan at a time with BYOK. |
| Expiry and refunds | Credits, purchased or free, **never expire**. **Not refundable** except where the law requires; failed generations are refunded automatically. |
| Where is the business, and which currency? | **Quebec, Canada**, with a Canadian Stripe account. Prices stay in **USD** (AI costs are in USD); Stripe shows customers abroad a converted price at checkout. |
| Sales tax? | **Stripe Tax**: GST/HST for Canada plus QST for Quebec, tax-exclusive prices. |
| French? | Required for Quebec customers (Bill 96). **Pinned until after launch** (Oct 27, 2026), then first on the list (§13); worth raising with the lawyer. Stripe already sends French receipts to French-speaking customers. |

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
**Opt-in:** `threads_keyword_search`, asked for once `THREADS_KEYWORD_SEARCH=1` (Studio's topic research, §5; later the trend radar). Threads refuses a sign-in that asks for a permission the app hasn't added, hence the switch.
**Added later:** `threads_read_replies` and `threads_manage_replies` (reply analysis). The app's use case also offers `threads_delete`, `threads_manage_mentions`, `threads_location_tagging`, `threads_share_to_instagram` and **Threads Trending Topics**, a candidate data source for the Phase 3 trend radar.

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
| Keyword search | `GET /keyword_search?q&search_type=TOP\|RECENT&search_mode=KEYWORD\|TAG&since&until&limit` (max 100) with `fields=id,text,media_type,permalink,timestamp,username,is_reply`. Public posts, but no engagement numbers for other people's. 2,200 queries per user per rolling 24 hours, across apps (searches that find nothing don't count). Until App Review approves `threads_keyword_search`, it only finds the user's own posts. |

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

- **Post classification** (Jev, `typesafe-ai/jev`, a decision model through AI Gateway): format, topic, hook type and tone (stance is covered by tone, e.g. "contrarian"), as multiple-choice questions about one post at a time, ten posts in parallel. Jev can't invent labels, so a fast model first names the author's topics (4 to 12, stored on the profile) and Jev files each post under one of them or "other". The list is refreshed at most weekly when a quarter of recent posts fit none of its topics; existing topics keep their names, and the "other" posts are filed again. Answers Jev is unsure of (below 0.4 on format or topic), and any Jev outage, fall back to the fast model through the Gateway. Labels are stored per post and classifier version (v1 was the fast model, 20 posts per call), so each post is classified once per version.
- **Performance facts** (deterministic, `lib/analysis/facts.ts`): how each format, topic, hook, tone and trait (question, length, link, media, emoji) performs against the author's median, on views, replies, engagement and reposts. A group needs 3+ settled posts on each side and a 1.3× difference either way.
- **Profile DNA** (mid-tier model, run weekly): voice descriptors, signature phrases, writing habits, ghostwriter rules, core topics, *"what your audience rewards"* and *"blind spots"*. The model never writes a number: each claim cites a fact by id, and the stored claim carries our measurement. Signature phrases are kept only if they appear in at least two posts. Stored as versioned JSON (`profile_dna`, one row per version).

**Cold start** (<10 posts): personal stats are hidden. Generation relies on the goal playbook plus the bio. The UI shows a "confidence: low" chip.

---

## 5. AI generation and model configuration

### Why AI Gateway
- **Any model as a string** (`provider/model`), so switching is a setting, not a deploy.
- **BYOK is built in:** `createGateway({ apiKey: userKey })` routes a request through the user's own Gateway account, which pays for it.
- **Exact cost per call:** every response carries the Gateway's cost in USD as `providerMetadata.gateway.cost`. That's what we bill from. (`gateway.getGenerationInfo({ id })` has it too, but not until a moment after the call: asked straight away it answers "usage event not found".)
- **Live catalog with pricing:** `gateway.getAvailableModels()` returns each model's pricing and type, so we can price the curated list.
- **Fallbacks and attribution:** `providerOptions.gateway` takes `models` (fallback list), `order`/`only` (provider routing), and `user`/`tags` (who and what to attribute spend to).
- **Spend reports:** `gateway.getSpendReport()` groups spend by user, tag or model. That feeds the margin dashboard.
- **Validating a BYOK key:** `createGateway({ apiKey }).getCredits()` confirms the key works and shows the user's remaining Gateway balance.

### Curated model catalog (DB-managed, not env)

A `model_catalog` table, edited from `/admin`, holds for each model:
- Gateway model id, label, provider
- Tier: Fast, Balanced or Best
- Which tasks it may run (`generate`, `research`, `classify`, `dna`, `critique`) and which tasks it's the default for
- Our markup, minimum charge and enabled flag

A nightly job syncs the table against `getAvailableModels()`. It refreshes base prices and auto-disables any model that has disappeared upstream.

**Adding models:** `/admin/models` lists every language model the Gateway offers (`getAvailableModels()`, live), searchable and filtered by provider and by whether it's in the catalog, sorted by what a typical batch costs. Each shows the Gateway's prices and what 5 ideas would cost at the default markup. Staff add a model with a tier (suggested from its output price), the tasks it's offered for, and whether to switch it on now; its name, provider and prices come from the list. A model without a listed price can't be added, since credits are charged from it.

**Which models a user sees:**
- **Credits users:** only enabled catalog models, each with a per-use price.
- **BYOK users:** the curated list by default, plus a "Show all Gateway models" toggle. Uncurated models carry an *untested* badge.

```ts
// lib/ai/models.ts
import { createGateway } from '@ai-sdk/gateway';

export type AiTask = 'generate' | 'research' | 'classify' | 'dna' | 'critique';
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

**How `actualCostUsd` works:** read the Gateway's cost from `providerMetadata.gateway.cost` (`reportedCostUsd` in `lib/ai/cost.ts`). If a response doesn't carry one, fall back to tokens × catalog price. An aborted stream settles on the partial usage.

**Prompt context:**
- Goal playbook
- Profile DNA (the voice guide)
- Top and bottom exemplars for the goal
- Last 20 posts (so suggestions don't repeat them)
- Timing stats
- User steer: topic, a "spice" level from 0 to 3, length, emoji on/off, banned words
- Research on the topic: what recent popular Threads posts on it are saying, and the web when it names something specific (below)

**Threads posts on the topic** (`lib/ai/threads-search.ts`): with keyword search granted, the topic is searched on Threads (top posts, last 14 days, 25 results). Replies and the author's own posts are dropped, and the best 15 go to the research model, each clipped to 300 characters. It sums up, in at most 80 words, the angles people take, the hooks and formats that keep coming up, what's overdone, and one angle nobody has taken; it describes, never quotes. The writer gets that summary with a rule to stand out from those posts and never copy or closely paraphrase them, and post-processing drops ideas too close to them, as it does for the author's own. Their text is only held in memory for the batch: the generation stores the summary and links (username, permalink, date). Studio shows the summary and the links under the ideas. On a broad theme the research call reads the posts without searching the web, and reading them is charged like a search (about 1 credit). A failed or ungranted search leaves the web research as it was.

**Web research** (`lib/ai/research.ts`): a model only knows what it was trained on, so a topic like a tool released or an exploit disclosed last week gets guessed at from the author's past posts. With a topic, the `research` task's model (the fast tier by default) first decides whether it needs the web: names, products, releases, vulnerabilities, events, news and anything it doesn't recognise do; broad themes ("morning routines") don't. If so, it searches through the Gateway's Perplexity Search tool (5 results, 512 tokens a page, at most two searches) and writes a brief of up to 100 words, facts and dates only (the reply's FACTS part; the Threads summary is its THREADS part, `research.v2`). The brief goes into the prompt with rules: use the facts, add none, and don't claim the author made or did anything they don't say. A search that finds nothing tells the writer not to assume what the topic is. Studio shows the brief and its sources under the ideas. It's charged with the batch at the research model's markup, only when a search ran or Threads posts were read (about 2 credits: a few thousand tokens plus the $0.005 search), and the reserve covers the worst case. A failed search never fails the batch.

**Post-processing:**
- Enforce the limit with `threadsLength()`, trimming or regenerating as needed
- Drop near-duplicates of past posts and of the Threads posts research read (trigram similarity)
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
| Model choice | Curated list | Curated list |

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
- **Top-ups:** hosted Stripe Checkout in one-time payment mode, packs of $5, $20 and $50 (500, 2,200 and 5,750 credits) priced inline from `lib/pricing.ts`. The `checkout.session.completed` webhook **and** the return route (`/api/billing/return`) both fulfill the session: each re-reads it from Stripe and adds a `purchase` ledger row, idempotent on the session id.
- **Currency and tax:** prices are USD, but the Stripe account is Canadian, so every Stripe object that takes a currency gets `CURRENCY` explicitly (Stripe otherwise uses CAD, and an auto-recharge invoice then rejects its USD item). Stripe Tax (`STRIPE_AUTOMATIC_TAX=1`) adds GST/HST and QST on top of the price, based on the customer's address. Checkout collects that address, including when saving a card for auto-recharge.
- **Receipt language:** a new Stripe customer gets `preferred_locales` from the browser's language, so French speakers get French receipts and invoices. Checkout picks its language from the browser.
- **Auto-recharge:** "Add a card" is Checkout in setup mode; the card becomes the customer's default for invoices. When a charge leaves the balance under the threshold, a conditional UPDATE claims the workspace (so only one runs), and a Vercel Workflow run charges the card off-session through an invoice (create, add the pack, finalize, pay), so tax and receipts work like Checkout. Every Stripe call is keyed by the claim, so retries never charge twice. A decline turns auto-recharge off and shows an in-app banner (email comes with Resend). So does a missing address while Stripe Tax is on, which retrying can't fix; turning auto-recharge back on then goes through Checkout to collect it. A 402 also starts a recharge.
- **Monthly plan:** $9 a month for 1,200 credits, the best rate (133 credits per dollar; packs give 100–115). It's a Stripe subscription started through Checkout (inline price from `MONTHLY_PLAN`, metadata `kind: "monthly"`), and each paid invoice adds 1,200 credits: `invoice.paid` reads the subscription's metadata from the invoice, and only a first or renewal invoice at the plan's price counts. The grant is a `purchase` ledger row keyed on the invoice id (note `monthly_plan`, "Monthly plan" in the activity), so the webhook and the return route can both apply it. A failed renewal adds nothing until Stripe's retry succeeds. Cancelling sets the plan to end with its period; the credits stay.
- **One plan at a time:** a workspace has one subscription slot (`stripe_subscription_id`, with `plan_kind` saying which plan it is). The Monthly plan and the own-key plan can't run together: starting one while the other runs is refused, and a key can't be saved during the Monthly plan. Once one is set to end, the other can start and takes the slot; the old one winding down never takes it back.
- **Trial:** about $1 of credits, granted once per **Threads account id**, which prevents farming new accounts for trials. That's enough for the onboarding analysis plus several Studio batches.

### BYOK

Not offered to new workspaces since Oct 29, 2026 (the decisions table): Settings shows the card only where a key was saved or an own-key plan ran (`usesOwnKey`). The rest of this section still describes how it works for them.

- **Setup:** Settings → Billing → "Use your own AI key". We validate it with `getCredits()` and show the user's Gateway balance.
- **Pricing:** a **$5/month platform fee**, a Stripe subscription started through Checkout. The workspace runs on its key only while the plan is live (active, trialing or past due) **and** a key is saved. Subscription webhooks re-read the subscription from Stripe, so out-of-order events are harmless.
- **Switching back** deletes the key and sets the plan to end with its period; adding a key before then resumes the same plan. When the plan ends for good, the key is deleted and an in-app notice explains the switch. Deleting the account cancels the plan immediately.
- **Storage:** encrypted with AES-256-GCM, bound to the workspace. Only the last 4 characters are ever displayed or logged.
- **Errors:** a rejected key or an empty Gateway balance shows a clear message in Studio with a one-click switch back to credits.
- **Rate limits still apply,** to protect our infrastructure and the user's Threads API quota.

### Admin (`/admin`, role-gated)
- Edit the catalog and markups, and add models from the Gateway's full list (`/admin/models`)
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

**Series (done):** "Add to thread" in the composer turns a post into a series of up to 10 parts. It's one `scheduled_posts` row: the first post in `text`, the rest in `series_parts` (each with its own container and media id). The run posts them in order, each a reply to the part before (`reply_to_id`; replying under your own post needs no extra permission). The topic tag goes on the first post, and only the first is checked against the daily post quota, recorded in `posts` and scored. If a part fails after the first went out, the series is marked failed with what's live ("Part 1 of 3 is live, but the series stopped there."). **Post the rest** carries on from that part with a fresh container, and **Keep what's posted** marks it published as far as it got. It can't be edited, since that would change what people already see. A series the sweeper finds stuck partway is recorded the same way. Each part that goes out counts as progress for the sweeper's 30 minutes.

---

## 8. Data model (Drizzle, Postgres)

```
-- tenancy
users            id, threads_user_id (unique; login identity in MVP), email + email_verified_at (added in Settings for alerts; Threads OAuth doesn't provide one), created_at
workspaces       id, name, billing_mode (credits|byok), byok_key_enc, byok_key_last4, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_period_end, subscription_cancel_at_period_end, auto_recharge jsonb, auto_recharge_pending_at, billing_notice jsonb, created_at
memberships      user_id, workspace_id, role (owner|member)
threads_profiles id (threads user id), workspace_id, username, name, avatar_url, bio, is_verified, timezone, active_goal
threads_tokens   profile_id, access_token_enc, expires_at, scopes[], last_refreshed_at, granted_at, data_access_expires_at, access_checked_at
sessions         id (random 256-bit), user_id, expires_at, user_agent

-- content & analytics (keyed by profile)
posts            id (threads media id), profile_id, text, media_type, permalink, posted_at, is_quote, topic_tag, length, has_link, has_question, via_threaded
post_metrics     post_id, captured_at, views, likes, replies, reposts, quotes, shares   ← snapshots, so we can see how fast a post picked up
post_features    post_id, version, format, topic, hook_type, tone, model
account_daily    profile_id, date, views, likes, replies, reposts, quotes, clicks, followers_count
demographics     profile_id, captured_at, breakdown (country|city|age|gender), data jsonb
profile_dna      profile_id, version, data jsonb, model, generated_at

-- AI
model_catalog    model_id, label, provider, tier, tasks[], default_for[], markup, min_credits, input_price, output_price, enabled (admin), available (Gateway), synced_at
user_settings    user_id, model_picks jsonb (per task), voice_prefs jsonb (emoji, casing, banned_words, spice_default)
generations      id, profile_id, goal, model, prompt_version, steer jsonb, usage jsonb, gateway_generation_id, cost_usd, credits_charged, billing_mode, status, dropped, error, created_at
suggestions      id, generation_id, text, series_parts (jsonb: the rest of a thread), format, hook, rationale, goal_fit, best_slot, status (new|saved|dismissed|scheduled|posted), posted_media_id, perf_vs_baseline

-- billing
wallets          workspace_id, balance, reserved
credit_ledger    id, workspace_id, delta, kind, ref, generation_id, note, actor_user_id, created_at   unique(kind, ref)
credit_lots      id, workspace_id, ledger_id, amount, remaining, created_at   ← spent oldest first; never expire

-- publishing & jobs
scheduled_posts  id, profile_id, suggestion_id, text, topic_tag, series_parts (jsonb: text, container_id, media_id per later part), scheduled_for (utc), status (scheduled|publishing|published|failed|canceled), version, container_id, media_id, permalink, attempts, last_error, workflow_run_id, publishing_at, published_at
sync_runs        id, profile_id, kind, status, step, stats jsonb, error, started_at, finished_at
email_log        id, user_id, kind, ref, status, provider_id, error, created_at   unique(user_id, kind, ref): each alert once
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
/admin                  Catalog, Gateway models, markups, margin, workspaces (staff only)
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
  (admin)/admin/{catalog,models,margin,workspaces}/page.tsx
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
| **Launch: Quebec readiness** | **Monitoring and consent:** Sentry (with post text and tokens scrubbed), Google Tag Manager behind Consent Mode, and a cookie banner shown where consent is required (Quebec, the EU, the UK and Switzerland, from Cloudflare's or Vercel's location headers), with the Privacy page updated (done). **Search and sharing:** share images, canonical URLs, robots.txt, sitemap, structured data, a features section and FAQ on the home page (done). Then the Law 25 privacy items; live Stripe Tax; the lawyer's changes; a pricing and costs review against real usage (SETUP.md §5) | Public sign-ups open |
| **After launch: French** | **French** (Bill 96): site, app, Terms, Privacy and emails, with `fr-CA` as a first-class locale and AI output in the user's language. Pinned until after launch (Oct 27, 2026) | Everything a Quebec customer sees exists in French |
| **3: Grow** | Keyword-search trend radar, reply analysis, A/B variants, opt-in nightly "Today's plays", weekly digest email | |
| **4: Agencies** | Shaped by the agencies who get in touch through the Agency tier. Likely: multiple Threads profiles per workspace, team seats, email/Google login, their own AI key | |

**Phase 2, in order.** Each milestone ships as its own PR, tested end to end.

| Milestone | Scope | Done when |
|---|---|---|
| **2a: Intelligence** | Post classification (§4c: Fast-tier model, 20 posts per call, cached per post and versioned) and Profile DNA (weekly, mid-tier, stored as versioned JSON). The DNA becomes the voice guide in the generation prompt, and classification makes exemplars and insights topic-aware. Runs inside the sync workflows; the cost is ours (§6). | A real account's posts are classified, its DNA is stored, and Studio's prompt uses both |
| **2b: Payoff screens** | The Insights page (§9c: views and followers over time annotated with posts, the heatmap, the format × topic matrix, the sortable post table, a plain-English line per chart). Onboarding: The Read (live sync progress) and the DNA reveal, replacing Home's progress card on first sign-in | Insights replaces the placeholder; a first sign-in plays The Read, then the DNA reveal |
| **2c: Feedback loop + reliability** | The suggestion scorecard (+1h/+24h/+72h chips; winners join the exemplar pool, §5). Emails through Resend: a failed scheduled post, a declined auto-recharge, a lapsed plan, and a reconnect reminder before a private profile's 90-day grant ends. The evals harness (`pnpm eval`, §11). The admin margin dashboard (§6) | Phase 2's exit criteria above |
| **Polish (any time)** | Series via `reply_to_id` (§7, done), drag-and-drop onto the week calendar | |

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
| Quebec rules: French, privacy (Law 25), consumer protection | French first thing after launch (§13); ask the lawyer about the gap. Law 25 checklist and a lawyer's review of the Terms and the plan (SETUP.md §5). Credits never expire. |

---

## 15. Decisions log

All open decisions are resolved; see the table at the top. **Pricing review before launch (done):** with Stripe's fees on a Canadian account charging USD (about 6.2% + 30¢ a payment: card, international card, currency conversion without a USD bank account, Stripe Tax), 1.5× left 21–27% of a pack after the AI behind its credits, before the trial, the background work and fixed costs. The default markup is now **2×** (38–43%; a typical batch of three ideas goes from 4 to 5 credits), packs carry a bonus (**500 / 2,200 / 5,750** credits for $5 / $20 / $50), and Profile DNA is only rebuilt when there are new posts (it cost about $0.18 a month for every connected account, active or not). The **Monthly plan** is the subscription that's the better deal: $9 for 1,200 credits a month, a third more per dollar than the $5 pack. After Stripe's fees (Billing adds 0.7% on subscriptions) about $8.08 of the $9 reaches us, and 1,200 credits at 2× are about $6 of AI, so even a month whose credits are all spent leaves about $2. Check the real numbers in `/admin` → Margins once there's traffic.

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
- Not yet: the admin margin view (Phase 2), the "all Gateway models" toggle for BYOK users. (Emails for failed recharges and lapsed plans came in 2c.)

**1e, publishing (done):**
- A composer (dialog on desktop, bottom sheet on phones) with a live Threads preview, a length ring that counts emoji the Threads way, and an optional topic tag. **Schedule** offers the idea's own slot and the author's best hours as chips ("Today 7 PM · your best hour"), or any time in the profile's timezone; **Post now** asks for confirmation first.
- It opens from Studio's idea cards, saved ideas, Home's plays and the Queue. "Post now" follows the run until the post is live and links to it.
- Queue: a week strip, the scheduled timeline grouped by day (edit, post now, cancel), "Needs attention" for failures (retry, edit, remove), saved ideas ready to schedule, and recently posted with their latest numbers. Home's "Up next" counts down to the next post. The demo shows a sample queue.
- Durable `publishPost` runs with versioning, a single-publisher claim, idempotent container and publish steps, user-facing failure messages, and the sweeper (§7).
- Tests: integration tests drive every step against a fake Graph API (scheduling rules, publish once, container polling and errors, quota, revoked tokens, edits superseding runs, cancel, retry, the sweeper); end-to-end tests schedule, edit and cancel a saved idea, post now through the mock Meta server, show a failed post until it's removed, and rescue an overdue post with the sweeper.
- Not yet: drag-and-drop onto a week calendar (the slot chips cover it for now). (Failure emails came in 2c; series came later, §7.)

**Stripe sandbox check (Canadian account, Quebec):** Stripe's MCP connector was used to send the app's own Checkout, portal and invoice calls to the real sandbox. The connector can't pay invoices, so the final charge is still only tested against the mock. Checkout in all three modes and the portal work as written. Two bugs the mock had hidden are fixed:
- Auto-recharge invoices were created without a currency, so on a Canadian account they came out in CAD and refused the USD pack. Every recharge would have failed and been retried as if Stripe were down. The invoice now states USD.
- With Stripe Tax on, Stripe won't finalize an invoice for a customer without an address, and saving a card didn't collect one. Card Checkout now asks for the address when tax is on, and a recharge that still lacks one stops with a notice instead of retrying.
- The mock now behaves the same way (CAD by default, no mixed currencies, no taxed invoice without an address), and integration tests cover both cases. The default portal configuration Stripe creates already matches what Threaded needs.
- These checks ran on a separate "Threaded sandbox". The app now uses the **Threaded** account's test mode, which has its Quebec head office set, default tax code `txcd_10103000`, and GST/HST and QST registrations.

**Phase 1 is live.** Production runs on Vercel at `getthreaded.app` (behind Cloudflare's proxy, settings under "Domains" in `docs/SETUP.md`; `www` redirects to it), with Neon Postgres (migrated on every deploy) and Threads sign-in for the Meta app's testers (the app is published, but only people with a role on it can sign in until App Review approves its permissions). Production uses live Stripe keys; previews use test keys and sign in through production's callback (`PREVIEW_ORIGINS`). Docs-only changes don't build previews (`scripts/vercel-ignore-build.sh`). Phase 2 is under way (§18).

**Waiting on you** (see `docs/SETUP.md` §5):
- Meta: verify the app's contact email; submit App Review (screencasts, icon; business verification may be requested)
- Stripe live mode: check that Tax shows Active, add the GST/HST and QST registrations once you have the numbers, and create the live webhook endpoint
- A Resend account (Phase 2c emails)
- Legal review of the Terms and Privacy drafts by a Quebec lawyer, and the Law 25 items (French follows right after launch)
- Keyword search: add `threads_keyword_search` to the Meta app, set `THREADS_KEYWORD_SEARCH=1`, reconnect, and include it in App Review (SETUP.md §1, step 7)

## 18. Phase 2 progress

**2a, intelligence (done):**
- Every sync classifies the posts that aren't labelled yet (now with Jev, below), then rebuilds Profile DNA if it's over a week old, the account has 10+ posts and it has posted since (an idle account keeps its DNA). Both run after the account's data is in: Home shows the data straight away while they finish.
- It's enrichment, never a failure: if no model is reachable or a call fails, the sync still succeeds and the rest is picked up next time. On credits the cost is ours; with the workspace's own key it runs on that key.
- Studio's prompt is now `generate.v2`: the DNA as a voice guide (habits, rules, real signature phrases, what the audience rewards and the blind spots, each with our number), exemplars labelled with format and topic, up to three on-topic exemplars from the author's better half when the requested topic matches one of theirs, and the facts that matter for the goal. Studio says when it's writing in the author's voice.
- Tests: facts and prompt assembly on the demo data; integration tests against Postgres for classification (batching, topic reuse, failures, no double labelling, no credits charged), DNA (weekly rebuilds, versions, claims checked against facts, cold start), and Studio's prompt; the end-to-end sign-in now waits for the DNA through the real workflow, with the mock model answering from the prompt.
- Rough cost: about 2¢ a week per account for the DNA. Classification was about 12¢ once for a full 500-post history on the fast model; with Jev it's around a cent (Vercel's docs show a Jev call at about $0.00001), plus one fast-model call to name the topics.

**Classification with Jev (done):** posts are now labelled by Jev, one multiple-choice decision per post and ten at a time, against the author's own topic list (§4c). A full 500-post history takes ten workflow steps instead of 25 sequential model calls. Classifier version 2, so every account's posts are labelled again on their next sync. Integration tests cover topic naming and refreshes, filing posts again, failures and the fallback route; the mock decision model stands in for Jev.

**2b, payoff screens (done):**
- **Insights** (`/insights`, demo and real accounts): daily views and followers with a dot on each day you posted (filled when posted with Threaded) and a crosshair tooltip that's also keyboard-driven; a weekday × hour heatmap in your timezone, shaded by how posts scored for the goal; a format × topic grid on the goal's lead metric against your median; and every post in a sortable table with its "vs usual" multiplier. Each chart opens with one plain-English line (`lib/analysis/insights.ts`), and each has a table for screen readers. Followers start at the first real snapshot, since Threads can't be backdated.
- **The Read** (`/onboarding/analyzing`): a first sign-in now lands here instead of Home. It plays the real workflow run on the thread line (posts, metrics, account days, topics as they're named, then the voice) and moves on to the DNA reveal when there's one, or Home when there isn't (under 10 posts). Once the data is in, you can skip ahead. Home sends you back here until the first sync has finished.
- **DNA reveal** (`/onboarding/dna`): the headline in the display serif, then cards one by one: what your audience rewards (each with its measured number), topics sized by how often you post about them, the best-hours heatmap cascading in, the blind spot, and your voice with the rules Studio writes by. Insights links back to it. The demo personas get one too, from hand-written voices and their own measured facts.
- Not built: the goal-picker step (`/onboarding/goal`); the goal switcher in the header covers it. Demographics wait for eligible accounts.

**2c, part 1: scorecard and emails (done):** 2c ships as two PRs; this is the first.
- **Scorecard** (Queue): every post from the last 30 days that went out through Threaded, or that the author posted themselves from a Studio idea, with chips for views at 1 hour, 1 day and 3 days against their usual at the same age (`lib/analysis/scorecard.ts`). The usual is the median of up to 30 earlier posts measured at that age; at 3 days, earlier posts' final views stand in until enough were measured. Until there's a usual, a chip shows the raw number. One line sums it up ("2 of 3 posts beat your usual views at 3 days").
- Posts written elsewhere are matched to the draft they came from on each sync (character-trigram similarity of 0.5 or more, the draft written in the 30 days before; scheduled drafts are left alone). Each posted draft's 3-day score is stored in `suggestions.perf_vs_baseline`, from the sync and from the publish run's 3-day snapshot.
- **Winners feed Studio:** drafts that beat the usual by 1.3× or more at 3 days are pinned among the exemplars (up to two), labelled as drafted in Threaded with their score (prompt `generate.v3`).
- **Emails through Resend** (`lib/email`): a scheduled post that didn't go out (including ones the sweeper gives up on), a declined auto-recharge, a lapsed own-key plan, and a reminder a week before a Threads grant lapses. People add an address in Settings; it's stored only once the emailed link is opened (signed, 24 hours, three links an hour). Each alert goes to the workspace's confirmed addresses once per event (`email_log`, unique per user, kind and reference), with Resend's idempotency key on top; a failed send frees the claim so the next occurrence retries. Without `RESEND_API_KEY`, emails are logged instead of sent.
- **Reconnect reminders:** Threads doesn't say whether a profile is private, so from day 60 of a grant the daily sync asks `debug_token` when data access ends (weekly while it's far off) and reminds in the last week. Meta documents `debug_token` for testers' tokens; if it refuses other users', there's no reminder, and the failed-post email still covers a lapsed connection.
- Tests: the scorecard maths, matching and the summary line; integration tests for matching, scoring, winners, confirming an address, once-only alerts, provider failures, the failed-post, declined-recharge and lapsed-plan emails, and reconnect reminders; end to end, adding an address through the emailed link, and the scorecard on the Queue (demo sample included).

**2c, part 2: evals and admin (done):**
- **Evals** (`pnpm eval`, `lib/evals/eval.ts`): the three demo personas × three goals go through Studio's real context and prompt on the model being evaluated. Length (within 500 characters), repeats (trigram similarity to a past post or another idea) and ideas kept after post-processing are measured; voice and goal fit are graded 1–5 per idea by a judge model shown the author's real posts, and reported 0–100. Cost per batch uses the Gateway's live prices, so models not in the catalog yet can be compared too. Reports go to `evals/results/`; `--mock` runs the harness without a key.
- **Admin** (`/admin`, staff only: `users.is_staff` or `ADMIN_THREADS_USER_IDS`; a 404 for everyone else, and every action re-checks):
  - **Margins** over 7, 30 or 90 days: Studio revenue (credits charged) against each generation's Gateway cost, by model and by workspace; the Gateway's spend report for everything on our account, by model and by task tag (so background classification and DNA show up); credits sold, credits outstanding (owed), free credits given, and own-key plans.
  - **Catalog:** markup (at least 1×), minimum credits, tier, tasks and on/off per model, each task's default, adding a Gateway model (switched off until evaluated), and refreshing prices now. The nightly sync now only marks models available or not; switching them on and off is the admin's.
  - **Workspaces:** lookup by username, name, id, alert email or Stripe customer, then balance, lots, plan, profiles, people, the ledger and recent generations, and credit adjustments with a reason (written as `adjust` ledger rows with who made them; taking credits back never goes below zero, oldest lots first).
- Tests: the eval harness on mock models; integration tests for adjustments (idempotent, never below zero, lots in step), margins (with and without the Gateway), catalog rules (defaults can't be switched off, one default per task, sync leaves the switch alone) and lookup; end to end, the 404 for non-staff, then margins, catalog and an adjustment as staff.

**Web research in Studio (done, after Phase 2):** a topic that names something specific or recent is looked up on the web before Studio writes (§5), so "php2shell" means the exploit in the news rather than a tool the author built. Prompt `generate.v4` adds the brief and a standing rule against guessing what an unfamiliar name is. `research` is a catalog task (the fast model by default, switchable in `/admin`); each generation stores its queries, brief, sources and cost. Tests: reading searches and briefs, the prompt, costs and charging; integration tests for a researched batch, a broad theme that skips the search, a search that finds nothing, a failed search and no topic; end to end, a researched batch showing its sources and charge.

**Reliability fixes (done):**
- **Costs:** Studio billed from `getGenerationInfo`, which the Gateway can't answer straight after a call ("usage event not found"), so every batch fell back to token pricing. Batches and research now bill from the cost the Gateway sends with each response.
- **Two sign-ins at once:** a new account signing in from two tabs or devices at the same moment made both create it, and the second failed on the duplicate profile. Sign-ins for the same Threads account now wait for each other (a transaction-level advisory lock), so the second signs in to the account the first created. Each would then have started its own first sync; starting a run is now a locked check-and-insert, so a second sync for a profile stops before doing anything, which also covers a double click on "Sync now" and the daily sync during a manual one.
- **Topic names:** on a real account the fast model's topic list sometimes couldn't be read ("could not parse the response"). JSON wrapped in a code block or a sentence is now unwrapped before giving up (topics and DNA), the list gets 2,000 output tokens instead of 1,000, and a failure logs how the reply ended and its shape, never its words. Posts labelled before the first list was named are filed again once it is; before, they stayed without a topic.

**Launch, part 1: monitoring and cookies (done):**
- **Sentry** (`instrumentation.ts`, `instrumentation-client.ts`): errors from the server, the proxy and the browser, once `NEXT_PUBLIC_SENTRY_DSN` is set. `lib/monitoring/scrub.ts` removes tokens from URLs and messages, request bodies, cookies, headers, the user, rows Postgres quotes, and console breadcrumbs before anything is sent. Errors only, no IP addresses. Source maps upload when `SENTRY_AUTH_TOKEN` is set.
- **Cookies** (`components/consent`, `lib/consent/consent.ts`): Google Tag Manager under Consent Mode v2, once `GTM_ID` is set. `/api/consent` tells the browser the container and whether this visitor's location needs consent first: Quebec, the EU and EEA, the UK and Switzerland, Canada when the province is unknown, and anywhere unknown. Tag Manager loads on every page; an inline script in `<head>` sets Consent Mode's defaults first: the saved choice if there is one, else denied in those regions and granted elsewhere. The banner only updates consent. Accept and Decline sit side by side, Choose sets analytics and advertising separately, and the choice is kept in the browser with its date and is the default on later visits. **Cookie settings** (footer, Privacy page) reopens it. The banner names no tools; the Privacy page lists them (Google Analytics and Tag Manager, Sentry, Vercel, and ad platforms such as Google Ads or Reddit Ads if we advertise).
- Privacy: a Cookies section, and Sentry and Google among who we share with.
- Tests: scrubbing, the location rules and stored choices; end to end, asking first and loading Tag Manager only after a yes, not asking elsewhere and turning cookies off, no banner without a container, and the location rules over HTTP.

**Launch, part 2: search and sharing (done):**
- **Technical** (`lib/seo.ts`): every canonical URL, Open Graph URL and sitemap entry points at the production domain, so previews and the vercel.app aliases never compete with it. `robots.txt` sends crawlers to the sitemap and away from signed-in pages and APIs; on previews it turns every crawler away and pages say `noindex`. Signed-in and onboarding pages are `noindex` everywhere. A web manifest and an Apple touch icon.
- **Share images** (`lib/og/images.tsx`): the home page's shows the promise, the three goals and a suggested post scored for engagement next to the author's best, drawn with the brand fonts (Geist and Instrument Serif, OFL, in `assets/fonts`). Connect, Terms and Privacy get titled cards. All are prerendered at build.
- **On the page:** a search-led title and description, a Features section (Profile DNA, analytics, ideas, scheduling, the scorecard, alerts) and an FAQ, with the same questions in schema.org `FAQPage` data next to `Organization`, `WebSite` and `WebApplication`. No ratings or reviews we don't have. The hero's headline now paints with the page instead of fading in after hydration: on a throttled phone (slow 4G, 4× CPU) the largest paint went from about 3.9s to 1.1s.
- Tests: canonical URLs, indexing rules, robots and sitemap, structured data matching the FAQ and pricing; end to end, the home page's tags, a real 1200×630 image and its FAQ, the other pages' canonicals and images, robots.txt, the sitemap and manifest, and `noindex` once signed in.

**Threads from Studio (done):** "Each idea is: One post / A thread" in Studio. A thread is an opening post and 2–4 parts that reply to it: the schema's new `parts` field, prompt `generate.v7` with rules for how a thread reads (the opening post earns the rest and works alone, every part adds something, the last lands it), and a bigger output budget (900 tokens an idea instead of 350, so the estimate goes up a little). Post-processing checks every post of a thread for length, links, banned words and emoji and drops the whole idea if one fails; repeats are judged on the opening post. The parts are stored on the idea (`suggestions.series_parts`), shown the way Threads shows a thread in Studio, Saved ideas and Home's plays, copied together, and open in the composer as a series. Demo accounts don't offer threads (their ideas are hand-written single posts). Tests: the prompt rules and budget, every part checked and the parts kept only for threads; an integration test that stores each idea's parts; end to end, a batch of threads and one opened in the composer with its parts.

**Series (done):** the composer's "Add to thread" writes a series of up to 10 parts, previewed as Threads will show it, and each part is checked on its own ("Part 2: Write something first."). It publishes as a chain of replies (§7), with the Queue showing every part, and a series that stops partway offering **Post the rest** or **Keep what's posted**. Studio writes ideas as threads too (below). Tests: the series rules; integration tests for the chain (reply ids, topic tag on the first, one `posts` row), stopping partway and retrying without reposting, keeping what went out, and the sweeper; end to end, writing a three-part series, catching an empty part, and the mock's replies chaining to the first post.

**Voice settings (done):** Settings → Voice replaces the last "Soon" cards (the Models card is gone: Studio already picks the model per batch, and background tasks run on our own). People set emoji (like my posts, none, a little, lots), casing (like my posts, normal, all lowercase), up to 30 words or phrases to never use, Studio's default tone, and free-form notes ("Anything else Studio should follow", up to 500 characters). Prompt `generate.v6` adds them as the author's own rules, which win over the habits learned from their posts (`lib/ai/voice.ts`); the notes come last, quoted, as guidance that never outranks those rules or Threaded's own (no made-up numbers, no copying); post-processing drops any idea that still uses a banned word (whole words, any case) or, with emoji turned off, an emoji. Studio starts on the saved tone and links to the settings. Tests: parsing the form, the rules and notes in the prompt, matching words and emoji, the drops; an integration test for a batch with the settings; end to end, saving them (notes included), Studio's tone, and a batch that leaves out the idea with a banned word.

**Account & data (done):** Settings → Account & data, so people can act on their rights themselves (Law 25, including data portability):
- **Download your data** (`lib/accounts/export.ts`, `GET /api/account/export`): one JSON file with the profile, alert email, settings, billing and credit history, every post with its labels and insight snapshots, account insights and audience, every Profile DNA version, Studio batches with their research and ideas, scheduled posts and the alerts sent. No tokens, keys or internal ids.
- **Disconnect Threads**: forgets the token and keeps the data; signing in reconnects.
- **Delete account**, after typing the username: ends a running own-key plan, deletes everything about the person, signs them out and shows the confirmation code on `/data-deletion`. The workspace stays for the ledger, renamed "Deleted account" and stripped of the AI key, auto-recharge and any billing notice; Meta's deletion callback now does the same.
- Tests: the export's contents and what it leaves out, and what deletion leaves behind; end to end, downloading, disconnecting and reconnecting, and deleting after a wrong then a right username.

**Threads posts in Studio research (done):** with a topic, Studio also reads recent popular Threads posts on it (keyword search on the author's connection), and the research model sums up what they're saying and what's missing (§5). Prompt `generate.v5` passes that on with a rule to take a different angle and never copy them; ideas too close to those posts are dropped. Generations store the summary and links to the posts, never their text, and Studio shows both. Sign-in asks for `threads_keyword_search` only once `THREADS_KEYWORD_SEARCH=1`; connections from before show a reconnect link in Studio. Tests: reading the reply's two parts, picking posts (no replies, not the author's, no repeats), the prompt and charging; integration tests for a batch that read posts, a broad theme, a dropped echo, and a failed or ungranted search; end to end, the Threads card and its links.

**Monthly plan (done):** Settings → Billing leads with the Monthly plan, $9 a month for 1,200 credits (§6), next to the balance. It shows the date the next credits come, cancelling and keeping the plan, a failed payment, and why it can't start while the own-key plan runs; the own-key card says the same the other way round. The landing page's pricing has it as the best value between pay as you go and your own key, and the FAQ and Terms describe it. Migration `0013_plan_kind` marks existing plans as own-key.
- Tests: integration tests for the first and renewal grants (once each, from the webhook or the return page), invoices that aren't the plan's or at another price, one plan at a time both ways, and cancelling and keeping the plan; end to end, starting the plan through Checkout, a renewal arriving by webhook, and cancelling then keeping it.

**Gateway models in /admin (done):** a "Gateway models" tab lists every language model the AI Gateway offers, with search, a provider filter, "in the catalog or not", and sorting by price or name. Each row shows the Gateway's input and output prices per million tokens and what a batch of 5 ideas would cost at the default markup. "Add to the catalog" takes a tier (suggested from the price), the tasks it's offered for and an optional "Switch on now"; the name, provider and prices come from the list, checked again when it's added. Models with no listed price can't be added. Models already in the catalog link to it. Under `AI_MOCK=1` the list is a fixed mock (`lib/ai/mock-gateway-models.ts`).
- Tests: the list (language models only, prices, providers), the filters and sorting, the suggested tier and batch price; adding from the list (named and priced as listed, switched on or off, refused without a price or when it's not listed); end to end, finding a model, adding it switched on, and seeing it in Studio's picker.

**Mobile app shell (done):** on iPhones with Safari 26, the page showed through below the bottom tab bar. Safari draws the page under its floating toolbar and clips fixed elements above that toolbar, so neither extending the bar's background nor `viewport-fit=cover` fixed it on a real phone.
- On phones the app shell is now exactly the screen's height: the top bar, the page scrolling in `<main>`, then the tab bar as the last row. The document never scrolls, so nothing passes under the toolbar. The top bar stays in place. From `md` up nothing changed.
- Safari doesn't report elements scrolling into view inside that scroll area, so the app's entrance animations (reveals, count-ups, sparklines, thread lines, goal rings, the Insights chart and heatmap) now play on mount there (`PlayOnMount` in `components/motion/scroll-reveal.tsx`). The marketing pages keep their scroll reveals.
- Insights no longer scrolls sideways on phones. Its grid has an explicit single column, the posts table scrolls inside its card, and the chart's screen-reader table is hidden through a wrapper (a table ignores `sr-only`'s `width: 1px`).
- Trade-offs on phones: Safari's toolbar no longer shrinks on scroll, and there's no pull-to-refresh on app pages.
- Tests: `e2e/app-shell.spec.ts` stubs `IntersectionObserver` so it never reports, as in Safari. With that stub, every app page shows its content and none scrolls sideways. On phones the document stays put, the page scrolls between the bars, and a new page opens at its top.

**Agency tier instead of own key (done):** the own-key plan asked a Threads creator to open a Vercel account, add billing there, and paste an AI Gateway key: our vendor, not something they know. The Monthly plan now does its job for heavy users. So:
- The landing page's third pricing card is now **Agency**: no price, "Let's talk", and a **Get in touch** button that opens an email to the contact address. The FAQ says agencies can email us, and no longer mentions the Gateway or "any model your key offers" (that toggle was never built, and is dropped).
- Terms §5 is now "Your own AI key", available where we agree to it, for example on an Agency plan, without naming Vercel.
- In the app, Settings → Billing shows the own-key card only to workspaces that have used it (a saved key, or an own-key plan running or ended), so anyone on it keeps it. The code stays until no one is.
- Account deletion now says "Your Monthly plan ends now" on the Monthly plan (it said "own-key" for both).
- Tests: the FAQ never mentions the Gateway; end to end, a new account doesn't see the own-key card, a former own-key customer does and can start it again, and it's gone once the Monthly plan takes the slot.

**Studio's progress timeline (done):** a batch now shows each step on its own line, like a timeline: the running step with a spinner, and each finished one with a check and what it did. For example: "Read your 8 best posts and your Profile DNA", "Read 2 posts on Threads and 3 web pages about “…”", "Wrote 3 ideas", "Checked and saved all 3" (or "Saved 2, left out 1"). Studio sees three moments: the response starting (the server has read the posts and researched the topic by then), the ideas streaming in, and the final check; the steps follow those (`lib/ai/progress.ts`). The server sends what it read before writing in an `x-threaded-context` header, as counts only. A step that was running when a batch fails is left off; the error says why. The demo's timeline ends at writing, since its ideas aren't checked or saved.
- Tests: every step's wording (topics, threads, few posts, the demo, failures, models that write extras); end to end, the demo's timeline, a batch's, and a batch with a topic.

**Phase 2 is complete.** Next on the roadmap (§13): Launch, Quebec readiness (the Law 25 items, live Stripe Tax, the lawyer's review; monitoring and consent are done). French is pinned until after launch.
