import { describe, expect, it, vi } from "vitest"
import { HUMAN_INPUT_OPS, WorkspaceBridgeErrorCode } from "@hachej/boring-workspace/server"
import { ASK_USER_PROMPT_GUIDELINES, ASK_USER_PROMPT_SNIPPET, createAskUserPiExtensionFactory, createWorkspaceBridgeClient, type AskUserWorkspaceBridgeContext } from "../index"

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer" }] }

function captureTool(ctx?: AskUserWorkspaceBridgeContext) {
  const tools: Array<{
    name: string
    promptSnippet?: string
    promptGuidelines?: string[]
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: unknown,
      toolCtx?: { sessionManager?: { getSessionId(): string } },
    ) => Promise<unknown>
  }> = []
  createAskUserPiExtensionFactory(ctx)({ registerTool: (tool) => tools.push(tool) })
  return tools[0]!
}

describe("ask-user Pi extension", () => {
  it("registers ask_user and returns a stable diagnostic when bridge context is unavailable", async () => {
    const tool = captureTool()
    expect(tool.name).toBe("ask_user")
    expect(tool.promptSnippet).toBe(ASK_USER_PROMPT_SNIPPET)
    expect(tool.promptGuidelines).toEqual(ASK_USER_PROMPT_GUIDELINES)
    expect(tool.promptGuidelines?.join("\n")).toContain("Do not ask for trivial choices")
    expect(tool.promptGuidelines?.join("\n")).toContain("repo conventions")
    expect(tool.promptGuidelines?.join("\n")).toContain("radio/select")
    await expect(tool.execute("call-1", { title: "Need input", schema })).resolves.toMatchObject({
      isError: true,
      details: { code: "ASK_USER_RUNTIME_UNAVAILABLE" },
    })
  })

  it("rejects invalid input locally before calling bridge", async () => {
    const callHumanInputRequest = vi.fn()
    const tool = captureTool({ sessionId: "session-1", callHumanInputRequest })
    await expect(tool.execute("call-1", {})).resolves.toMatchObject({ isError: true })
    expect(callHumanInputRequest).not.toHaveBeenCalled()
  })

  it("derives session id from Pi tool context when the host only provides bridge access", async () => {
    const callHumanInputRequest = vi.fn(async () => ({
      ok: true as const,
      op: HUMAN_INPUT_OPS.request,
      requestId: "call-ctx",
      output: {
        status: "answered" as const,
        answer: { questionId: "q-ctx", sessionId: "session-from-pi", values: { answer: "ctx" }, answeredAt: "2026-01-01T00:00:00.000Z" },
      },
    }))
    const tool = captureTool({ callHumanInputRequest })
    await expect(tool.execute("call-ctx", { title: "Need input", schema }, undefined, undefined, {
      sessionManager: { getSessionId: () => "session-from-pi" },
    })).resolves.toMatchObject({
      details: { status: "answered", answer: { sessionId: "session-from-pi" } },
    })
    expect(callHumanInputRequest).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-from-pi" }), undefined)
  })

  it("calls human-input request with tool and session ids and maps answer result", async () => {
    const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
    const callHumanInputRequest = vi.fn(async () => ({
      ok: true as const,
      op: HUMAN_INPUT_OPS.request,
      requestId: "call-1",
      output: {
        status: "answered" as const,
        answer: { questionId: "q1", sessionId: "session-1", values: { answer: "redacted-in-logs" }, answeredAt: "2026-01-01T00:00:00.000Z" },
      },
    }))
    const tool = captureTool({ sessionId: () => "session-1", callHumanInputRequest, logger })
    await expect(tool.execute("call-1", { title: "Need input", context: "ctx", schema, timeoutMs: 10_000 })).resolves.toMatchObject({
      details: { status: "answered", answer: { values: { answer: "redacted-in-logs" } } },
    })
    expect(callHumanInputRequest).toHaveBeenCalledWith({
      requestId: "call-1",
      toolCallId: "call-1",
      sessionId: "session-1",
      title: "Need input",
      context: "ctx",
      schema,
      payload: { title: "Need input", context: "ctx", schema },
      timeoutMs: 10_000,
    }, undefined)
    expect(JSON.stringify(logger.debug.mock.calls)).toContain("ask_user bridge request")
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain("redacted-in-logs")
  })

  it("passes cancellation signal through to the bridge client", async () => {
    const controller = new AbortController()
    const callHumanInputRequest = vi.fn(async () => ({
      ok: true as const,
      op: HUMAN_INPUT_OPS.request,
      requestId: "call-1",
      output: { status: "cancelled" as const, questionId: "q1", sessionId: "session-1", reason: "aborted" as const },
    }))
    const client = createWorkspaceBridgeClient({ sessionId: "session-1", callHumanInputRequest })
    await expect(client.request("call-1", { title: "Need input", schema }, controller.signal)).resolves.toMatchObject({ status: "cancelled", reason: "aborted" })
    expect((callHumanInputRequest.mock.calls as unknown[][])[0]?.[1]).toBe(controller.signal)
  })

  it("maps bridge failures to runtime_unavailable without leaking payloads", async () => {
    const logger = { warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
    const callHumanInputRequest = vi.fn(async () => ({
      ok: false as const,
      op: HUMAN_INPUT_OPS.request,
      requestId: "call-1",
      error: { code: WorkspaceBridgeErrorCode.CapabilityDenied, message: "denied" },
    }))
    const tool = captureTool({ sessionId: "session-1", callHumanInputRequest, logger })
    await expect(tool.execute("call-1", { title: "Need input", schema })).resolves.toMatchObject({
      isError: true,
      details: { status: "cancelled", reason: "runtime_unavailable" },
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("Need input")
  })
})
