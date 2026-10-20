# Threaded: Threads Growth Companion

Implementation and UI/UX plan. Working name: **Threaded** (after the repo).

> **What it does:** Connect a Threads account. Threaded reads your posts and insights,
> learns what works for *you*, and writes post suggestions aimed at one of three goals:
> **More Followers**, **More Views** or **More Engagement**. You can switch the AI models
> behind it at any time.

---

## 1. Recommended stack

Everything below deploys to Vercel. Versions were current on npm in Oct 2026.

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, RSC, Server Actions, Route Handlers), React 19, TypeScript | Native to Vercel. Streaming RSC suits a data-heavy dashboard. |
| UI | **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) | Accessible primitives that you own and can restyle fully. |
| Motion | **Motion v14** (`motion/react`) | Layout and shared-element animations, gestures, springs and scroll-linked effects. Load it with `LazyMotion` to keep the bundle small. |
| AI | **AI SDK 7** (`ai`) + **Vercel AI Gateway** (`@ai-sdk/gateway`) | Models are plain strings like `anthropic/…` or `openai/…`, so you can swap them without code changes. Also gives fallbacks, per-user spend reports and BYOK. See §5. |
| Database | **Neon Postgres** (Vercel Marketplace) + **Drizzle ORM** | Relational data (posts, metrics, suggestions) with typed queries. Neon branches can back each preview deployment. |
| Cache / rate limit | **Upstash Redis** + `@upstash/ratelimit` (Marketplace) | Caches Threads API responses and the model list. Limits generations per user. |
| Background jobs | **Vercel Workflow** (durable steps) + **Vercel Cron** | The first sync makes hundreds of API calls, so it needs retries and resumability. A daily cron refreshes metrics and tokens. (Inngest is a drop-in alternative.) |
| Charts | **Recharts 3** for standard charts. Custom SVG + Motion for sparklines, the heatmap and rings. | Recharts covers the boring parts. The hero visuals are hand-built so they animate the way we want. |
| Validation | **Zod 4** | Shared schemas for API input, AI structured output and env. |
| Auth | **Threads OAuth is the login.** Hand-rolled with route handlers, a DB sessions table and an httpOnly cookie. | Threads is the only identity we need. Its token flow (short-lived, then long-lived, then refresh) doesn't fit generic OAuth libraries. It's about 150 lines of code. |
| Tooling | pnpm, Biome (lint + format), Vitest, Playwright, `next/font` (Geist) | |
| Observability | Vercel Analytics + Speed Insights, the AI Gateway dashboard, optional Sentry | |

---

## 2. Threads API: what we can and can't get

Base URL: `https://graph.threads.net/v1.0`. Meta's docs site was blocked from my environment, so I checked the details below through Meta's blog and developer guides. Items marked ⚠ need confirming against the live docs in Phase 0.

**Scopes**
- `threads_basic`: profile and the user's own posts. Required.
- `threads_manage_insights`: post and account metrics. Required.
- `threads_content_publish`: direct publish and scheduling. Phase 3.
- `threads_read_replies`: reply analysis. Phase 3.
- `threads_keyword_search`: niche and trend research. Phase 3. Without it, search only covers the user's own posts.

**Endpoints we use**

| Purpose | Call |
|---|---|
| Authorize | `https://threads.net/oauth/authorize?client_id&redirect_uri&scope&response_type=code&state` |
| Exchange code for short-lived token (1h) | `POST /oauth/access_token` |
| Exchange for long-lived token (60 days) | `GET /access_token?grant_type=th_exchange_token` |
| Refresh token (resets 60 days; token must be ≥24h old ⚠) | `GET /refresh_access_token?grant_type=th_refresh_token` |
| Profile | `GET /me?fields=id,username,name,threads_profile_picture_url,threads_biography,is_verified` |
| Posts (paginated, `since`/`until`) | `GET /me/threads?fields=id,text,timestamp,media_type,permalink,is_quote_post,topic_tag…` ⚠ field list |
| Post metrics | `GET /{media-id}/insights?metric=views,likes,replies,reposts,quotes,shares` |
| Account metrics | `GET /me/threads_insights?metric=views,likes,replies,reposts,quotes,clicks,followers_count,follower_demographics` (`views` is a daily time series; the rest are totals. Data goes back to about Apr 2024 ⚠) |
| Publishing quota | `GET /me/threads_publishing_limit` (250 posts per rolling 24h) |

