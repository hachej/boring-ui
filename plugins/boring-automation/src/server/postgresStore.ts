import { randomUUID } from "node:crypto"
import type postgres from "postgres"
import type { Automation, AutomationCreate, AutomationPatch, AutomationRun, AutomationRunBegin, AutomationRunLifecyclePatch } from "../shared/types"
import { automationNotFound, runAlreadyActive, runAlreadyRecorded, runNotFound, type AutomationStore } from "./store"

export interface HostedAutomationActor {
  workspaceId: string
  userId: string
}

export type HostedAutomationRunEvidence = Pick<AutomationRun, "automationId" | "status" | "trigger" | "scheduledFor">

export interface HostedAutomationCandidate {
  automation: Automation
  actor: HostedAutomationActor
  runs: HostedAutomationRunEvidence[]
}

type Sql = postgres.Sql

type AutomationRow = {
  id: string; title: string; enabled: boolean; cron: string; timezone: string; model: string; created_at: Date | string; updated_at: Date | string
}
type RunRow = {
  id: string; automation_id: string; session_id: string | null; status: AutomationRun["status"]; trigger: AutomationRun["trigger"]; scheduled_for: Date | string | null; started_at: Date | string | null; completed_at: Date | string | null; duration_ms: number | null; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; prompt_snapshot: string; model_snapshot: string; error: string | null; created_at: Date | string; updated_at: Date | string
}
type ScheduleRunRow = Pick<RunRow, "automation_id" | "status" | "trigger" | "scheduled_for">

/** Hosted store bound to a verified workspace/user pair; every query is scoped by both. */
export class PostgresAutomationStore implements AutomationStore {
  constructor(private readonly sql: Sql, private readonly actor: HostedAutomationActor, private readonly clock = () => new Date()) {}

  async listAutomations(): Promise<Automation[]> {
    const rows = await this.sql<AutomationRow[]>`
      SELECT id, title, enabled, cron, timezone, model, prompt, created_at, updated_at
      FROM boring_automation_automations
      WHERE workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
      ORDER BY created_at, id
    `
    return rows.map(toAutomation)
  }

  async getAutomation(id: string): Promise<Automation | null> {
    const rows = await this.sql<AutomationRow[]>`
      SELECT id, title, enabled, cron, timezone, model, prompt, created_at, updated_at
      FROM boring_automation_automations
      WHERE id = ${id} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
    `
    return rows[0] ? toAutomation(rows[0]) : null
  }

  async createAutomation(input: AutomationCreate): Promise<Automation> {
    const now = this.clock().toISOString()
    const id = randomUUID()
    const prompt = input.prompt ?? ""
    const rows = await this.sql<AutomationRow[]>`
      INSERT INTO boring_automation_automations (id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, prompt, created_at, updated_at)
      VALUES (${id}, ${this.actor.workspaceId}, ${this.actor.userId}, ${input.title}, ${input.enabled ?? true}, ${input.cron}, ${input.timezone}, ${input.model}, ${prompt}, ${now}, ${now})
      RETURNING id, title, enabled, cron, timezone, model, prompt, created_at, updated_at
    `
    return toAutomation(rows[0]!)
  }

  async updateAutomation(id: string, patch: AutomationPatch): Promise<Automation> {
    const current = await this.getAutomation(id)
    if (!current) throw automationNotFound(id)
    const next = { ...current, ...patch, updatedAt: this.clock().toISOString() }
    const rows = await this.sql<AutomationRow[]>`
      UPDATE boring_automation_automations
      SET title = ${next.title}, enabled = ${next.enabled}, cron = ${next.cron}, timezone = ${next.timezone}, model = ${next.model}, updated_at = ${next.updatedAt}
      WHERE id = ${id} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
      RETURNING id, title, enabled, cron, timezone, model, prompt, created_at, updated_at
    `
    if (!rows[0]) throw automationNotFound(id)
    return toAutomation(rows[0])
  }

  async deleteAutomation(id: string): Promise<void> {
    const deletedAt = this.clock().toISOString()
    const result = await this.sql`
      UPDATE boring_automation_automations
      SET enabled = false, deleted_at = ${deletedAt}, updated_at = ${deletedAt}
      WHERE id = ${id} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
    `
    if (result.count === 0) throw automationNotFound(id)
  }

  async getPrompt(automationId: string): Promise<string> {
    const automation = await this.getAutomation(automationId)
    if (!automation) throw automationNotFound(automationId)
    const rows = await this.sql<{ prompt: string }[]>`
      SELECT prompt FROM boring_automation_automations
      WHERE id = ${automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
    `
    return rows[0]?.prompt ?? ""
  }

  async updatePrompt(automationId: string, body: string): Promise<void> {
    const result = await this.sql`
      UPDATE boring_automation_automations SET prompt = ${body}, updated_at = ${this.clock().toISOString()}
      WHERE id = ${automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
    `
    if (result.count === 0) throw automationNotFound(automationId)
  }

  async reconcileOrphanedRuns(automationId: string): Promise<void> {
    await this.sql`
      UPDATE boring_automation_runs
      SET status = 'failed', completed_at = ${this.clock().toISOString()}, error = 'Automation host restarted before the run completed', updated_at = ${this.clock().toISOString()}
      WHERE automation_id = ${automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND status IN ('queued', 'running')
    `
  }

