ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_default_agent_type_id_required_check"
  CHECK ("default_agent_type_id" IS NOT NULL) NOT VALID;
