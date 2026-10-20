CREATE TABLE "deletion_requests" (
	"confirmation_code" text PRIMARY KEY NOT NULL,
	"threads_user_id_hash" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
