ALTER TABLE "credit_ledger" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "model_catalog" ADD COLUMN "available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Until now the nightly sync set `enabled` from the Gateway list; that is what `available` means now.
UPDATE "model_catalog" SET "available" = "enabled", "enabled" = true;