**Limits and gaps the design has to work around**
- **No per-post follower attribution.** `followers_count` is a current total only. We **snapshot it daily** to build a growth history, and estimate which posts drove follows by correlating daily follower changes with that day's posts. The UI labels this as an *estimate*.
- **No insights webhooks.** We poll with the daily cron, plus a manual "Refresh" button.
- **Demographics** need at least 100 followers on creator and personal accounts ⚠. Hide that panel below the threshold.
- **Account `replies`** counts only top-level replies, so it will read lower than the sum of per-post replies.
- **Call budget** is 4800 × impressions per 24h (impressions floored at 10), which is plenty for our usage.
- **App Review:** until Meta approves `threads_manage_insights` (and publish), only **Threads testers** added in the Meta app dashboard can connect. **Start App Review early.** Demo mode (§9) is what the reviewers will see.
- **Required by Meta:** an *uninstall* callback and a *data-deletion* callback URL. Both receive a `signed_request` that we verify with HMAC-SHA256 and the app secret.

---

## 3. Architecture

```
                         ┌───────────────── Vercel ─────────────────────────────┐
 Browser (RSC + Motion)  │  Next.js 16                                          │
 ───────────────────────▶│   app/(app)/*        RSC pages, Server Actions        │
   streamed suggestions ◀│   /api/generate      streamText → partial objects    │──▶ Vercel AI Gateway ──▶ Anthropic / OpenAI / Google / …
                         │   /api/auth/threads  OAuth start/callback             │
                         │   /api/threads/*     uninstall + delete callbacks     │──▶ graph.threads.net
                         │   /api/cron/daily    Vercel Cron → starts workflows   │
                         │   workflows/*        initial-sync, daily-refresh,     │
                         │                      build-dna (durable steps)        │
                         └──────────┬──────────────────────┬────────────────────┘
                                    │                      │
                             Neon Postgres           Upstash Redis
                            (Drizzle schema)    (cache, rate limit, sync progress)
```

**Request paths**
1. **Connect:** OAuth callback → exchange for a long-lived token → encrypt and store it → start the `initial-sync` workflow → redirect to `/onboarding/analyzing`.
2. **Initial sync** (durable steps): profile → paginate posts (≤365 days or ≤500 posts) → post insights in batches of 25 → account insights → deterministic stats → LLM post classification (cheap model, batched) → Profile DNA (mid-tier model). Each step writes progress to Redis, and the onboarding screen polls it every 1s, or streams it over SSE.
3. **Daily refresh** (cron at 06:00 UTC, one workflow per user): refresh the token if it's >24h old and expires within 14 days → new posts plus metric snapshots for posts <14 days old → follower snapshot → update stats → re-run DNA weekly.
4. **Generate:** Studio form → `/api/generate` → rate-limit check → build context from DB → `streamText` with structured output → cards stream into the UI → persist the suggestions in `onFinish`.

---

## 4. Analysis engine

### 4a. Deterministic layer (pure TypeScript, no LLM, fully unit-tested)

For each post (posts <72h old are marked *"still settling"* and left out of scoring):
- `engagementRate = (likes + replies + reposts + quotes) / views`
- `replyRate`, `amplificationRate = (reposts + quotes + shares) / views`
- `outperformance = views / median(views over the trailing 30 posts)`: the "2.4×" badge in the UI

**Robust z-scores.** Social metrics are heavy-tailed, so we use median and MAD, with `log1p` on views. A z-score here means how far a post sits above or below your typical post, in robust units.

**Aggregates:**
- Hour × weekday heatmap in the user's timezone
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

- **Post classification** (cheap model, 20 posts per call, `Output.object`): format, topic cluster, hook type, tone and stance. Cached per post and versioned.
- **Profile DNA** (mid-tier model, run weekly): voice descriptors, signature phrases, emoji and casing habits, typical length, core topics, *"what your audience rewards"* statements backed by real stats, and *"blind spots"*. Stored as versioned JSON and shown in the UI.

