import type postgres from "postgres"
import type { AgentEvent, WorkspaceAgentDispatcherDispatchInput } from "@hachej/boring-agent/shared"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { describe, expect, it, vi } from "vitest"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared"
import { HostedDueRunService } from "../hostedDueRunService"

const AUTOMATION_ROW = {
  id: "automation-a",
  workspace_id: "workspace-a",
  owner_user_id: "user-a",
  title: "Daily",
  enabled: true,
  cron: "0 9 * * *",
  timezone: "UTC",
  model: "test:model-a",
  created_at: "2026-07-23T08:00:00.000Z",
  updated_at: "2026-07-23T08:00:00.000Z",
}

const RUN_ROW = {
  id: "run-a",
  automation_id: "automation-a",
  session_id: null,
  status: "queued",
  trigger: "scheduled",
  scheduled_for: "2026-07-23T09:00:00.000Z",
  started_at: null,
  completed_at: null,
  duration_ms: null,
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  prompt_snapshot: "Run",
  model_snapshot: "test:model-a",
  error: null,
  created_at: "2026-07-23T09:00:15.000Z",
  updated_at: "2026-07-23T09:00:15.000Z",
}

type MutableRunRow = Omit<typeof RUN_ROW, "session_id" | "started_at" | "completed_at" | "duration_ms"> & {
  session_id: string | null
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
}

function uniqueRaceSql(constraintName: string): postgres.Sql {
  const sql = Object.assign((async (strings: TemplateStringsArray) => {
    const text = strings.join("?")
    if (text.includes("INSERT INTO boring_automation_runs")) {
      throw Object.assign(new Error("unique violation"), { code: "23505", constraint_name: constraintName })
    }
    if (text.includes("SELECT prompt")) return [{ prompt: "Run" }]
    if (text.includes("FROM boring_automation_automations")) return [AUTOMATION_ROW]
    return []
  }), {
    array: (value: unknown[]) => value,
    begin: async (run: (transaction: postgres.TransactionSql) => unknown) => await run(sql as unknown as postgres.TransactionSql),
  }) as unknown as postgres.Sql
  return sql
}

function directResolver(
  dispatch: (input: WorkspaceAgentDispatcherDispatchInput) => Promise<{
    ref: { agentTypeId: string; sessionId: string }
    receipt: { accepted: true; cursor: number; disposition: "prompt"; clientNonce: string }
    events: AsyncIterable<AgentEvent>
  }>,
  workspace: object,
): WorkspaceAgentDispatcherResolver & {
  runWithWorkspaceAgent: ReturnType<typeof vi.fn>
  authorizeSession: ReturnType<typeof vi.fn>
} {
  return {
    runWithWorkspaceAgent: vi.fn(async (_input, run) => {
      await run({
        workspace: workspace as never,
        signal: new AbortController().signal,
        async dispatch(
          input: WorkspaceAgentDispatcherDispatchInput,
          onEvent: (event: AgentEvent) => void | Promise<void>,
          onAccepted?: Parameters<import("@hachej/boring-agent/shared").LeaseBoundWorkspaceAgent["dispatch"]>[2],
        ) {
          const result = await dispatch(input)
          await onAccepted?.({ ref: result.ref, receipt: result.receipt })
          for await (const event of result.events) await onEvent(event)
          return { ref: result.ref, receipt: result.receipt }
        },
        async interrupt() { return { accepted: true, cursor: 0 } },
        async stop() { return { accepted: true, cursor: 0, stopped: true, clearedQueue: [] } },
      })
    }),
    authorizeSession: vi.fn(async () => undefined),
    async resolve() { throw new Error("legacy resolver must not be used") },
  }
}

