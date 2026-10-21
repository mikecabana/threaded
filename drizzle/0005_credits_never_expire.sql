-- Credits never expire. Nothing is deployed yet, so the columns are dropped in one
-- step; with live traffic, stop writing them first and drop them a release later.
DROP INDEX "credit_lots_workspace_idx";--> statement-breakpoint
CREATE INDEX "credit_lots_workspace_idx" ON "credit_lots" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "credit_lots" DROP COLUMN "expires_at";