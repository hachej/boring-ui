-- Migration 0009: provider-agnostic workspace runtime resources
-- Adds a generic resource table for sandbox/session/volume/snapshot handles.

CREATE TABLE IF NOT EXISTS "workspace_runtime_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "purpose" text DEFAULT 'main' NOT NULL,
  "provider" text NOT NULL,
  "handle_kind" text NOT NULL,
  "stable_key" text,
  "provider_resource_id" text,
  "parent_resource_id" uuid,
  "state" text NOT NULL,
  "persistence_mode" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provider_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error" text,
  "last_error_code" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp,
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "generation" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_runtime_resources_active_idx"
  ON "workspace_runtime_resources" USING btree ("workspace_id", "kind", "purpose", "provider")
  WHERE "state" <> 'deleted';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_runtime_resources_workspace_kind_idx"
  ON "workspace_runtime_resources" USING btree ("workspace_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_runtime_resources_provider_stable_key_idx"
  ON "workspace_runtime_resources" USING btree ("provider", "stable_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_runtime_resources_provider_resource_id_idx"
  ON "workspace_runtime_resources" USING btree ("provider", "provider_resource_id");