  async beginRun(input: AutomationRunBegin): Promise<AutomationRun> {
    const automation = await this.getAutomation(input.automationId)
    if (!automation) throw automationNotFound(input.automationId)
    const active = await this.sql<{ id: string }[]>`
      SELECT id FROM boring_automation_runs
      WHERE automation_id = ${input.automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND status IN ('queued', 'running')
      LIMIT 1
    `
    if (active[0]) throw runAlreadyActive(input.automationId)
    try {
      const now = input.createdAt ?? this.clock().toISOString()
      const id = randomUUID()
      const rows = await this.sql<RunRow[]>`
        INSERT INTO boring_automation_runs (id, automation_id, workspace_id, owner_user_id, session_id, status, trigger, scheduled_for, started_at, completed_at, duration_ms, input_tokens, output_tokens, total_tokens, prompt_snapshot, model_snapshot, error, created_at, updated_at)
        VALUES (${id}, ${input.automationId}, ${this.actor.workspaceId}, ${this.actor.userId}, NULL, 'queued', ${input.trigger}, ${input.scheduledFor ?? null}, NULL, NULL, NULL, NULL, NULL, NULL, ${input.promptSnapshot}, ${input.modelSnapshot}, NULL, ${now}, ${now})
        RETURNING *
      `
      return toRun(rows[0]!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (constraintName(error) === "boring_automation_runs_active_once_idx") throw runAlreadyActive(input.automationId)
        if (input.trigger === "scheduled" && input.scheduledFor) throw runAlreadyRecorded(input.automationId, input.scheduledFor)
      }
      throw error
    }
  }

  async updateRunLifecycle(runId: string, patch: AutomationRunLifecyclePatch): Promise<AutomationRun> {
    const current = await this.findRun(runId)
    if (!current) throw runNotFound(runId)
    const next = { ...current, ...patch, updatedAt: this.clock().toISOString() }
    const rows = await this.sql<RunRow[]>`
      UPDATE boring_automation_runs
      SET session_id = ${next.sessionId}, status = ${next.status}, started_at = ${next.startedAt}, completed_at = ${next.completedAt}, duration_ms = ${next.durationMs}, input_tokens = ${next.inputTokens}, output_tokens = ${next.outputTokens}, total_tokens = ${next.totalTokens}, error = ${next.error}, updated_at = ${next.updatedAt}
      WHERE id = ${runId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
      RETURNING *
    `
    if (!rows[0]) throw runNotFound(runId)
    return toRun(rows[0])
  }

  async listRuns(automationId: string): Promise<AutomationRun[]> {
    const rows = await this.sql<RunRow[]>`
      SELECT * FROM boring_automation_runs
      WHERE automation_id = ${automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
      ORDER BY created_at DESC, id DESC
    `
    return rows.map(toRun)
  }

  private async findRun(runId: string): Promise<AutomationRun | null> {
    const rows = await this.sql<RunRow[]>`
      SELECT * FROM boring_automation_runs
      WHERE id = ${runId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
    `
    return rows[0] ? toRun(rows[0]) : null
  }
}

export async function listHostedAutomationCandidates(sql: Sql, scheduledFor: string): Promise<HostedAutomationCandidate[]> {
  const automationRows = await sql<(AutomationRow & { workspace_id: string; owner_user_id: string })[]>`
    SELECT id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, created_at, updated_at
    FROM boring_automation_automations
    WHERE deleted_at IS NULL
    ORDER BY id
  `
  const runRows = await sql<ScheduleRunRow[]>`
    SELECT runs.automation_id, runs.status, runs.trigger, runs.scheduled_for
    FROM boring_automation_runs AS runs
    INNER JOIN boring_automation_automations AS automations
      ON automations.id = runs.automation_id
      AND automations.workspace_id = runs.workspace_id
      AND automations.owner_user_id = runs.owner_user_id
    WHERE automations.deleted_at IS NULL
      AND (
        runs.status IN ('queued', 'running')
        OR (runs.trigger = 'scheduled' AND runs.scheduled_for = ${scheduledFor})
      )
    ORDER BY runs.automation_id
  `
  const runsByAutomation = new Map<string, HostedAutomationRunEvidence[]>()
  for (const row of runRows) {
    const list = runsByAutomation.get(row.automation_id) ?? []
    list.push({
      automationId: row.automation_id,
      status: row.status,
      trigger: row.trigger,
      scheduledFor: nullableIso(row.scheduled_for),
    })
    runsByAutomation.set(row.automation_id, list)
  }
  return automationRows.map((row) => ({
    automation: toAutomation(row),
    actor: { workspaceId: row.workspace_id, userId: row.owner_user_id },
    runs: runsByAutomation.get(row.id) ?? [],
  }))
}

function toAutomation(row: AutomationRow): Automation {
  return { id: row.id, title: row.title, enabled: row.enabled, cron: row.cron, timezone: row.timezone, model: row.model, promptRef: `hosted:${row.id}`, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}

function toRun(row: RunRow): AutomationRun {
  return { id: row.id, automationId: row.automation_id, sessionId: row.session_id, status: row.status, trigger: row.trigger, scheduledFor: nullableIso(row.scheduled_for), startedAt: nullableIso(row.started_at), completedAt: nullableIso(row.completed_at), durationMs: row.duration_ms, inputTokens: row.input_tokens, outputTokens: row.output_tokens, totalTokens: row.total_tokens, promptSnapshot: row.prompt_snapshot, modelSnapshot: row.model_snapshot, error: row.error, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function nullableIso(value: Date | string | null): string | null { return value === null ? null : iso(value) }
function isUniqueViolation(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") }
function constraintName(error: unknown): string | undefined { return error && typeof error === "object" && "constraint_name" in error ? String((error as { constraint_name?: unknown }).constraint_name) : undefined }
