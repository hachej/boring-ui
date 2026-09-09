-- Reserve idempotency keys before effects; NULL responses remain unresolved.
-- Existing cached responses stay intact and expire through the regular sweep.
ALTER TABLE "idempotency_keys" ADD COLUMN "request_hash" text;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "response_status" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "response_body" DROP NOT NULL;
