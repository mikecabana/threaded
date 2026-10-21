ALTER TABLE "scheduled_posts" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "permalink" text;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "publishing_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "scheduled_posts_profile_idx" ON "scheduled_posts" USING btree ("profile_id","scheduled_for");