**Cold start** (<10 posts): personal stats are hidden. Generation relies on the goal playbook plus the bio. The UI shows a "confidence: low" chip.

---

## 5. AI generation and model configuration

### Should you use AI Gateway? Yes.
- **One key, any model.** Models are just strings (`provider/model`), so switching is a setting, not a deploy.
- **No key in production.** On Vercel it authenticates via OIDC. Locally, `vercel env pull` gives you a token, or set `AI_GATEWAY_API_KEY`.
- **Fallbacks and routing** through `providerOptions.gateway`: `models` is a fallback list, `order`/`only` control provider routing, and `user`/`tags` attribute spend to a user and task.
- **Live model catalog** via `gateway.getAvailableModels()`, which includes pricing and model type. This powers the model picker.
- **Spend reports** via `gateway.getSpendReport()`, grouped by user, tag or model. This enables per-user cost caps later.

Alternatives: OpenRouter (similar, but not Vercel-native), or direct provider SDKs (lose hot-swapping and fallbacks). Neither is worth it here.

### Model registry: per task, overridable at three levels

Precedence is **user setting → env var → code default**. Models are only selectable from an admin allow-list.

```ts
// lib/ai/models.ts
export type AiTask = 'classify' | 'dna' | 'generate' | 'critique';

// Example IDs only: confirm against gateway.getAvailableModels()
const DEFAULTS: Record<AiTask, string> = {
  classify: process.env.AI_MODEL_CLASSIFY ?? 'anthropic/claude-haiku-5.5',
  dna:      process.env.AI_MODEL_DNA      ?? 'anthropic/claude-sonnet-5.5',
  generate: process.env.AI_MODEL_GENERATE ?? 'anthropic/claude-sonnet-5.5',
  critique: process.env.AI_MODEL_CRITIQUE ?? 'anthropic/claude-haiku-5.5',
};

export function resolveModel(task: AiTask, user: { id: string; modelOverrides?: Partial<Record<AiTask, string>> }) {
  const model = user.modelOverrides?.[task] ?? DEFAULTS[task];
  return {
    model,
    providerOptions: {
      gateway: { models: fallbacksFor(task, model), user: user.id, tags: [`task:${task}`] },
    },
  };
}
```

- **Allow-list:** `AI_ALLOWED_MODELS` (comma-separated), intersected with the live gateway catalog. The catalog is cached in Redis for 1h.
- **Tasks:**
  - `classify`: fast and cheap
  - `dna`: good reasoning
  - `generate`: the best writer
  - `critique`: optional judge that reranks drafts by voice match and goal fit

### Generation contract

```ts
// lib/ai/schemas.ts
export const Suggestion = z.object({
  text: z.string(),                 // validated ≤ 500 chars after generation
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
const { model, providerOptions } = resolveModel('generate', user);
const result = streamText({
  model,
  providerOptions,
  instructions: buildInstructions({ goal, dna, playbook }),    // AI SDK 7 renamed `system` to `instructions`
  prompt: buildPrompt({ exemplars, avoid, recentPosts, steer, count }),
  output: Output.object({ schema: SuggestionBatch }),
  onFinish: ({ output, usage }) => saveGeneration(user, goal, model, output, usage),
});
return result.toTextStreamResponse();
// Client: experimental_useObject({ api: '/api/generate', schema: SuggestionBatch })
```

