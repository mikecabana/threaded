ALTER TABLE "model_catalog" ALTER COLUMN "markup" SET DEFAULT '2.00';--> statement-breakpoint
-- Models still on the old default go to the new one; a markup set by hand in /admin stays.
UPDATE "model_catalog" SET "markup" = '2.00' WHERE "markup" = '1.50';
