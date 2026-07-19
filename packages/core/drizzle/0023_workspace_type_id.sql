ALTER TABLE "workspaces"
  ADD COLUMN "workspace_type_id" text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_workspace_type_id_check"
  CHECK ("workspace_type_id" ~ '^[a-z][a-z0-9-]{0,62}$');
