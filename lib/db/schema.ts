// Database schema (docs/PLAN.md §8). Phase 0 defines it; Phase 1 starts
// reading and writing it. Money is stored in integer credits (1 credit = $0.01).

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);

export const goalEnum = pgEnum("goal", ["followers", "views", "engagement"]);
export const billingModeEnum = pgEnum("billing_mode", ["credits", "byok"]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);
export const suggestionStatusEnum = pgEnum("suggestion_status", ["new", "saved", "dismissed", "scheduled", "posted"]);
export const scheduledStatusEnum = pgEnum("scheduled_status", [
  "scheduled",
  "publishing",
  "published",
  "failed",
  "canceled",
]);
export const ledgerKindEnum = pgEnum("ledger_kind", [
  "purchase",
  "trial",
  "reserve",
  "settle",
  "release",
  "refund",
  "adjust",
  "expire",
]);
export const syncKindEnum = pgEnum("sync_kind", ["initial", "daily", "manual"]);
export const syncStatusEnum = pgEnum("sync_status", ["running", "succeeded", "failed"]);

// ── Tenancy ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  /** Login identity in the MVP (Threads OAuth). */
  threadsUserId: text("threads_user_id").notNull().unique(),
  /** Threads doesn't share email; we ask during onboarding. */
  email: text("email"),
  isStaff: boolean("is_staff").notNull().default(false),
  createdAt: createdAt(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  billingMode: billingModeEnum("billing_mode").notNull().default("credits"),
  /** AES-256-GCM ciphertext, key-id prefixed. Never sent to the client. */
  byokKeyEnc: text("byok_key_enc"),
  byokKeyLast4: text("byok_key_last4"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  /** BYOK platform fee subscription. */
  stripeSubscriptionId: text("stripe_subscription_id"),
  autoRecharge: jsonb("auto_recharge").$type<{ enabled: boolean; thresholdCredits: number; packId: string }>(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

export const threadsProfiles = pgTable("threads_profiles", {
  /** The Threads user id. */
  id: text("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  name: text("name"),
  biography: text("biography"),
  profilePictureUrl: text("profile_picture_url"),
  isVerified: boolean("is_verified").notNull().default(false),
  timezone: text("timezone").notNull().default("UTC"),
  activeGoal: goalEnum("active_goal").notNull().default("engagement"),
  /** Set once per Threads account so trials can't be farmed. */
  trialGrantedAt: timestamp("trial_granted_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const threadsTokens = pgTable("threads_tokens", {
  profileId: text("profile_id")
    .primaryKey()
    .references(() => threadsProfiles.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes").array().notNull(),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the random 256-bit cookie value; the raw value is never stored. */
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ── Content & analytics ──────────────────────────────────────────────────────

export const posts = pgTable(
  "posts",
  {
    /** The Threads media id. */
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => threadsProfiles.id, { onDelete: "cascade" }),
    text: text("text").notNull().default(""),
    mediaType: text("media_type").notNull(),
    permalink: text("permalink"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    isQuotePost: boolean("is_quote_post").notNull().default(false),
    topicTag: text("topic_tag"),
    length: integer("length").notNull().default(0),
    hasLink: boolean("has_link").notNull().default(false),
    hasQuestion: boolean("has_question").notNull().default(false),
    /** Published through Threaded (links back to a suggestion via scheduled_posts). */
    viaThreaded: boolean("via_threaded").notNull().default(false),
  },
  (t) => [index("posts_profile_posted_idx").on(t.profileId, t.postedAt)],
);

export const postMetrics = pgTable(
  "post_metrics",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    views: integer("views").notNull(),
    likes: integer("likes").notNull(),
    replies: integer("replies").notNull(),
    reposts: integer("reposts").notNull(),
    quotes: integer("quotes").notNull(),
    shares: integer("shares").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.capturedAt] })],
);

export const postFeatures = pgTable(
  "post_features",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    format: text("format").notNull(),
    topic: text("topic"),
    hookType: text("hook_type"),
    tone: text("tone"),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.version] })],
);

export const accountDaily = pgTable(
  "account_daily",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => threadsProfiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    views: integer("views").notNull(),
    likes: integer("likes").notNull(),
    replies: integer("replies").notNull(),
    reposts: integer("reposts").notNull(),
    quotes: integer("quotes").notNull(),
    clicks: integer("clicks"),
    /** Our own daily snapshot; Threads only exposes the current total. */
    followersCount: integer("followers_count"),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.date] })],
);

