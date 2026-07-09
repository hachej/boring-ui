ALTER TABLE "boring_model_budget_reservations" RENAME TO "boring_budget_reservations";--> statement-breakpoint
ALTER TABLE "boring_budget_reservations" RENAME CONSTRAINT "boring_model_budget_reservations_amount_check" TO "boring_budget_reservations_amount_check";--> statement-breakpoint
ALTER TABLE "boring_budget_reservations" RENAME CONSTRAINT "boring_model_budget_reservations_status_check" TO "boring_budget_reservations_status_check";--> statement-breakpoint
ALTER TABLE "boring_budget_reservations" ADD COLUMN "scope" text DEFAULT 'model' NOT NULL;--> statement-breakpoint
ALTER TABLE "boring_budget_reservations" ALTER COLUMN "provider" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "boring_budget_reservations" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "boring_budget_reservations" ADD CONSTRAINT "boring_budget_reservations_scope_check" CHECK ("scope" IN ('model', 'user'));--> statement-breakpoint
ALTER TABLE "boring_budget_reservations" ADD CONSTRAINT "boring_budget_reservations_scope_shape_check" CHECK (("scope" = 'model' AND "provider" IS NOT NULL AND length(btrim("provider")) > 0 AND "model" IS NOT NULL AND length(btrim("model")) > 0) OR ("scope" = 'user' AND "provider" IS NULL AND "model" IS NULL));--> statement-breakpoint
DROP INDEX IF EXISTS "boring_model_budget_reservations_active_user_run_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "boring_model_budget_reservations_budget_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "boring_model_budget_reservations_stale_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "boring_budget_reservations_active_user_run_idx" ON "boring_budget_reservations" USING btree ("scope","user_id","run_id") WHERE "boring_budget_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "boring_budget_reservations_budget_idx" ON "boring_budget_reservations" USING btree ("scope","user_id","provider","model","period","status");--> statement-breakpoint
CREATE INDEX "boring_budget_reservations_user_budget_idx" ON "boring_budget_reservations" USING btree ("scope","user_id","period","status");--> statement-breakpoint
CREATE INDEX "boring_budget_reservations_stale_idx" ON "boring_budget_reservations" USING btree ("status","expires_at");
