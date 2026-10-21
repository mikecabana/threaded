CREATE TYPE "public"."billing_mode" AS ENUM('credits', 'byok');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('followers', 'views', 'engagement');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('purchase', 'trial', 'reserve', 'settle', 'release', 'refund', 'adjust', 'expire');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."scheduled_status" AS ENUM('scheduled', 'publishing', 'published', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('new', 'saved', 'dismissed', 'scheduled', 'posted');--> statement-breakpoint
CREATE TYPE "public"."sync_kind" AS ENUM('initial', 'daily', 'manual');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "account_daily" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"views" integer NOT NULL,
	"likes" integer NOT NULL,
	"replies" integer NOT NULL,
	"reposts" integer NOT NULL,
	"quotes" integer NOT NULL,
	"clicks" integer,
	"followers_count" integer,
	CONSTRAINT "account_daily_profile_id_date_pk" PRIMARY KEY("profile_id","date")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"delta" bigint NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"ref" text NOT NULL,
	"generation_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demographics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"breakdown" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"user_id" uuid,
	"goal" "goal" NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"steer" jsonb,
	"usage" jsonb,
	"gateway_generation_id" text,
	"cost_usd" numeric(12, 6),
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"billing_mode" "billing_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "model_catalog" (
	"model_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"provider" text NOT NULL,
	"tier" text NOT NULL,
	"tasks" text[] NOT NULL,
	"default_for" text[] DEFAULT '{}'::text[] NOT NULL,
	"markup" numeric(4, 2) DEFAULT '1.50' NOT NULL,
	"min_credits" integer DEFAULT 1 NOT NULL,
	"input_price" numeric(10, 4),
	"output_price" numeric(10, 4),
	"enabled" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "post_features" (
	"post_id" text NOT NULL,
	"version" integer NOT NULL,
	"format" text NOT NULL,
	"topic" text,
	"hook_type" text,
	"tone" text,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_features_post_id_version_pk" PRIMARY KEY("post_id","version")
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"post_id" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" integer NOT NULL,
	"likes" integer NOT NULL,
	"replies" integer NOT NULL,
	"reposts" integer NOT NULL,
	"quotes" integer NOT NULL,
	"shares" integer NOT NULL,
	CONSTRAINT "post_metrics_post_id_captured_at_pk" PRIMARY KEY("post_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"media_type" text NOT NULL,
	"permalink" text,
	"posted_at" timestamp with time zone NOT NULL,
	"is_quote_post" boolean DEFAULT false NOT NULL,
	"topic_tag" text,
	"length" integer DEFAULT 0 NOT NULL,
	"has_link" boolean DEFAULT false NOT NULL,
	"has_question" boolean DEFAULT false NOT NULL,
	"via_threaded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_dna" (
	"profile_id" text NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_dna_profile_id_version_pk" PRIMARY KEY("profile_id","version")
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"suggestion_id" uuid,
	"text" text NOT NULL,
	"topic_tag" text,
	"reply_to_scheduled_id" uuid,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "scheduled_status" DEFAULT 'scheduled' NOT NULL,
	"container_id" text,
	"media_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"workflow_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"text" text NOT NULL,
	"format" text NOT NULL,
	"hook" text,
	"rationale" text,
	"goal_fit" integer,
	"best_slot" jsonb,
	"status" "suggestion_status" DEFAULT 'new' NOT NULL,
	"posted_media_id" text,
	"perf_vs_baseline" numeric(8, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"kind" "sync_kind" NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"step" text,
	"stats" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "threads_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"username" text NOT NULL,
	"name" text,
	"biography" text,
	"profile_picture_url" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"active_goal" "goal" DEFAULT 'engagement' NOT NULL,
	"trial_granted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads_tokens" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	"last_refreshed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"model_picks" jsonb,
	"voice_prefs" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"threads_user_id" text NOT NULL,
	"email" text,
	"is_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_threads_user_id_unique" UNIQUE("threads_user_id")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"billing_mode" "billing_mode" DEFAULT 'credits' NOT NULL,
	"byok_key_enc" text,
	"byok_key_last4" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"auto_recharge" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
ALTER TABLE "account_daily" ADD CONSTRAINT "account_daily_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demographics" ADD CONSTRAINT "demographics_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_features" ADD CONSTRAINT "post_features_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_dna" ADD CONSTRAINT "profile_dna_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_posted_media_id_posts_id_fk" FOREIGN KEY ("posted_media_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads_profiles" ADD CONSTRAINT "threads_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads_tokens" ADD CONSTRAINT "threads_tokens_profile_id_threads_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."threads_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_kind_ref_idx" ON "credit_ledger" USING btree ("kind","ref");--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_idx" ON "credit_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "generations_profile_idx" ON "generations" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_profile_posted_idx" ON "posts" USING btree ("profile_id","posted_at");--> statement-breakpoint
CREATE INDEX "scheduled_posts_due_idx" ON "scheduled_posts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "suggestions_generation_idx" ON "suggestions" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "sync_runs_profile_idx" ON "sync_runs" USING btree ("profile_id","started_at");