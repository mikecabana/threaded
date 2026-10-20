ALTER TABLE "generations" ADD COLUMN "status" text DEFAULT 'running' NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "dropped" integer DEFAULT 0 NOT NULL;