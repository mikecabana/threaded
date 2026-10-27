ALTER TABLE "generations" ADD COLUMN "research" jsonb;--> statement-breakpoint
-- Web research runs on the fast model by default (lib/ai/catalog.ts).
UPDATE "model_catalog" SET "tasks" = array_append("tasks", 'research'), "default_for" = array_append("default_for", 'research') WHERE "model_id" = 'anthropic/claude-haiku-5.5' AND NOT ('research' = ANY("tasks"));
