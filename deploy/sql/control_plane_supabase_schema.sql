-- Supabase/Postgres schema for boring-ui control-plane.
-- Ported from boring-sandbox migrations (core + invites + onboarding columns/settings).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL DEFAULT 'boring-ui',
  name TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  is_default BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_runtimes (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id),
  sprite_url TEXT,
  sprite_name TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provisioning_step TEXT,
  step_started_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  value BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_members_role_check'
      AND conrelid = 'workspace_members'::regclass
  ) THEN
    ALTER TABLE workspace_members
      ADD CONSTRAINT workspace_members_role_check
      CHECK (role IN ('owner', 'editor', 'viewer')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_runtimes_state_check'
      AND conrelid = 'workspace_runtimes'::regclass
  ) THEN
    ALTER TABLE workspace_runtimes
      ADD CONSTRAINT workspace_runtimes_state_check
      CHECK (state IN ('pending', 'provisioning', 'ready', 'error')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_invites_role_check'
      AND conrelid = 'workspace_invites'::regclass
  ) THEN
    ALTER TABLE workspace_invites
      ADD CONSTRAINT workspace_invites_role_check
      CHECK (role IN ('owner', 'editor', 'viewer')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspaces_app_id ON workspaces(app_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_created_by ON workspaces(created_by);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_default_per_user_app
  ON workspaces (created_by, app_id) WHERE is_default = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invites_token_hash ON workspace_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id ON workspace_invites(workspace_id);
