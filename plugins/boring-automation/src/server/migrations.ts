import type postgres from "postgres"
import { AUTOMATION_RUN_OCCUPYING_STATUSES_SQL, AUTOMATION_RUN_STATUSES_SQL } from "../shared/runStatus"
import { MAX_AUTOMATION_RUN_DURATION_CAP_MS } from "../shared/schedule"

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
      agent_type_id text,
      run_duration_cap_ms integer,
      prompt_ref text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `)
  await sql.unsafe(`
    ALTER TABLE boring_automation_automations
      ADD COLUMN IF NOT EXISTS agent_type_id text,
      ADD COLUMN IF NOT EXISTS run_duration_cap_ms integer,
      ADD COLUMN IF NOT EXISTS prompt_ref text,
      ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
      DROP COLUMN IF EXISTS prompt,
      DROP COLUMN IF EXISTS prompt_file_ready
  `)
  await sql.unsafe(`
    DO $$ BEGIN
      ALTER TABLE boring_automation_automations
        ADD CONSTRAINT boring_automation_run_duration_cap_range_check
        CHECK (run_duration_cap_ms IS NULL OR run_duration_cap_ms BETWEEN 1 AND ${MAX_AUTOMATION_RUN_DURATION_CAP_MS});
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `)
  await sql.unsafe(`
    UPDATE boring_automation_automations
    SET prompt_ref = COALESCE(prompt_ref, '.agents/automation/' || id::text || '.md')
    WHERE prompt_ref IS NULL
  `)
  await sql.unsafe(`
    ALTER TABLE boring_automation_automations
      ALTER COLUMN cron DROP NOT NULL,
      ALTER COLUMN prompt_ref SET NOT NULL
  `)
  await sql.unsafe(`DROP INDEX IF EXISTS boring_automation_automations_owner_idx`)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS boring_automation_automations_active_owner_idx
      ON boring_automation_automations (workspace_id, owner_user_id)
      WHERE deleted_at IS NULL
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
    ALTER TABLE boring_automation_runs
      ADD COLUMN IF NOT EXISTS invocation_id text,
      ADD COLUMN IF NOT EXISTS dispatch_request_id text,
      ADD COLUMN IF NOT EXISTS dispatch_receipt jsonb
  `)
  await sql.unsafe(`
    UPDATE boring_automation_runs
    SET invocation_id = COALESCE(invocation_id, 'legacy:' || id::text),
        dispatch_request_id = COALESCE(dispatch_request_id, id::text)
    WHERE invocation_id IS NULL OR dispatch_request_id IS NULL
  `)
  await sql.unsafe(`
    ALTER TABLE boring_automation_runs
      ALTER COLUMN invocation_id SET NOT NULL,
      ALTER COLUMN dispatch_request_id SET NOT NULL,
      DROP CONSTRAINT IF EXISTS boring_automation_runs_status_check
  `)
  await sql.unsafe(`
    ALTER TABLE boring_automation_runs
      ADD CONSTRAINT boring_automation_runs_status_check
      CHECK (status IN (${AUTOMATION_RUN_STATUSES_SQL}))
  `)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS boring_automation_runs_automation_idx
      ON boring_automation_runs (automation_id, created_at DESC)
  `)
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`LOCK TABLE boring_automation_runs IN SHARE ROW EXCLUSIVE MODE`)
    await transaction.unsafe(`
      WITH ranked_occupants AS (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY automation_id
            ORDER BY updated_at DESC, created_at DESC, id DESC
          ) AS occupancy_rank
        FROM boring_automation_runs
        WHERE status IN (${AUTOMATION_RUN_OCCUPYING_STATUSES_SQL})
      )
      UPDATE boring_automation_runs AS runs
      SET status = 'failed',
          completed_at = COALESCE(runs.completed_at, NOW()),
          error = 'Migration reconciled duplicate potentially-live run; a newer run retained the automation slot',
          updated_at = NOW()
      FROM ranked_occupants
      WHERE runs.id = ranked_occupants.id
        AND ranked_occupants.occupancy_rank > 1
    `)
    await transaction.unsafe(`DROP INDEX IF EXISTS boring_automation_runs_active_once_idx`)
    await transaction.unsafe(`
      CREATE UNIQUE INDEX boring_automation_runs_active_once_idx
        ON boring_automation_runs (automation_id)
        WHERE status IN (${AUTOMATION_RUN_OCCUPYING_STATUSES_SQL})
    `)
  })
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS boring_automation_runs_invocation_once_idx
      ON boring_automation_runs (automation_id, invocation_id)
  `)
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS boring_automation_runs_scheduled_once_idx
      ON boring_automation_runs (automation_id, scheduled_for)
      WHERE trigger = 'scheduled' AND scheduled_for IS NOT NULL
  `)
}
