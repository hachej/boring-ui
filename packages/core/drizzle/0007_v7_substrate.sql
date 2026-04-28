-- Migration 0007: v7 substrate (boring-ui-v2-19jh)
-- State widening, provisioner columns, invite breaker columns, idempotency_keys, drop Fly columns

-- 1. Narrow workspace_runtimes state check to pending | ready | error
ALTER TABLE "workspace_runtimes"
  DROP CONSTRAINT "workspace_runtimes_state_check";
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD CONSTRAINT "workspace_runtimes_state_check"
    CHECK ("workspace_runtimes"."state" IN ('pending', 'ready', 'error'));
--> statement-breakpoint

-- 2. Add filesystem driver result + provision/destroy disambiguation columns
ALTER TABLE "workspace_runtimes"
  ADD COLUMN "volume_path" text;
--> statement-breakpoint
ALTER TABLE "workspace_runtimes"
  ADD COLUMN "last_error_op" text;
--> statement-breakpoint

-- 3. Add invite secondary rate-limit columns
ALTER TABLE "workspace_invites"
  ADD COLUMN "failed_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "workspace_invites"
  ADD COLUMN "locked_until" timestamp;
--> statement-breakpoint

-- 4. Drop SQL default on workspace_invites.expires_at
ALTER TABLE "workspace_invites"
  ALTER COLUMN "expires_at" DROP DEFAULT;
--> statement-breakpoint

-- 5. Drop Fly-specific columns from workspaces
ALTER TABLE "workspaces"
  DROP COLUMN "machine_id";
--> statement-breakpoint
ALTER TABLE "workspaces"
  DROP COLUMN "volume_id";
--> statement-breakpoint
ALTER TABLE "workspaces"
  DROP COLUMN "fly_region";
--> statement-breakpoint

-- 6. Create idempotency_keys table
CREATE TABLE "idempotency_keys" (
  "key" text PRIMARY KEY,
  "scope" text NOT NULL,
  "response_status" integer NOT NULL,
  "response_body" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");
