CREATE TABLE IF NOT EXISTS "boring_credit_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "amount_micros" bigint NOT NULL,
  "reason" text NOT NULL,
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "boring_credit_grants_amount_check" CHECK ("amount_micros" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "boring_credit_grants_user_reason_idx" ON "boring_credit_grants" USING btree ("user_id", "reason");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boring_usage_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text,
  "session_id" text,
  "turn_id" text NOT NULL,
  "source" text DEFAULT '' NOT NULL,
  "amount_micros" bigint NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "boring_usage_reservations_amount_check" CHECK ("amount_micros" > 0),
  CONSTRAINT "boring_usage_reservations_status_check" CHECK ("status" IN ('active', 'settled', 'released', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "boring_usage_reservations_active_turn_idx" ON "boring_usage_reservations" USING btree ("turn_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boring_usage_reservations_user_status_idx" ON "boring_usage_reservations" USING btree ("user_id", "status", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boring_usage_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text,
  "session_id" text,
  "turn_id" text,
  "message_id" text,
  "source" text DEFAULT '' NOT NULL,
  "provider" text,
  "model" text,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
  "cache_write_tokens" bigint DEFAULT 0 NOT NULL,
  "provider_cost_micros" bigint DEFAULT 0 NOT NULL,
  "billed_cost_micros" bigint NOT NULL,
  "stop_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "boring_usage_ledger_billed_check" CHECK ("billed_cost_micros" >= 0),
  CONSTRAINT "boring_usage_ledger_tokens_check" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "cache_read_tokens" >= 0 AND "cache_write_tokens" >= 0 AND "provider_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boring_usage_ledger_user_created_idx" ON "boring_usage_ledger" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boring_usage_ledger_turn_idx" ON "boring_usage_ledger" USING btree ("turn_id");
