CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Migrate legacy bootstrap table names to the hosted-control-plane names.
DO $$
BEGIN
    IF to_regclass('public.workspace_members') IS NULL
       AND to_regclass('public.members') IS NOT NULL THEN
        ALTER TABLE public.members RENAME TO workspace_members;
    END IF;

    IF to_regclass('public.workspace_invites') IS NULL
       AND to_regclass('public.invites') IS NOT NULL THEN
        ALTER TABLE public.invites RENAME TO workspace_invites;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    app_id TEXT NOT NULL DEFAULT 'boring-ui',
    created_by UUID NOT NULL,
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    machine_id TEXT NULL,
    volume_id TEXT NULL,
    fly_region TEXT NOT NULL DEFAULT 'cdg',
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspaces'
          AND column_name = 'id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspaces
            ALTER COLUMN id TYPE uuid USING id::uuid;
    END IF;
END $$;

ALTER TABLE workspaces
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT 'boring-ui',
    ADD COLUMN IF NOT EXISTS created_by UUID,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS machine_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS volume_id TEXT NULL,
    ADD COLUMN IF NOT EXISTS fly_region TEXT NOT NULL DEFAULT 'cdg',
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE workspaces
SET created_by = '00000000-0000-0000-0000-000000000000'::uuid
WHERE created_by IS NULL;

ALTER TABLE workspaces
    ALTER COLUMN created_by SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_default_owner_app
    ON workspaces (created_by, app_id)
    WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_members'
          AND column_name = 'workspace_id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspace_members
            ALTER COLUMN workspace_id TYPE uuid USING workspace_id::uuid;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_members'
          AND column_name = 'user_id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspace_members
            ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
    END IF;
END $$;

ALTER TABLE workspace_members
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.workspace_members'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE public.workspace_members
            ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspace_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'editor',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    accepted_at TIMESTAMPTZ NULL,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_invites'
          AND column_name = 'id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspace_invites
            ALTER COLUMN id TYPE uuid USING id::uuid;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_invites'
          AND column_name = 'workspace_id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspace_invites
            ALTER COLUMN workspace_id TYPE uuid USING workspace_id::uuid;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_invites'
          AND column_name = 'created_by'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspace_invites
            ALTER COLUMN created_by TYPE uuid USING created_by::uuid;
    END IF;
END $$;

ALTER TABLE workspace_invites
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE workspace_invites
    ADD COLUMN IF NOT EXISTS workspace_id UUID,
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS token_hash TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'editor',
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS created_by UUID,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS workspace_runtimes (
    workspace_id UUID PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'pending',
    sprite_url TEXT NULL,
    sprite_name TEXT NULL,
    last_error TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    provisioning_step TEXT NULL,
    step_started_at TIMESTAMPTZ NULL
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_runtimes'
          AND column_name = 'runtime'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_runtimes'
          AND column_name = 'state'
    ) THEN
        ALTER TABLE public.workspace_runtimes
            RENAME COLUMN runtime TO state;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_runtimes'
          AND column_name = 'workspace_id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspace_runtimes
            ALTER COLUMN workspace_id TYPE uuid USING workspace_id::uuid;
    END IF;
END $$;

ALTER TABLE workspace_runtimes
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS sprite_url TEXT NULL,
    ADD COLUMN IF NOT EXISTS sprite_name TEXT NULL,
    ADD COLUMN IF NOT EXISTS last_error TEXT NULL,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS provisioning_step TEXT NULL,
    ADD COLUMN IF NOT EXISTS step_started_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS workspace_settings (
    workspace_id UUID NOT NULL,
    key TEXT NOT NULL,
    value BYTEA,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, key)
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'workspace_settings'
          AND column_name = 'workspace_id'
          AND data_type <> 'uuid'
    ) THEN
        ALTER TABLE public.workspace_settings
            ALTER COLUMN workspace_id TYPE uuid USING workspace_id::uuid;
    END IF;
END $$;

ALTER TABLE workspace_settings
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
