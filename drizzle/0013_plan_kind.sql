ALTER TABLE "workspaces" ADD COLUMN "plan_kind" text;--> statement-breakpoint
-- Every plan so far is the own-key one.
UPDATE "workspaces" SET "plan_kind" = 'own_key' WHERE "stripe_subscription_id" IS NOT NULL;