**Prompt context:**
- Goal playbook
- Profile DNA (the voice guide)
- Top and bottom exemplars for the goal
- Last 20 posts (so suggestions don't repeat them)
- Timing stats
- User steer: topic, a "spice" level from 0 to 3, length, emoji on/off, banned words

**Post-processing:**
- Enforce the 500-char limit (trim or regenerate)
- Drop near-duplicates of past posts (trigram similarity)
- Optionally run a `critique` pass that reranks the drafts

**Prompts are versioned files** (`lib/ai/prompts/generate.v3.ts`). Each generation records `promptVersion` and `model`, so results can be compared later.

### Feedback loop

When a suggestion gets posted, we track how it performs against your baseline. We know it was posted either because it went out via direct publish (Phase 3), or because the next sync fuzzy-matches a new post to it. This feeds a **"Suggestion scorecard"** and moves winning posts into the exemplar pool.

---

## 6. Data model (Drizzle, Postgres)

```
users            id, threads_user_id (unique), username, name, avatar_url, bio, is_verified, timezone, active_goal, created_at
threads_tokens   user_id, access_token_enc, expires_at, scopes[], last_refreshed_at
sessions         id (random 256-bit), user_id, expires_at, user_agent
posts            id (threads media id), user_id, text, media_type, permalink, posted_at, is_quote, topic_tag, char_count, has_link, has_question
post_metrics     post_id, captured_at, views, likes, replies, reposts, quotes, shares   ← snapshots, so we can see how fast a post picked up
post_features    post_id, version, format, topic, hook_type, tone, model
account_daily    user_id, date, views, likes, replies, reposts, quotes, clicks, followers_count
demographics     user_id, captured_at, breakdown (country|city|age|gender), data jsonb
profile_dna      user_id, version, data jsonb, model, generated_at
user_settings    user_id, model_overrides jsonb, voice_prefs jsonb (emoji, casing, banned_words, spice_default)
generations      id, user_id, goal, model, prompt_version, steer jsonb, usage jsonb, created_at
suggestions      id, generation_id, text, format, hook, rationale, goal_fit, best_slot, status (new|saved|dismissed|posted), posted_media_id, perf_vs_baseline
sync_runs        id, user_id, kind, status, step, stats jsonb, error, started_at, finished_at
```

**Security:**
- Tokens are encrypted with AES-256-GCM using `TOKEN_ENC_KEY`.
- Token, DB and AI modules import `server-only`, so they can't end up in client bundles.
- The OAuth `state` is kept in a signed, short-lived cookie.
- Disconnecting deletes tokens. The data-deletion callback deletes everything and returns the confirmation-code URL Meta expects.

---

## 7. UI/UX design

### 7a. Design language: "Monochrome + one living accent"

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

**Type:** Geist Sans for UI, Geist Mono for every number (tabular figures), and Instrument Serif italic for the big DNA-reveal headlines.

**Signature motif: the thread line.** Threads connects posts with a vertical line. We reuse it as a progress line, a connector between onboarding steps, and in post previews. It is always drawn in with SVG `pathLength`.

### 7b. Information architecture

```
/                    Landing + "Try a demo account"
/connect             What we read and why (trust screen) → Threads OAuth
/onboarding/analyzing   The Read (live sync progress)
/onboarding/dna         Your Profile DNA reveal
/onboarding/goal        Pick your goal
/home                Today: goal progress, 3 ready-to-post plays, best time today
/studio              Generate & refine suggestions
/insights            Deep analytics
/saved               Saved → Posted, with the suggestion scorecard
/settings            Models · Voice · Account & data
```

Navigation is a bottom tab bar on mobile (Home, Studio, Insights, Saved) and a collapsible left rail on desktop. A PWA manifest lets people install it next to the Threads app.

### 7c. Key screens

**Landing.** Scroll-linked hero (`useScroll`): sample post cards float in, and a thread line draws through them, linking them into a chain. Two CTAs: "Connect Threads" and "Try a demo account".

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
┌──────────────────────────────────────────────────────────┐
│ ◉ More Engagement ▾          Best time today: 7–8pm (in 3h12m) │
├──────────────┬──────────────┬──────────────┬─────────────┤
│ Eng. rate    │ Replies/post │ Views (7d)   │ Followers   │   ← count-up + sparkline draw-in
│ 4.8% ▲0.6    │ 12.3 ▲3.1    │ 18.2k ▼4%    │ 2,341 ▲38   │
├──────────────┴──────────────┴──────────────┴─────────────┤
│ Today's plays                               [Open Studio]│
│ ┌─ card ─┐ ┌─ card ─┐ ┌─ card ─┐   ← pre-generated overnight by the daily workflow
└──────────────────────────────────────────────────────────┘
```

**Studio: the core loop.**
```
┌── Controls ─────────────┐  ┌── Suggestions (stream in) ────────────────────────┐
│ Goal  [Fol|View|●Eng]   │  │ ┌──────────────────────────────┐  goal fit ◔ 86   │
│ Topic [ indie hacking ] │  │ │ (avatar) @you                │                  │
│ Spice ○──●──○──○        │  │ │ Unpopular opinion: your MVP  │  hook · question │
│ Format [any ▾]          │  │ │ doesn't need auth. ▍         │  best: Tue 7pm   │
│ Count  [ 5 ]            │  │ └──────────────────────────────┘                  │
│ Model  sonnet-5.5 ⚙     │  │ Why: your questions get 3.1× replies…  ▸          │
│ [ Generate ✦ ]          │  │ [Copy] [Edit] [Variant] [Save] [Post to Threads]  │
└─────────────────────────┘  └───────────────────────────────────────────────────┘
```
- **Cards are real streaming.** A skeleton card morphs into the content card, text appears as tokens arrive, and the goal-fit ring fills when the card completes.
- **Each card is a Threads-native preview.** It shows the avatar, the thread line and a 500-char counter ring.
- **Edit** opens the card into an editor sheet via shared `layoutId`. **Variant** regenerates that one card, and its text crossfades.
- **Mobile triage:** a swipe deck (`drag="x"`). Right saves, left dismisses, and the card tilts with the drag (`useTransform` from x to rotate).
- **Post:**
  - MVP: copy, or open `threads.net/intent/post?text=…`
  - Phase 3: publish now or schedule

**Insights:**
- Views over time and follower growth (annotated with your posts)
- The heatmap
- A format × topic matrix
- A sortable post table with outperformance badges
- Demographics (once eligible)
- Every chart has a plain-English "what this means" line.

**Settings → Models:**
- A dropdown per task, fed by the gateway catalog: name, provider, price per 1M tokens and context window
- A "Test this model" button that generates one suggestion side by side with your current model
- Reset to defaults

### 7d. Motion system

- **Springs, not easing curves:**
  - UI uses `{ type: 'spring', stiffness: 400, damping: 32 }`
  - Big reveals use `{ stiffness: 120, damping: 20 }`
  - Interactions finish in under 300ms
- **Choreography only at the magic moments:** The Read, the DNA reveal, Generate and the goal switch. Everything else stays calm.
- **Building blocks** (`components/motion/`):
  - `<CountUp>`, `<DrawPath>` (the thread line), `<StaggerList>`, `<Reveal>`
  - `<TiltCard>`, `<SwipeDeck>`, `<AccentAurora>`, `<GoalPill layoutId>`
- **Page transitions:** enter animations in `template.tsx`. Detail views use shared-element morphs.
- **Performance:**
  - `LazyMotion` + `m.*` with `domAnimation` by default; load `domMax` only where layout or drag is used
  - Animate only transform and opacity
- **Accessibility:**
  - `<MotionConfig reducedMotion="user">`
  - Streamed suggestions announce through `aria-live="polite"`
  - Full keyboard support for the swipe deck (←/→)
  - Visible focus rings in the accent color

---

## 8. Project structure

```
app/
  (marketing)/page.tsx, connect/page.tsx
  (app)/layout.tsx                      session guard, nav, goal pill, accent theme
  (app)/onboarding/{analyzing,dna,goal}/page.tsx
  (app)/{home,studio,insights,saved}/page.tsx
  (app)/settings/{models,voice,account}/page.tsx
  api/auth/threads/{start,callback}/route.ts
  api/threads/{uninstall,delete}/route.ts
  api/generate/route.ts
  api/sync/[runId]/route.ts             progress (SSE or poll)
  api/cron/daily/route.ts
workflows/{initial-sync,daily-refresh,build-dna}.ts
lib/
  threads/{client,oauth,types}.ts, threads/fixtures/   typed client + demo data
  analysis/{metrics,scoring,timing,aggregates}.ts      pure functions
  ai/{models,schemas,generate,classify,dna}.ts, ai/prompts/*.vN.ts
  auth/{session,crypto,signed-request}.ts
  db/{schema,index}.ts
components/{ui,motion,charts,studio,dna,home}/
evals/                                  prompt and model eval harness
```

---

## 9. Quality, demo mode and evals

- **Demo mode.** A "Try a demo account" button loads realistic fixture data (3 personas: small creator, mid-size niche account, large brand) with no Meta login. It's the default on preview deployments. This unblocks development before App Review and gives Meta reviewers a working flow.
- **Unit tests (Vitest):** the analysis and scoring functions (most of the logic), token refresh timing and signed-request verification.
- **E2E (Playwright, against demo mode):** onboarding → goal → generate → save.
- **Prompt/model evals (`pnpm eval`):** run the fixture personas through `generate`, then have a judge model score voice match, goal fit, ≤500-char compliance and repetition. Re-run this whenever you change a prompt or a default model. It's how you'll know a cheaper model is good enough.
- **CI:** typecheck, Biome, Vitest and Playwright on every PR. Vercel previews come with a Neon branch.

---

## 10. Environment

```
THREADS_APP_ID, THREADS_APP_SECRET, THREADS_REDIRECT_URI
TOKEN_ENC_KEY            # 32-byte base64
SESSION_SECRET
DATABASE_URL             # Neon (Marketplace injects)
KV_REST_API_URL, KV_REST_API_TOKEN          # Upstash (Marketplace injects)
AI_GATEWAY_API_KEY       # local only; production uses Vercel OIDC
AI_MODEL_CLASSIFY, AI_MODEL_DNA, AI_MODEL_GENERATE, AI_MODEL_CRITIQUE
AI_ALLOWED_MODELS
CRON_SECRET
DEMO_MODE                # 1 on previews
```

Threads OAuth needs exact HTTPS redirect URIs. Register production plus one fixed dev alias (or an ngrok/cloudflared tunnel). Use demo mode on previews.

---

## 11. Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **0: Setup** | Meta app (Threads use case, testers, callbacks), **submit App Review early**, Vercel project + Neon + Upstash + AI Gateway, scaffold, design tokens, motion primitives, demo fixtures | Demo account renders the Home shell |
| **1: MVP** | OAuth + sessions, initial sync workflow, deterministic stats, goal picker, Studio with streaming suggestions, copy / open in Threads, model settings + allow-list, rate limits | A tester connects a real account and gets on-voice suggestions for each goal |
| **2: Intelligence + polish** | LLM classification + Profile DNA, The Read + DNA reveal choreography, Insights page, daily cron (snapshots, token refresh, overnight "Today's plays"), Saved + scorecard, evals harness | Daily loop runs unattended; eval baseline recorded |
| **3: Act** | Direct publish + scheduling (`threads_content_publish`, Workflow sleep-until), keyword-search trend radar, reply analysis, A/B variants, weekly digest email | Suggestions can go from idea to posted to measured without leaving the app |
| **4: Business** | Stripe plans with generation credits (per-user spend from the gateway), multi-account for agencies, team seats | |

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| App Review delays or rejection | Start in Phase 0. Demo mode and tester accounts in the meantime. Clear screencast plus a privacy policy. |
| No per-post follower data | Daily snapshots + correlation, labeled "estimated". The Followers goal leans on amplification as its proxy. |
| Generic "AI-sounding" posts | Few-shot from the user's own top posts, a DNA voice guide, banned-phrase list, critique rerank, evals for voice match |
| Small or new accounts | Cold-start mode: playbook-led suggestions plus a low-confidence chip. Personal stats unlock at 10 or more posts. |
| Token expiry / private profiles | Daily refresh. Grants on private profiles can't be extended past 90 days, so prompt a reconnect 7 days before. |
| AI cost | Cheap model for classification, cached DNA, per-user rate limits, gateway spend reports by user |
| Threads API changes | One typed client module, response validation with Zod, and fixtures in contract tests |

---

## 13. Open decisions

1. **Publishing in v1?** Copy and open-in-Threads keeps App Review scope smaller. Direct publish and scheduling is the bigger product win. The plan puts it in Phase 3.
2. **Personal tool or multi-tenant SaaS?** This affects billing, multi-account support and how strict the per-user limits need to be.
3. **Who picks models?** The proposal is an admin allow-list plus a per-user choice within it. The alternative is admin-only.
