import { describe, expect, it, vi } from "vitest"
import type { ToolExecContext, ToolResult } from "@hachej/boring-agent/shared"
import { BORING_AUTOMATION_ERROR_CODES } from "../../shared"
import { BORING_AUTOMATION_TOOL_NAME, createBoringAutomationTool } from "../automationTool"
import type { AutomationOperations } from "../operations"
import { AutomationStoreError } from "../store"

const NOW = "2026-07-19T00:00:00.000Z"
const summary = {
  id: "automation-1", title: "Daily", enabled: true, cron: "0 9 * * *", timezone: "UTC",
  model: "anthropic:claude-sonnet", thinkingLevel: "medium" as const, createdAt: NOW, updatedAt: NOW,
}
const run = {
  id: "run-1", automationId: "automation-1", sessionId: "session-1", status: "succeeded" as const,
  trigger: "manual" as const, scheduledFor: null, startedAt: NOW, completedAt: NOW, durationMs: 10,
  inputTokens: 1, outputTokens: 2, totalTokens: 3, error: null, createdAt: NOW, updatedAt: NOW,
}

function operations(): AutomationOperations {
  return {
    list: vi.fn(async () => ({ items: [summary], truncated: false })),
    get: vi.fn(async () => ({ automation: summary, prompt: { text: "prompt", characterCount: 6, truncated: false } })),
    create: vi.fn(async () => summary),
    update: vi.fn(async () => summary),
    pause: vi.fn(async () => ({ ...summary, enabled: false })),
    resume: vi.fn(async () => summary),
    delete: vi.fn(async () => ({ automationId: summary.id, title: summary.title })),
    run: vi.fn(async () => run),
    listRuns: vi.fn(async () => ({ items: [run], truncated: false })),
  }
}

function context(controller = new AbortController()): ToolExecContext {
  return { abortSignal: controller.signal, toolCallId: "call-1", workspaceId: "workspace-1", userId: "user-1" }
}

function harness(ops = operations()) {
  const resolveOperationsForActor = vi.fn(async () => ({ operations: ops }))
  return { ops, resolveOperationsForActor, tool: createBoringAutomationTool({ resolveOperationsForActor }) }
}

function details(result: ToolResult): any {
  expect(result.content).toHaveLength(1)
  expect(JSON.parse(result.content[0]!.text)).toEqual(result.details)
  return result.details
}

