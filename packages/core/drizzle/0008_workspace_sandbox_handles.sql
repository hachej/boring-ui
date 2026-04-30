-- Migration 0008: workspace-scoped sandbox handles
-- Adds DB-backed sandbox identity to workspace_runtimes.

ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "volume_path" text;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "last_error_op" text;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_provider" text;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_status" text;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_snapshot_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_created_at" timestamp;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_last_used_at" timestamp;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_last_seen_at" timestamp;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN IF NOT EXISTS "sandbox_expires_at" timestamp;
