ALTER TABLE "workspaces"
  ADD COLUMN "default_agent_type_id" text;
--> statement-breakpoint
ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_default_agent_type_id_check"
  CHECK ("default_agent_type_id" IS NULL OR "default_agent_type_id" ~ '^[a-z][a-z0-9-]{0,62}$');
