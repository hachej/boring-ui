import { createHash, randomUUID } from "node:crypto"
import type postgres from "postgres"
import type { Workspace } from "@hachej/boring-agent/shared"
import { BORING_AUTOMATION_ERROR_CODES } from "../shared/error-codes"
import { AUTOMATION_PROMPT_DIRECTORY, automationPromptPath } from "../shared/prompt"
import type { Automation, AutomationCreate, AutomationPatch, AutomationRun, AutomationRunBegin, AutomationRunLifecyclePatch } from "../shared/types"
import { AutomationStoreError, automationNotFound, runAlreadyActive, runAlreadyRecorded, runLeaseLost, runNotFound, type AutomationSeed, type AutomationStore } from "./store"

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

export interface ReconciledHostedAutomationRun {
  actor: HostedAutomationActor
  run: AutomationRun
}

type Sql = postgres.Sql

type AutomationRow = {
  id: string; title: string; enabled: boolean; cron: string | null; timezone: string; model: string; agent_type_id: string | null; session_mode: Automation["sessionMode"]; prompt_ref: string | null; created_at: Date | string; updated_at: Date | string
}
type RunRow = {
  id: string; automation_id: string; invocation_id: string; dispatch_request_id: string; dispatch_receipt: AutomationRun["dispatchReceipt"]; session_id: string | null; status: AutomationRun["status"]; trigger: AutomationRun["trigger"]; scheduled_for: Date | string | null; started_at: Date | string | null; completed_at: Date | string | null; duration_ms: number | null; input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; prompt_snapshot: string; model_snapshot: string; error: string | null; note: string | null; created_at: Date | string; updated_at: Date | string
}
type ScheduleRunRow = Pick<RunRow, "automation_id" | "status" | "trigger" | "scheduled_for">

/** Hosted metadata store bound to one verified actor; prompt bodies live in the actor's Workspace. */
export class PostgresAutomationStore implements AutomationStore {
  constructor(
    private readonly sql: Sql,
    private readonly actor: HostedAutomationActor,
    private readonly clock = () => new Date(),
    private readonly workspace?: Workspace,
  ) {}

  async listAutomations(): Promise<Automation[]> {
    const rows = await this.sql<AutomationRow[]>`
      SELECT id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at
      FROM boring_automation_automations
      WHERE workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
      ORDER BY created_at, id
    `
    return rows.map(toAutomation)
  }

  async getAutomation(id: string): Promise<Automation | null> {
    const rows = await this.sql<AutomationRow[]>`
      SELECT id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at
      FROM boring_automation_automations
      WHERE id = ${id} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
    `
    if (!rows[0]) return null
    return toAutomation(rows[0])
  }

  async createAutomation(input: AutomationCreate): Promise<Automation> {
    const now = this.clock().toISOString()
    const id = randomUUID()
    const promptRef = automationPromptPath(id)
    await this.writePromptFile(promptRef, input.prompt ?? "")
    const rows = await this.sql<AutomationRow[]>`
      INSERT INTO boring_automation_automations (id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at)
      VALUES (${id}, ${this.actor.workspaceId}, ${this.actor.userId}, ${input.title}, ${input.enabled ?? true}, ${input.cron}, ${input.timezone}, ${input.model}, ${input.agentTypeId ?? null}, ${input.sessionMode ?? "new"}, ${promptRef}, ${now}, ${now})
      RETURNING id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at
    `
    return toAutomation(rows[0]!)
  }

  async readSeedManifest(): Promise<string | null> {
    try {
      return await this.requireWorkspace().readFile(".agents/automation/manifest.json")
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null
      throw error
    }
  }

  async ensureSeededAutomation(input: AutomationSeed): Promise<Automation | null> {
    const workspace = this.requireWorkspace()
    try {
      await workspace.readFile(input.promptRef)
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null
      throw error
    }
    const id = deterministicSeedId(this.actor, input.key)
    const now = this.clock().toISOString()
    const rows = await this.sql<AutomationRow[]>`
      INSERT INTO boring_automation_automations (id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at)
      VALUES (${id}, ${this.actor.workspaceId}, ${this.actor.userId}, ${input.title}, ${input.enabled}, ${input.cron}, ${input.timezone}, ${input.model}, ${input.agentTypeId}, ${input.sessionMode}, ${input.promptRef}, ${now}, ${now})
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        enabled = EXCLUDED.enabled,
        cron = EXCLUDED.cron,
        timezone = EXCLUDED.timezone,
        model = EXCLUDED.model,
        agent_type_id = EXCLUDED.agent_type_id,
        session_mode = EXCLUDED.session_mode,
        prompt_ref = EXCLUDED.prompt_ref,
        deleted_at = NULL,
        updated_at = EXCLUDED.updated_at
      WHERE boring_automation_automations.workspace_id = EXCLUDED.workspace_id
        AND boring_automation_automations.owner_user_id = EXCLUDED.owner_user_id
      RETURNING id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at
    `
    return rows[0] ? toAutomation(rows[0]) : null
  }

