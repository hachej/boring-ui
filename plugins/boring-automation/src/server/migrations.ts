import type postgres from "postgres"

/** Deployment-owned hosted schema registration for the automation plugin. */
export async function runBoringAutomationMigrations(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS boring_automation_automations (
      id uuid PRIMARY KEY,
      workspace_id text NOT NULL,
      owner_user_id text NOT NULL,
      title text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      cron text NOT NULL,
      timezone text NOT NULL,
      model text NOT NULL,
      prompt text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS boring_automation_automations_owner_idx
      ON boring_automation_automations (workspace_id, owner_user_id)
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS boring_automation_runs (
      id uuid PRIMARY KEY,
      automation_id uuid NOT NULL REFERENCES boring_automation_automations(id) ON DELETE CASCADE,
      workspace_id text NOT NULL,
      owner_user_id text NOT NULL,
      session_id text,
      status text NOT NULL,
      trigger text NOT NULL,
      scheduled_for timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      duration_ms integer,
      input_tokens integer,
      output_tokens integer,
      total_tokens integer,
      prompt_snapshot text NOT NULL,
      model_snapshot text NOT NULL,
      error text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT boring_automation_runs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      CONSTRAINT boring_automation_runs_trigger_check CHECK (trigger IN ('manual', 'scheduled'))
    )
  `)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS boring_automation_runs_automation_idx
      ON boring_automation_runs (automation_id, created_at DESC)
  `)
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS boring_automation_runs_active_once_idx
      ON boring_automation_runs (automation_id)
      WHERE status IN ('queued', 'running')
  `)
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS boring_automation_runs_scheduled_once_idx
      ON boring_automation_runs (automation_id, scheduled_for)
      WHERE trigger = 'scheduled' AND scheduled_for IS NOT NULL
  `)
}
