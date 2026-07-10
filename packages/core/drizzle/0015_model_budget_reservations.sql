CREATE TABLE IF NOT EXISTS "boring_model_budget_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text,
  "session_id" text,
  "run_id" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "period" text NOT NULL,
  "amount_micros" bigint NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "boring_model_budget_reservations_amount_check" CHECK ("boring_model_budget_reservations"."amount_micros" > 0),
  CONSTRAINT "boring_model_budget_reservations_status_check" CHECK ("boring_model_budget_reservations"."status" IN ('active', 'settled', 'released', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "boring_model_budget_reservations_active_user_run_idx" ON "boring_model_budget_reservations" USING btree ("user_id","run_id") WHERE "boring_model_budget_reservations"."status" = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boring_model_budget_reservations_budget_idx" ON "boring_model_budget_reservations" USING btree ("user_id","provider","model","period","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "boring_model_budget_reservations_stale_idx" ON "boring_model_budget_reservations" USING btree ("status","expires_at");