  async updateAutomation(id: string, patch: AutomationPatch): Promise<Automation> {
    const current = await this.getAutomation(id)
    if (!current) throw automationNotFound(id)
    const next = { ...current, ...patch, updatedAt: this.clock().toISOString() }
    const rows = await this.sql<AutomationRow[]>`
      UPDATE boring_automation_automations
      SET title = ${next.title}, enabled = ${next.enabled}, cron = ${next.cron}, timezone = ${next.timezone}, model = ${next.model}, agent_type_id = ${next.agentTypeId ?? null}, session_mode = ${next.sessionMode ?? "new"}, updated_at = ${next.updatedAt}
      WHERE id = ${id} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
      RETURNING id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at
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
    return await this.requireWorkspace().readFile(automation.promptRef)
  }

  async updatePrompt(automationId: string, body: string): Promise<void> {
    const automation = await this.getAutomation(automationId)
    if (!automation) throw automationNotFound(automationId)
    await this.writePromptFile(automation.promptRef, body)
    const result = await this.sql`
      UPDATE boring_automation_automations
      SET updated_at = ${this.clock().toISOString()}
      WHERE id = ${automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND deleted_at IS NULL
    `
    if (result.count === 0) throw automationNotFound(automationId)
  }

  async reconcileOrphanedRuns(automationId: string): Promise<void> {
    await this.sql`
      UPDATE boring_automation_runs
      SET status = CASE WHEN status = 'queued' THEN 'failed' ELSE 'outcome-unknown' END,
          completed_at = ${this.clock().toISOString()},
          error = CASE WHEN status = 'queued'
            THEN 'Automation host restarted before the run completed'
            ELSE 'Automation dispatch outcome is unknown after host restart; the slot remains occupied' END,
          updated_at = ${this.clock().toISOString()}
      WHERE automation_id = ${automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND status IN ('queued', 'dispatching', 'running')
    `
  }

  async beginRun(input: AutomationRunBegin): Promise<AutomationRun> {
    const automation = await this.getAutomation(input.automationId)
    if (!automation) throw automationNotFound(input.automationId)
    if (input.invocationId) {
      const existing = await this.sql<RunRow[]>`
        SELECT * FROM boring_automation_runs
        WHERE automation_id = ${input.automationId} AND invocation_id = ${input.invocationId}
          AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
        LIMIT 1
      `
      if (existing[0]) return toRun(existing[0])
    }
    const active = await this.sql<{ id: string }[]>`
      SELECT id FROM boring_automation_runs
      WHERE automation_id = ${input.automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND status IN ('queued', 'dispatching', 'running', 'outcome-unknown')
      LIMIT 1
    `
    if (active[0]) throw runAlreadyActive(input.automationId)
    try {
      const now = input.createdAt ?? this.clock().toISOString()
      const id = randomUUID()
      const invocationId = input.invocationId ?? `store:${randomUUID()}`
      const rows = await this.sql<RunRow[]>`
        INSERT INTO boring_automation_runs (id, automation_id, workspace_id, owner_user_id, invocation_id, dispatch_request_id, dispatch_receipt, session_id, status, trigger, scheduled_for, started_at, completed_at, duration_ms, input_tokens, output_tokens, total_tokens, prompt_snapshot, model_snapshot, error, note, created_at, updated_at)
        VALUES (${id}, ${input.automationId}, ${this.actor.workspaceId}, ${this.actor.userId}, ${invocationId}, ${id}, NULL, NULL, 'queued', ${input.trigger}, ${input.scheduledFor ?? null}, NULL, NULL, NULL, NULL, NULL, NULL, ${input.promptSnapshot}, ${input.modelSnapshot}, NULL, NULL, ${now}, ${now})
        RETURNING *
      `
      return toRun(rows[0]!)
    } catch (error) {
      if (isUniqueViolation(error)) {
        if (input.invocationId) {
          const existing = await this.sql<RunRow[]>`
            SELECT * FROM boring_automation_runs
            WHERE automation_id = ${input.automationId} AND invocation_id = ${input.invocationId}
              AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
            LIMIT 1
          `
          if (existing[0]) return toRun(existing[0])
        }
        if (constraintName(error) === "boring_automation_runs_active_once_idx") throw runAlreadyActive(input.automationId)
        if (input.trigger === "scheduled" && input.scheduledFor) throw runAlreadyRecorded(input.automationId, input.scheduledFor)
      }
      throw error
    }
  }

  async claimRunForDispatch(runId: string): Promise<AutomationRun | null> {
    const rows = await this.sql<RunRow[]>`
      UPDATE boring_automation_runs
      SET status = 'dispatching', updated_at = NOW()
      WHERE id = ${runId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId} AND status = 'queued'
      RETURNING *
    `
    return rows[0] ? toRun(rows[0]) : null
  }

  async heartbeatRun(runId: string): Promise<boolean> {
    const result = await this.sql`
      UPDATE boring_automation_runs
      SET updated_at = NOW()
      WHERE id = ${runId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
        AND status IN ('queued', 'dispatching', 'running')
    `
    return result.count > 0
  }

  async updateRunLifecycle(runId: string, patch: AutomationRunLifecyclePatch): Promise<AutomationRun> {
    const current = await this.findRun(runId)
    if (!current) throw runNotFound(runId)
    if (current.status !== "queued" && current.status !== "dispatching" && current.status !== "running") throw runLeaseLost(runId)
    const next = { ...current, ...patch }
    const dispatchReceipt = next.dispatchReceipt === null ? null : JSON.stringify(next.dispatchReceipt)
    const rows = await this.sql<RunRow[]>`
      UPDATE boring_automation_runs
      SET session_id = ${next.sessionId}, dispatch_receipt = ${dispatchReceipt}::text::jsonb, status = ${next.status}, started_at = ${next.startedAt}, completed_at = ${next.completedAt}, duration_ms = ${next.durationMs}, input_tokens = ${next.inputTokens}, output_tokens = ${next.outputTokens}, total_tokens = ${next.totalTokens}, error = ${next.error}, note = ${next.note ?? null}, updated_at = NOW()
      WHERE id = ${runId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
        AND status = ${current.status}
      RETURNING *
    `
    if (!rows[0]) {
      if (await this.findRun(runId)) throw runLeaseLost(runId)
      throw runNotFound(runId)
    }
    return toRun(rows[0])
  }

  async getRun(automationId: string, runId: string): Promise<AutomationRun | null> {
    const rows = await this.sql<RunRow[]>`
      SELECT * FROM boring_automation_runs
      WHERE id = ${runId} AND automation_id = ${automationId}
        AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
      LIMIT 1
    `
    return rows[0] ? toRun(rows[0]) : null
  }

  async listRuns(automationId: string, limit?: number): Promise<AutomationRun[]> {
    const rows = await this.sql<RunRow[]>`
      SELECT * FROM boring_automation_runs
      WHERE automation_id = ${automationId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit ?? 2_147_483_647}
    `
    return rows.map(toRun)
  }

  async listRecentRuns(limit: number): Promise<AutomationRun[]> {
    const rows = await this.sql<RunRow[]>`
      SELECT runs.* FROM boring_automation_runs AS runs
      INNER JOIN boring_automation_automations AS automations
        ON automations.id = runs.automation_id
        AND automations.workspace_id = runs.workspace_id
        AND automations.owner_user_id = runs.owner_user_id
      WHERE runs.workspace_id = ${this.actor.workspaceId} AND runs.owner_user_id = ${this.actor.userId}
        AND automations.deleted_at IS NULL
      ORDER BY runs.updated_at DESC, runs.id DESC
      LIMIT ${limit}
    `
    return rows.map(toRun)
  }

  async findRunBySessionId(sessionId: string): Promise<AutomationRun | null> {
    const rows = await this.sql<RunRow[]>`
      SELECT runs.* FROM boring_automation_runs AS runs
      INNER JOIN boring_automation_automations AS automations
        ON automations.id = runs.automation_id
        AND automations.workspace_id = runs.workspace_id
        AND automations.owner_user_id = runs.owner_user_id
      WHERE runs.workspace_id = ${this.actor.workspaceId} AND runs.owner_user_id = ${this.actor.userId}
        AND runs.session_id = ${sessionId} AND automations.deleted_at IS NULL
      ORDER BY runs.updated_at DESC, runs.id DESC
      LIMIT 1
    `
    return rows[0] ? toRun(rows[0]) : null
  }

  private requireWorkspace(): Workspace {
    if (this.workspace) return this.workspace
    throw new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.TOOL_CONTEXT_UNAVAILABLE, "automation workspace is unavailable")
  }

  private async writePromptFile(promptRef: string, body: string): Promise<void> {
    const workspace = this.requireWorkspace()
    await workspace.mkdir(AUTOMATION_PROMPT_DIRECTORY, { recursive: true })
    await workspace.writeFile(promptRef, body)
  }

  private async findRun(runId: string): Promise<AutomationRun | null> {
    const rows = await this.sql<RunRow[]>`
      SELECT * FROM boring_automation_runs
      WHERE id = ${runId} AND workspace_id = ${this.actor.workspaceId} AND owner_user_id = ${this.actor.userId}
    `
    return rows[0] ? toRun(rows[0]) : null
  }
}

export async function reconcileStaleHostedAutomationRuns(
  sql: Sql,
  staleAfterMs: number,
): Promise<ReconciledHostedAutomationRun[]> {
  const rows = await sql<(RunRow & { workspace_id: string; owner_user_id: string })[]>`
    UPDATE boring_automation_runs
    SET status = CASE WHEN status = 'queued' THEN 'failed' ELSE 'outcome-unknown' END,
        completed_at = NOW(),
        error = CASE WHEN status = 'queued'
          THEN 'Automation worker lease expired before dispatch'
          ELSE 'Automation dispatch outcome is unknown after its worker lease expired; the slot remains occupied' END,
        updated_at = NOW()
    WHERE status IN ('queued', 'dispatching', 'running')
      AND updated_at < NOW() - (${staleAfterMs} * INTERVAL '1 millisecond')
    RETURNING *
  `
  return rows.map((row) => ({
    actor: { workspaceId: row.workspace_id, userId: row.owner_user_id },
    run: toRun(row),
  }))
}

export async function listHostedAutomationCandidates(sql: Sql, scheduledFor: string): Promise<HostedAutomationCandidate[]> {
  const automationRows = await sql<(AutomationRow & { workspace_id: string; owner_user_id: string })[]>`
    SELECT id, workspace_id, owner_user_id, title, enabled, cron, timezone, model, agent_type_id, session_mode, prompt_ref, created_at, updated_at
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
        runs.status IN ('queued', 'dispatching', 'running', 'outcome-unknown')
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
  return { id: row.id, title: row.title, enabled: row.enabled, cron: row.cron, timezone: row.timezone, model: row.model, ...(row.agent_type_id ? { agentTypeId: row.agent_type_id } : {}), sessionMode: row.session_mode ?? "new", promptRef: row.prompt_ref ?? automationPromptPath(row.id), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}

function deterministicSeedId(actor: HostedAutomationActor, key: string): string {
  const bytes = createHash("sha256").update(`${actor.workspaceId}\0${actor.userId}\0${key}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function toRun(row: RunRow): AutomationRun {
  return { id: row.id, automationId: row.automation_id, invocationId: row.invocation_id, dispatchRequestId: row.dispatch_request_id, dispatchReceipt: row.dispatch_receipt, sessionId: row.session_id, status: row.status, trigger: row.trigger, scheduledFor: nullableIso(row.scheduled_for), startedAt: nullableIso(row.started_at), completedAt: nullableIso(row.completed_at), durationMs: row.duration_ms, inputTokens: row.input_tokens, outputTokens: row.output_tokens, totalTokens: row.total_tokens, promptSnapshot: row.prompt_snapshot, modelSnapshot: row.model_snapshot, error: row.error, note: row.note ?? null, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString() }
function nullableIso(value: Date | string | null): string | null { return value === null ? null : iso(value) }
function isUniqueViolation(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") }
function constraintName(error: unknown): string | undefined { return error && typeof error === "object" && "constraint_name" in error ? String((error as { constraint_name?: unknown }).constraint_name) : undefined }
