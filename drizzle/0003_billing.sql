CREATE TABLE "credit_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ledger_id" uuid,
	"amount" bigint NOT NULL,
	"remaining" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "subscription_status" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "subscription_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "subscription_cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "auto_recharge_pending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_notice" jsonb;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_ledger_id_credit_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."credit_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_lots_workspace_idx" ON "credit_lots" USING btree ("workspace_id","expires_at");--> statement-breakpoint
-- Credits granted before lots existed (trials) become one lot per wallet, expiring like a fresh purchase.
INSERT INTO "credit_lots" ("workspace_id", "amount", "remaining", "expires_at")
SELECT "workspace_id", "balance" + "reserved", "balance" + "reserved", now() + interval '12 months'
FROM "wallets" WHERE "balance" + "reserved" > 0;