export const demographics = pgTable("demographics", {
  id: id(),
  profileId: text("profile_id")
    .notNull()
    .references(() => threadsProfiles.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  breakdown: text("breakdown").notNull(),
  data: jsonb("data").notNull(),
});

export const profileDna = pgTable(
  "profile_dna",
  {
    profileId: text("profile_id")
      .notNull()
      .references(() => threadsProfiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    data: jsonb("data").notNull(),
    model: text("model").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.version] })],
);

// ── AI ───────────────────────────────────────────────────────────────────────

export const modelCatalog = pgTable("model_catalog", {
  /** Gateway model id, e.g. "anthropic/…". */
  modelId: text("model_id").primaryKey(),
  label: text("label").notNull(),
  provider: text("provider").notNull(),
  tier: text("tier", { enum: ["fast", "balanced", "best"] }).notNull(),
  tasks: text("tasks").array().notNull(),
  defaultFor: text("default_for").array().notNull().default(sql`'{}'::text[]`),
  markup: numeric("markup", { precision: 4, scale: 2 }).notNull().default("1.50"),
  minCredits: integer("min_credits").notNull().default(1),
  /** USD per million tokens, synced nightly from the Gateway catalog. */
  inputPrice: numeric("input_price", { precision: 10, scale: 4 }),
  outputPrice: numeric("output_price", { precision: 10, scale: 4 }),
  enabled: boolean("enabled").notNull().default(true),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  modelPicks: jsonb("model_picks").$type<Partial<Record<"classify" | "dna" | "generate" | "critique", string>>>(),
  voicePrefs: jsonb("voice_prefs").$type<{
    emoji?: "none" | "some" | "lots";
    casing?: "normal" | "lowercase";
    bannedWords?: string[];
    spiceDefault?: number;
  }>(),
});

export const generations = pgTable(
  "generations",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => threadsProfiles.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    goal: goalEnum("goal").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    steer: jsonb("steer"),
    usage: jsonb("usage"),
    gatewayGenerationId: text("gateway_generation_id"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    creditsCharged: integer("credits_charged").notNull().default(0),
    billingMode: billingModeEnum("billing_mode").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("generations_profile_idx").on(t.profileId, t.createdAt)],
);

export const suggestions = pgTable(
  "suggestions",
  {
    id: id(),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    format: text("format").notNull(),
    hook: text("hook"),
    rationale: text("rationale"),
    goalFit: integer("goal_fit"),
    bestSlot: jsonb("best_slot").$type<{ weekday: number; hour: number }>(),
    status: suggestionStatusEnum("status").notNull().default("new"),
    postedMediaId: text("posted_media_id").references(() => posts.id, { onDelete: "set null" }),
    /** Views vs. the profile's median at +72h, filled by the scorecard job. */
    perfVsBaseline: numeric("perf_vs_baseline", { precision: 8, scale: 3 }),
    createdAt: createdAt(),
  },
  (t) => [index("suggestions_generation_idx").on(t.generationId)],
);

// ── Billing ──────────────────────────────────────────────────────────────────

export const wallets = pgTable("wallets", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** Spendable credits (reservations already subtracted). */
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  reserved: bigint("reserved", { mode: "number" }).notNull().default(0),
});

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    /** Signed change to the spendable balance. */
    delta: bigint("delta", { mode: "number" }).notNull(),
    kind: ledgerKindEnum("kind").notNull(),
    /** Idempotency reference: Stripe event id, generation id, etc. */
    ref: text("ref").notNull(),
    generationId: uuid("generation_id").references(() => generations.id, { onDelete: "set null" }),
    /** For purchases: when these credits expire. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_ledger_kind_ref_idx").on(t.kind, t.ref),
    index("credit_ledger_workspace_idx").on(t.workspaceId, t.createdAt),
  ],
);

// ── Publishing & jobs ────────────────────────────────────────────────────────

export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => threadsProfiles.id, { onDelete: "cascade" }),
    suggestionId: uuid("suggestion_id").references(() => suggestions.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    topicTag: text("topic_tag"),
    /** Previous part of a series; published with reply_to_id. */
    replyToScheduledId: uuid("reply_to_scheduled_id"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: scheduledStatusEnum("status").notNull().default("scheduled"),
    containerId: text("container_id"),
    mediaId: text("media_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    workflowRunId: text("workflow_run_id"),
    createdAt: createdAt(),
  },
  (t) => [index("scheduled_posts_due_idx").on(t.status, t.scheduledFor)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    profileId: text("profile_id")
      .notNull()
      .references(() => threadsProfiles.id, { onDelete: "cascade" }),
    kind: syncKindEnum("kind").notNull(),
    status: syncStatusEnum("status").notNull().default("running"),
    step: text("step"),
    stats: jsonb("stats"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_runs_profile_idx").on(t.profileId, t.startedAt)],
);