describe("boring_automation agent tool", () => {
  it("publishes a strict trusted tool contract", () => {
    const { tool } = harness()
    expect(tool.name).toBe(BORING_AUTOMATION_TOOL_NAME)
    expect(tool.name).toBe("boring_automation")
    expect(tool.parameters).toMatchObject({ oneOf: expect.any(Array) })
    expect((tool.parameters.oneOf as any[])).toHaveLength(9)
    expect((tool.parameters.oneOf as any[]).every((branch) => branch.additionalProperties === false)).toBe(true)
  })

  it("derives scope only from ToolExecContext and lists bounded results", async () => {
    const { tool, ops, resolveOperationsForActor } = harness()
    const result = await tool.execute({ operation: "list", limit: 10 }, context())
    expect(result.isError).toBe(false)
    expect(resolveOperationsForActor).toHaveBeenCalledWith({ workspaceId: "workspace-1", userId: "user-1" })
    expect(ops.list).toHaveBeenCalledWith(10)
    expect(details(result)).toEqual({ ok: true, operation: "list", automations: [summary], truncated: false })
  })

  it("supports get and bounded prompt details", async () => {
    const { tool, ops } = harness()
    const result = await tool.execute({ operation: "get", automationId: "automation-1" }, context())
    expect(ops.get).toHaveBeenCalledWith("automation-1")
    expect(details(result)).toMatchObject({ ok: true, operation: "get", automation: summary, prompt: { text: "prompt" } })
  })

  it("supports create with prompt, effort, enabled state, and explicit model", async () => {
    const { tool, ops } = harness()
    const input = {
      operation: "create", title: "Daily", enabled: false, cron: "0 9 * * *", timezone: "UTC",
      model: "anthropic:claude-sonnet", thinkingLevel: "high", prompt: "Summarize",
    }
    const result = await tool.execute(input, context())
    expect(result.isError).toBe(false)
    const called = vi.mocked(ops.create).mock.calls[0]![0]
    expect(called).toEqual({ title: "Daily", enabled: false, cron: "0 9 * * *", timezone: "UTC", model: "anthropic:claude-sonnet", thinkingLevel: "high", prompt: "Summarize" })
    expect(details(result)).toMatchObject({ ok: true, operation: "create", automation: summary })
  })

  it("supports metadata and canonical prompt update", async () => {
    const { tool, ops } = harness()
    const result = await tool.execute({ operation: "update", automationId: "automation-1", title: "Changed", prompt: "New" }, context())
    expect(ops.update).toHaveBeenCalledWith("automation-1", { title: "Changed", prompt: "New" })
    expect(details(result)).toMatchObject({ ok: true, operation: "update" })
  })

  it.each([
    ["pause", "pause"],
    ["resume", "resume"],
    ["run", "run"],
    ["delete", "delete"],
  ] as const)("supports %s", async (operation, method) => {
    const h = harness()
    const result = await h.tool.execute({ operation, automationId: "automation-1" }, context())
    expect(h.ops[method]).toHaveBeenCalledWith("automation-1")
    expect(details(result)).toMatchObject({ ok: true, operation })
  })

  it("supports bounded safe run history", async () => {
    const { tool, ops } = harness()
    const result = await tool.execute({ operation: "list_runs", automationId: "automation-1", limit: 5 }, context())
    expect(ops.listRuns).toHaveBeenCalledWith("automation-1", 5)
    expect(details(result)).toEqual({ ok: true, operation: "list_runs", runs: [run], truncated: false })
  })

  it("returns finalized failed runs as successful tool invocations", async () => {
    const ops = operations()
    vi.mocked(ops.run).mockResolvedValue({ ...run, status: "failed", error: "Provider failed" })
    const { tool } = harness(ops)
    const result = await tool.execute({ operation: "run", automationId: "automation-1" }, context())
    expect(result.isError).toBe(false)
    expect(details(result)).toMatchObject({ ok: true, operation: "run", run: { status: "failed", error: "Provider failed" } })
  })

  it.each([
    [{ operation: "unknown" }, BORING_AUTOMATION_ERROR_CODES.INVALID_BODY],
    [{ operation: "list", extra: true }, BORING_AUTOMATION_ERROR_CODES.INVALID_BODY],
    [{ operation: "update", automationId: "automation-1" }, BORING_AUTOMATION_ERROR_CODES.INVALID_BODY],
    [{ operation: "list", limit: 101 }, BORING_AUTOMATION_ERROR_CODES.INVALID_BODY],
    [{ operation: "create", title: "x", cron: "bad", timezone: "UTC", model: "test:model" }, BORING_AUTOMATION_ERROR_CODES.INVALID_CRON],
    [{ operation: "create", title: "x", cron: "0 9 * * *", timezone: "Mars/Base", model: "test:model" }, BORING_AUTOMATION_ERROR_CODES.INVALID_TIMEZONE],
    [{ operation: "create", title: "x", cron: "0 9 * * *", timezone: "UTC", model: "legacy-model" }, BORING_AUTOMATION_ERROR_CODES.INVALID_MODEL],
  ])("rejects malformed or invalid input %#", async (params, code) => {
    const h = harness()
    const result = await h.tool.execute(params as any, context())
    expect(result.isError).toBe(true)
    expect(details(result)).toMatchObject({ ok: false, code })
    expect(h.ops.create).not.toHaveBeenCalled()
    expect(h.ops.update).not.toHaveBeenCalled()
  })

  it("rejects arrays, null, and inherited parameter objects before resolving scope", async () => {
    const inherited = Object.create({ operation: "list" })
    inherited.extra = true
    for (const params of [null, [], inherited]) {
      const h = harness()
      const result = await h.tool.execute(params as any, context())
      expect(details(result)).toMatchObject({ ok: false, operation: "unknown", code: BORING_AUTOMATION_ERROR_CODES.INVALID_BODY })
      expect(h.resolveOperationsForActor).not.toHaveBeenCalled()
    }
  })

  it("checks abort before resolving context and again before mutation", async () => {
    const before = new AbortController()
    before.abort()
    const first = harness()
    const result = await first.tool.execute({ operation: "delete", automationId: "automation-1" }, context(before))
    expect(details(result)).toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.TOOL_ABORTED })
    expect(first.resolveOperationsForActor).not.toHaveBeenCalled()

    const during = new AbortController()
    const ops = operations()
    const resolveOperationsForActor = vi.fn(async () => {
      during.abort()
      return { operations: ops }
    })
    const tool = createBoringAutomationTool({ resolveOperationsForActor })
    const second = await tool.execute({ operation: "delete", automationId: "automation-1" }, context(during))
    expect(details(second)).toMatchObject({ code: BORING_AUTOMATION_ERROR_CODES.TOOL_ABORTED })
    expect(ops.delete).not.toHaveBeenCalled()
  })

  it("maps known and unexpected failures to fixed sanitized public errors", async () => {
    const knownOps = operations()
    vi.mocked(knownOps.get).mockRejectedValue(new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND, "/secret/path automation-1"))
    const known = await harness(knownOps).tool.execute({ operation: "get", automationId: "automation-1" }, context())
    expect(details(known)).toEqual({ ok: false, operation: "get", code: BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND, error: "Automation not found in the active workspace." })

    const unknownOps = operations()
    vi.mocked(unknownOps.list).mockRejectedValue(new Error("postgres password=/secret"))
    const unknown = await harness(unknownOps).tool.execute({ operation: "list" }, context())
    expect(details(unknown)).toEqual({ ok: false, operation: "list", code: BORING_AUTOMATION_ERROR_CODES.OPERATION_FAILED, error: "Automation operation failed." })
  })
})
