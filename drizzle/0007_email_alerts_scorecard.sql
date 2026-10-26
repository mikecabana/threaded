CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads_tokens" ADD COLUMN "granted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "threads_tokens" ADD COLUMN "data_access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads_tokens" ADD COLUMN "access_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_log_once_idx" ON "email_log" USING btree ("user_id","kind","ref");--> statement-breakpoint
CREATE INDEX "suggestions_posted_media_idx" ON "suggestions" USING btree ("posted_media_id");--> statement-breakpoint
-- Existing connections: the profile's first connection is the best guess at when access was granted.
UPDATE "threads_tokens" SET "granted_at" = "threads_profiles"."created_at" FROM "threads_profiles" WHERE "threads_profiles"."id" = "threads_tokens"."profile_id";