describe("HostedDueRunService", () => {
  it("rejects an unauthorized creator before actor-scoped execution", async () => {
    const queries: string[] = []
    const sql = Object.assign((async (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      queries.push(text)
      return text.includes("FROM boring_automation_automations") ? [AUTOMATION_ROW] : []
    }), { array: (value: unknown[]) => value }) as unknown as postgres.Sql
    const resolve = vi.fn()
    const verifyActor = vi.fn(() => false)
    const service = new HostedDueRunService({
      agentTypeId: "selected-agent",
      sql,
      dispatcherResolver: { resolve } as never,
      verifyActor,
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    const result = await service.runDue()

    expect(verifyActor).toHaveBeenCalledWith({ workspaceId: "workspace-a", userId: "user-a" })
    expect(result.outcomes).toEqual([expect.objectContaining({
      kind: "failed",
      code: BORING_AUTOMATION_ERROR_CODES.OWNER_UNAUTHORIZED,
    })])
    expect(resolve).not.toHaveBeenCalled()
    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain("updated_at <")
  })

  it("reports an unknown selected Agent without dispatching or crashing the hosted batch", async () => {
    const queries: string[] = []
    const sql = Object.assign((async (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      queries.push(text)
      if (text.includes("updated_at <")) return []
      if (text.includes("FROM boring_automation_automations")) {
        return [{ ...AUTOMATION_ROW, agent_type_id: "retired" }]
      }
      return []
    }), { array: (value: unknown[]) => value, json: (value: unknown) => value }) as unknown as postgres.Sql
    const dispatch = vi.fn()
    const resolver = directResolver(dispatch, { readFile: vi.fn() })
    const service = new HostedDueRunService({
      agentTypeId: "selected-agent",
      availableAgentTypeIds: ["selected-agent", "researcher"],
      sql,
      dispatcherResolver: resolver,
      verifyActor: vi.fn(() => true),
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    const result = await service.runDue()

    expect(result.outcomes).toEqual([expect.objectContaining({
      kind: "failed",
      code: BORING_AUTOMATION_ERROR_CODES.AGENT_NOT_FOUND,
    })])
    expect(dispatch).not.toHaveBeenCalled()
    expect(queries.some((query) => query.includes("INSERT INTO boring_automation_runs"))).toBe(false)
  })

  it("executes a verified creator internally without fabricating a request", async () => {
    let runRow: MutableRunRow = { ...RUN_ROW }
    let lifecycleUpdates = 0
    const sql = Object.assign((async (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      if (text.includes("INSERT INTO boring_automation_runs")) return [runRow]
      if (text.includes("SELECT * FROM boring_automation_runs")) return [runRow]
      if (text.includes("updated_at <")) return []
      if (text.includes("UPDATE boring_automation_runs")) {
        lifecycleUpdates += 1
        runRow = lifecycleUpdates === 1
          ? { ...runRow, status: "running", started_at: "2026-07-23T09:00:15.000Z" }
          : lifecycleUpdates === 2
            ? { ...runRow, session_id: "session-1" }
            : { ...runRow, status: "succeeded", completed_at: "2026-07-23T09:00:16.000Z", duration_ms: 1_000 }
        return [runRow]
      }
      if (text.includes("FROM boring_automation_automations")) return [{ ...AUTOMATION_ROW, agent_type_id: "researcher" }]
      return []
    }), {
      array: (value: unknown[]) => value,
      json: (value: unknown) => value,
      begin: async (run: (transaction: postgres.TransactionSql) => unknown) => await run(sql as unknown as postgres.TransactionSql),
    }) as unknown as postgres.Sql
    const dispatch = vi.fn(async (input: { requestId: string }) => ({
      ref: { agentTypeId: "researcher", sessionId: "session-1" },
      receipt: { accepted: true as const, cursor: 0, disposition: "prompt" as const, clientNonce: input.requestId },
      events: (async function* () {})(),
    }))
    const dispatcher = { dispatch }
    const workspace = { readFile: vi.fn(async () => "Run") }
    const resolver = directResolver(dispatch, workspace)
    const verifyActor = vi.fn(() => true)
    const service = new HostedDueRunService({
      agentTypeId: "selected-agent",
      availableAgentTypeIds: ["selected-agent", "researcher"],
      sql,
      dispatcherResolver: resolver,
      verifyActor,
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    const result = await service.runDue()

    const actor = { workspaceId: "workspace-a", userId: "user-a" }
    expect(verifyActor).toHaveBeenCalledWith(actor)
    expect(resolver.runWithWorkspaceAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentTypeId: "researcher",
      context: actor,
    }), expect.any(Function))
    expect(dispatch).toHaveBeenCalledOnce()
    expect(workspace.readFile).toHaveBeenCalledOnce()
    expect(resolver.authorizeSession).toHaveBeenCalledWith(
      actor,
      { agentTypeId: "researcher", sessionId: "session-1" },
    )
    expect(result.outcomes).toEqual([expect.objectContaining({
      kind: "started",
      automationId: "automation-a",
      scheduledFor: "2026-07-23T09:00:00.000Z",
      run: expect.objectContaining({ status: "succeeded", sessionId: "session-1" }),
    })])
  })

  it("reconciles stale hosted runs before evaluating new schedule work", async () => {
    const publish = vi.fn(async () => undefined)
    const resolve = vi.fn()
    const sql = Object.assign((async (strings: TemplateStringsArray) => {
      const text = strings.join("?")
      if (text.includes("updated_at <")) return [{
        ...RUN_ROW,
        workspace_id: "workspace-a",
        owner_user_id: "user-a",
        invocation_id: "scheduled:stale",
        dispatch_request_id: "run-a",
        dispatch_receipt: null,
        status: "failed",
        completed_at: "2026-07-23T09:00:15.000Z",
        error: "Automation worker lease expired before the run completed",
      }]
      if (text.includes("FROM boring_automation_automations")) return [{ ...AUTOMATION_ROW, enabled: false }]
      return []
    }), { array: (value: unknown[]) => value }) as unknown as postgres.Sql
    const service = new HostedDueRunService({
      agentTypeId: "selected-agent",
      sql,
      dispatcherResolver: { resolve } as never,
      verifyActor: vi.fn(() => true),
      eventPublisher: { publish },
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    await service.runDue()

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-a",
      userId: "user-a",
      runId: "run-a",
      status: "failed",
    }))
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    ["boring_automation_runs_active_once_idx", "active-run"],
    ["boring_automation_runs_scheduled_once_idx", "duplicate-scheduled-run"],
  ])("reports %s cross-process races as skips", async (constraintName, reason) => {
    const resolve = vi.fn()
    const resolver = directResolver(async () => { throw new Error("dispatch must not run") }, { readFile: vi.fn(async () => "Run") })
    const service = new HostedDueRunService({
      agentTypeId: "selected-agent",
      sql: uniqueRaceSql(constraintName),
      dispatcherResolver: resolver,
      verifyActor: vi.fn(() => true),
      clock: () => new Date("2026-07-23T09:00:15.000Z"),
    })

    const result = await service.runDue()

    expect(result.outcomes).toEqual([expect.objectContaining({
      kind: "skipped",
      automationId: "automation-a",
      scheduledFor: "2026-07-23T09:00:00.000Z",
      reason,
    })])
    expect(resolve).not.toHaveBeenCalled()
  })
})
